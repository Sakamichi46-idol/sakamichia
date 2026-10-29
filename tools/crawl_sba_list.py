# -*- coding: utf-8 -*-
"""Sakamichi Blog Archive の一覧APIを全ページ取得して corpus JSON を作る。

使い方: python3 tools/crawl_sba_list.py <api-group> <出力ファイル>
"""
import json, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor


def fetch_page(api, p):
    url = f'https://api.sakamichi.co/groups/{api}/blogs?p={p}'
    for attempt in range(3):
        try:
            r = subprocess.run(['curl', '-s', '--max-time', '30', url],
                               capture_output=True, text=True, timeout=40)
            return json.loads(r.stdout)
        except Exception:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'page {p} failed')


def main():
    api, out = sys.argv[1], sys.argv[2]
    first = fetch_page(api, 1)
    pages = first['pages']
    print(f'{api}: {pages} pages', flush=True)
    all_items = list(first['blogs'])
    with ThreadPoolExecutor(max_workers=4) as ex:
        for i, data in enumerate(ex.map(lambda p: fetch_page(api, p), range(2, pages + 1)), 2):
            all_items.extend(data['blogs'])
            if i % 100 == 0:
                print(f'{i}/{pages}', flush=True)
    json.dump(all_items, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'saved {len(all_items)} items -> {out}', flush=True)


if __name__ == '__main__':
    main()
