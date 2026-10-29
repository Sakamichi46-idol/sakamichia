#!/usr/bin/env python3
"""n46db.com のプロフィール写真を自サイト用に取り込む。

n46db は外部からの画像直リンクを403で拒否するため、写真ファイル自体を
assets/member-photos/ に保存して使う（出典はページ側に明記する）。
手順: メンバー一覧（現役+卒業）→ 各プロフィールページ → profilepics の
ファイル名を特定 → 画像をダウンロード。data/member-photos.json に
{メンバー名: ファイル名} を書き出す。再実行時は取得済みをスキップ。
"""
import json
import os
import re
import subprocess
import sys
import time
from urllib.parse import urljoin

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, 'assets', 'member-photos')
MAP_PATH = os.path.join(BASE, 'data', 'member-photos.json')
ROOT = 'https://n46db.com/'
LISTS = ['saka/saka-memberlist.php', 'saka/saka-memberlist.php?graduated=yes']
UA = {'User-Agent': 'Mozilla/5.0'}


def curl(url, binary=False):
    from urllib.parse import quote
    url = quote(url, safe=':/?&=%.-_~')   # shortname= の日本語を符号化（しないと curl がエラーになる）
    cmd = ['curl', '-s', '-A', UA['User-Agent'], url]
    r = subprocess.run(cmd, capture_output=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f'curl failed: {url}')
    return r.stdout if binary else r.stdout.decode('utf-8', 'ignore')


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    members = json.load(open(os.path.join(BASE, 'data', 'members.json'), encoding='utf-8'))
    targets = [m['name'] for m in members if m['name'] != 'ポカ']
    # 1) 一覧から 名前 -> プロフィールURL
    profiles = {}
    for lst in LISTS:
        html = curl(urljoin(ROOT, lst))
        for href, name in re.findall(r'href="([^"]*profile\.php[^"]*)"[^>]*>([^<]+)', html):
            import unicodedata
            nm = unicodedata.normalize('NFKC', name).replace(' ', '').replace('　', '').strip()
            if nm and nm not in profiles:
                profiles[nm] = urljoin(ROOT + 'saka/', href)
    print(f'profile urls found: {len(profiles)}', flush=True)
    # 2) 各プロフィールから写真ファイル名を特定してダウンロード
    mapping = {}
    if os.path.exists(MAP_PATH):
        mapping = json.load(open(MAP_PATH, encoding='utf-8'))
    missing = []
    for i, name in enumerate(targets, 1):
        if name in mapping and os.path.exists(os.path.join(OUT_DIR, mapping[name])):
            continue
        url = profiles.get(name)
        if not url:
            missing.append((name, '一覧に無い'))
            continue
        try:
            html = curl(url)
            files = re.findall(r'pictures/((?:profilepics|k46|h46)/[a-z0-9_/]+\.jpg)', html)
            if not files:
                missing.append((name, '写真が見つからない'))
                continue
            fn = files[0].split('/')[-1]
            data = curl(urljoin(ROOT, 'pictures/' + files[0]), binary=True)
            if len(data) < 1000 or data[:2] != b'\xff\xd8':
                missing.append((name, f'画像取得失敗 {fn}'))
                continue
            with open(os.path.join(OUT_DIR, fn), 'wb') as f:
                f.write(data)
            mapping[name] = fn
        except Exception as e:
            missing.append((name, f'エラー {e}'))
        if i % 40 == 0:
            print(f'{i}/{len(targets)} done', flush=True)
        time.sleep(0.15)
    with open(MAP_PATH, 'w', encoding='utf-8') as f:
        json.dump(mapping, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f'mapped: {len(mapping)}/{len(targets)}')
    for name, why in missing:
        print('MISSING:', name, '-', why)


if __name__ == '__main__':
    main()
