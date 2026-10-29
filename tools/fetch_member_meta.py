#!/usr/bin/env python3
"""n46db のプロフィールから誕生日・出身地を取り込み data/member-meta.json を作る。

条件ドラフト（誕生月・生まれ年・学年・干支・出身地）の判定用。
プロフィールURLの発見方法は fetch_member_photos.py と同じ。
"""
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from urllib.parse import quote, urljoin

ROOT = 'https://n46db.com/'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
LIST_PAGES = [
    'saka/saka-memberlist.php',
    'saka/saka-memberlist.php?graduated=yes',
]
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'data', 'member-meta.json')


def curl(url):
    url = quote(url, safe=':/?&=%.-_~')
    last = None
    for attempt in range(3):
        r = subprocess.run(['curl', '-s', '-A', UA, url], capture_output=True, timeout=60)
        if r.returncode == 0:
            return r.stdout.decode('utf-8', 'ignore')
        last = RuntimeError(f'curl failed: {url}')
        time.sleep(2 + attempt * 2)
    raise last


def build_profiles():
    profiles = {}
    for page in LIST_PAGES:
        html = curl(urljoin(ROOT, page))
        for href, name in re.findall(r'href="([^"]*profile\.php[^"]*)"[^>]*>([^<]+)', html):
            nm = unicodedata.normalize('NFKC', name).replace(' ', '').replace('　', '').strip()
            if nm and nm not in profiles:
                profiles[nm] = urljoin(ROOT + 'saka/', href)
    return profiles


def parse_meta(html):
    text = re.sub(r'<[^>]+>', ' ', html)
    text = re.sub(r'\s+', ' ', text)
    m = re.search(r'生年月日\s*[:：]?\s*(\d{4})年(\d{1,2})月(\d{1,2})日', text)
    if not m:
        return None
    out = {'b': [int(m.group(1)), int(m.group(2)), int(m.group(3))]}
    tail = text[m.end():m.end() + 80]
    hm = re.search(r'出身地\s*[:：]?\s*([^\s：:]+)', tail)
    if hm:
        out['home'] = hm.group(1)
    return out


def main():
    members = json.load(open(os.path.join(BASE, 'data', 'members.json'), encoding='utf-8'))
    profiles = build_profiles()
    print('profile urls found:', len(profiles), flush=True)
    result = {}
    if os.path.exists(OUT):
        result = json.load(open(OUT, encoding='utf-8'))
    missing = []
    for i, mb in enumerate(members):
        name = mb['name']
        if name in result or name not in profiles:
            continue
        try:
            meta = parse_meta(curl(profiles[name]))
        except Exception as e:
            print('FAIL', name, e, flush=True)
            meta = None
        if meta:
            result[name] = meta
        else:
            missing.append(name)
        if (i + 1) % 40 == 0:
            print(f'{i + 1}/{len(members)} members, meta so far {len(result)}', flush=True)
        time.sleep(0.1)
    json.dump(result, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, sort_keys=True)
    print('meta mapped:', len(result), '/ 205 | missing:', missing, flush=True)


if __name__ == '__main__':
    sys.exit(main())
