#!/usr/bin/env python3
"""公式サイトのトップのキービジュアル（KV）画像URLを取得して data/kv.json を作る。

トップページの大きな見出しスライダー用。各グループのトップページ先頭の
メインKV（画像URL＋リンク先）だけを記録する。取得できたグループ分だけ差し替え、
失敗したグループは前回の値を保持する（乃木坂はWAFでスクリプト取得できない間、
ブラウザ経由で別途シードする）。

使い方: python3 tools/fetch_kv.py
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone, timedelta

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36"
JST = timezone(timedelta(hours=9))


def fetch(url: str) -> str:
    import time
    for _ in range(3):
        r = subprocess.run(["curl", "-sL", "--max-time", "40", "-A", UA, url],
                           capture_output=True, text=True)
        if r.returncode == 0 and r.stdout:
            return r.stdout
        time.sleep(1.5)
    return ""


def parse_sakura(html: str):
    m = re.search(r'class="elem-visual">\s*<a href="([^"]+)"[^>]*>\s*<img src="([^"]+)"', html)
    if not m:
        return None
    url, img = m.group(1), m.group(2)
    if img.startswith("/"):
        img = "https://www.sakurazaka46.com" + img
    return {"img": img, "url": url}


def parse_hinata(html: str):
    # スライドは複数あり並びも入れ替わる。タイトルに SPECIAL SITE や『』を含む
    # 特設系（シングル/ライブ等）を優先し、ストア・SNS等の宣伝スライドは後回しにする。
    slides = []
    for m in re.finditer(r'class="p-top__slide">\s*<a href="([^"]+)"[^>]*>\s*<div class="c-top__slide-thumb">\s*<img alt="([^"]*)" src="([^"]+)"', html):
        slides.append((m.group(1), m.group(3), re.sub(r"<[^>]+>", "", m.group(2))))
    for m in re.finditer(r'class="p-top__slide">\s*<a href="([^"]+)"[^>]*>\s*<div class="c-top__slide-thumb" style="background-image:url\(([^)]+)\)".{0,600}?c-top__slide-title">\s*([^<]+)', html, re.S):
        slides.append((m.group(1), m.group(2), m.group(3).strip()))
    slides = [(u, i, t) for (u, i, t) in slides if "store." not in u and "plusmember" not in u]
    if not slides:
        return None
    pick = (next((x for x in slides if "SPECIAL SITE" in x[2]), None)
            or next((x for x in slides if "『" in x[2] or "「" in x[2]), None)
            or slides[0])
    url, img = pick[0], pick[1]
    base = re.sub(r"-\d+(\.\w+)$", r"\1", img)
    if base != img:
        r = subprocess.run(["curl", "-sI", "--max-time", "20", "-A", UA, base],
                           capture_output=True, text=True)
        if r.stdout.startswith("HTTP/") and " 200" in r.stdout.splitlines()[0]:
            img = base
    return {"img": img, "url": url}


def parse_nogizaka(html: str):
    # WAFが解けて取得できるようになった場合の汎用抽出（先頭の大きなKV想定）。
    # サイズ指定サフィックス（_102400等）のない /images/ 画像を包む最初のリンクを採る。
    for m in re.finditer(r'<a href="([^"]+)"[^>]*>\s*<img[^>]+src="(https://www\.nogizaka46\.com/images/[^"]+)"', html):
        if "_102400" not in m.group(2):
            return {"img": m.group(2), "url": m.group(1)}
    return None


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
        kv = parser(html) if html else None
        if kv:
            items[group] = kv
            got.append(group)
    out = {"updated": datetime.now(JST).strftime("%Y-%m-%d"), "items": items}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("kv updated:", ", ".join(got) if got else "(none)", "| groups:", len(items))
    return 0 if got else 1


if __name__ == "__main__":
    sys.exit(main())
