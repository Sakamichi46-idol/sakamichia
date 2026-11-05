#!/usr/bin/env python3
"""公式サイトのトップのキービジュアル（KV）画像URLを取得して data/kv.json を作る。

トップページの大きな見出しスライダー用。各グループ最大3枚まで、
トップのメインKV＋特設系バナーの画像URL（原寸）とリンク先を記録する。
取得できたグループ分だけ差し替え、失敗したグループは前回の値を保持する
（乃木坂はWAFでスクリプト取得できない間、回復次第このスクリプトが拾う）。

使い方: python3 tools/fetch_kv.py
"""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36"
JST = timezone(timedelta(hours=9))
MAX_PER_GROUP = 3


def fetch(url: str) -> str:
    for _ in range(3):
        r = subprocess.run(["curl", "-sL", "--max-time", "40", "-A", UA, url],
                           capture_output=True, text=True)
        if r.returncode == 0 and r.stdout:
            return r.stdout
        time.sleep(1.5)
    return ""


def head_ok(url: str) -> bool:
    r = subprocess.run(["curl", "-sI", "--max-time", "20", "-A", UA, url],
                       capture_output=True, text=True)
    lines = r.stdout.splitlines()
    return bool(lines) and lines[0].startswith("HTTP/") and " 200" in lines[0]


def original_of(img: str) -> str:
    """サイズ指定の派生URL（…/600_600_102400.jpg や …-01.jpg）から原寸候補を作り、
    存在を確認できた場合だけそちらを返す。"""
    cands = []
    m = re.match(r"(.+?)/\d+_\d+_102400(\.\w+)$", img)
    if m:
        cands.append(m.group(1) + m.group(2))
    base = re.sub(r"-\d+(\.\w+)$", r"\1", img)
    if base != img:
        cands.append(base)
    for c in cands:
        if head_ok(c):
            return c
    return img


def parse_sakura(html: str):
    items = []
    m = re.search(r'class="elem-visual">\s*<a href="([^"]+)"[^>]*>\s*<img src="([^"]+)"', html)
    if m:
        img = m.group(2)
        if img.startswith("/"):
            img = "https://www.sakurazaka46.com" + img
        items.append({"img": img, "url": m.group(1)})
    cands = []
    for m in re.finditer(r'<li class="box">\s*<a href="([^"]+)"[^>]*>\s*<figure class="img"><img class="chgimg" src="([^"]+)"', html):
        url, img = m.group(1), m.group(2)
        if "store." in url or "plusmember" in url or "aeon" in url or "about_fanclub" in url:
            continue
        if img.startswith("/"):
            img = "https://www.sakurazaka46.com" + img
        cands.append((url, img))
    cands.sort(key=lambda x: 0 if ("/page/" in x[0] or "single" in x[0] or "live" in x[0].lower()) else 1)
    for url, img in cands:
        items.append({"img": original_of(img), "url": url})
        if len(items) >= MAX_PER_GROUP:
            break
    return items[:MAX_PER_GROUP]


def parse_hinata(html: str):
    slides = []
    for m in re.finditer(r'class="p-top__slide">\s*<a href="([^"]+)"[^>]*>\s*<div class="c-top__slide-thumb">\s*<img alt="([^"]*)" src="([^"]+)"', html):
        slides.append((m.group(1), m.group(3), re.sub(r"<[^>]+>", "", m.group(2))))
    for m in re.finditer(r'class="p-top__slide">\s*<a href="([^"]+)"[^>]*>\s*<div class="c-top__slide-thumb" style="background-image:url\(([^)]+)\)".{0,600}?c-top__slide-title">\s*([^<]+)', html, re.S):
        slides.append((m.group(1), m.group(2), m.group(3).strip()))
    slides = [(u, i, t) for (u, i, t) in slides if "store." not in u and "plusmember" not in u]

    def rank(x):
        t = x[2]
        if "SPECIAL SITE" in t:
            return 0
        if "『" in t or "「" in t:
            return 1
        if "発売" in t:
            return 2
        if "youtube" in x[0] or "Lemino" in t or "ファンクラブ" in t:
            return 4
        return 3

    slides.sort(key=rank)
    return [{"img": original_of(i), "url": u} for (u, i, t) in slides[:MAX_PER_GROUP]]


def parse_nogizaka(html: str):
    # WAFが解けて取得できるようになった場合の汎用抽出。
    # サイズ指定サフィックス（_102400等）のない /images/ 画像を包むリンクを最大3件採る。
    items = []
    seen = set()
    for m in re.finditer(r'<a href="([^"]+)"[^>]*>\s*<img[^>]+src="(https://www\.nogizaka46\.com/images/[^"]+)"', html):
        if "_102400" in m.group(2) or m.group(2) in seen:
            continue
        seen.add(m.group(2))
        items.append({"img": m.group(2), "url": m.group(1)})
        if len(items) >= MAX_PER_GROUP:
            break
    return items


def main():
    path = os.path.join(BASE, "data", "kv.json")
    old = {}
    if os.path.exists(path):
        try:
            old = json.load(open(path, encoding="utf-8")).get("items", {})
        except Exception:
            old = {}
    jobs = [
        ("乃木坂46", "https://www.nogizaka46.com/s/n46/", parse_nogizaka),
        ("櫻坂46", "https://www.sakurazaka46.com/s/s46/", parse_sakura),
        ("日向坂46", "https://www.hinatazaka46.com/s/official/", parse_hinata),
    ]
    items = dict(old)
    got = []
    for group, url, parser in jobs:
        html = fetch(url)
        lst = parser(html) if html else []
        if lst:
            items[group] = lst
            got.append(f"{group}×{len(lst)}")
    out = {"updated": datetime.now(JST).strftime("%Y-%m-%d"), "items": items}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("kv updated:", ", ".join(got) if got else "(none)")
    return 0 if got else 1


if __name__ == "__main__":
    sys.exit(main())
