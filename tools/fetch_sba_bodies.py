# -*- coding: utf-8 -*-
"""Sakamichi Blog Archive の詳細APIから本文HTMLを取得し、blocks化して保存する。

使い方: python3 tools/fetch_sba_bodies.py <api-group> [メンバー1,メンバー2,...]

- 対象は arch='sakamichi.co' で本文ファイルがまだ無いレコード。
- 本文ファイル（data/bodies/<id>.json）だけを書く。ストアの body フラグは
  tools/finalize_sba_bodies.py で別途まとめて立てる（本文バックフィルとの競合回避）。
- 再開可能：既にファイルがある記事はスキップする。
"""
import json, os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_backfill as bf
from sba_blocks import sba_html_to_blocks

BASE = bf.BASE
BASE_URL = {'keyaki': 'https://www.keyakizaka46.com/', 'nogi': 'https://www.nogizaka46.com/',
            'sakura': 'https://sakurazaka46.com/', 'hinata': 'https://www.hinatazaka46.com/'}


def fetch_html(api, uid):
    url = f'https://api.sakamichi.co/groups/{api}/blogs/{uid}'
    for attempt in range(3):
        try:
            r = subprocess.run(['curl', '-s', '--max-time', '30', url],
                               capture_output=True, text=True, timeout=40)
            data = json.loads(r.stdout)
            return data.get('html') or ''
        except Exception:
            time.sleep(2 * (attempt + 1))
    return None


def main():
    api = sys.argv[1]
    members = set(sys.argv[2].split(',')) if len(sys.argv) > 2 else None
    idx, years, imgs = bf.load_store()
    targets = []
    for lst in years.values():
        for b in lst:
            if b.get('arch') != 'sakamichi.co':
                continue
            if not b['id'].startswith(f'sba-{api}-'):
                continue
            if members and b['member'] not in members:
                continue
            if os.path.exists(os.path.join(BASE, 'data/bodies', b['id'] + '.json')):
                continue
            targets.append(b)
    targets.sort(key=lambda b: (b['member'], b['date']))
    print(f'targets: {len(targets)}', flush=True)
    from concurrent.futures import ThreadPoolExecutor
    state = {'done': 0, 'empty': 0, 'failed': 0, 'i': 0}
    failed_ids = []

    def work(b):
        uid = b['id'].split('-')[-1]
        html = fetch_html(api, uid)
        if html is None:
            state['failed'] += 1
            failed_ids.append(b['id'])
            return
        blocks = sba_html_to_blocks(html, BASE_URL.get(api, ''))
        if not blocks:
            state['empty'] += 1
            return
        path = os.path.join(BASE, 'data/bodies', b['id'] + '.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({'blocks': blocks, 'source': 'archive'}, f, ensure_ascii=False, separators=(',', ':'))
        state['done'] += 1

    with ThreadPoolExecutor(max_workers=4) as ex:
        for _ in ex.map(work, targets):
            state['i'] += 1
            if state['i'] % 100 == 0:
                print(f"{state['i']}/{len(targets)} done={state['done']} empty={state['empty']} failed={state['failed']}", flush=True)
    print(f"ALL DONE done={state['done']} empty={state['empty']} failed={state['failed']}", flush=True)
    if failed_ids:
        print('failed ids:', ','.join(failed_ids), flush=True)


if __name__ == '__main__':
    main()
