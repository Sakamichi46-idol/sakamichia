#!/usr/bin/env python3
"""ブログ記事の body フラグを、本文データの実在に合わせる。

本文は data/bodies-pack/<h3>.json（配信用シャード）と data/bodies/<id>.json
（作業用・gitignore）に保存されているが、記事側の body フラグが追随して
いないと、本文があるのにサイトで読めない記事が出る。このツールは両方を
正として、全記事のフラグを実在に同期する（片方向の付け忘れ・付け過ぎの
両方を直す）。変更のあった年ファイルだけを書き直す。
"""
import glob
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def existing_body_ids():
    ids = set()
    pack_dir = os.path.join(BASE, 'data', 'bodies-pack')
    if os.path.isdir(pack_dir):
        for name in os.listdir(pack_dir):
            if name.endswith('.json'):
                with open(os.path.join(pack_dir, name), encoding='utf-8') as f:
                    ids.update(json.load(f).keys())
    bodies_dir = os.path.join(BASE, 'data', 'bodies')
    if os.path.isdir(bodies_dir):
        for name in os.listdir(bodies_dir):
            if name.endswith('.json'):
                ids.add(name[:-5])
    return ids


def main():
    have = existing_body_ids()
    turned_on = turned_off = 0
    for path in sorted(glob.glob(os.path.join(BASE, 'data', 'blogs', 'y*.json'))):
        with open(path, encoding='utf-8') as f:
            lst = json.load(f)
        changed = False
        for b in lst:
            should = b['id'] in have
            if should and not b.get('body'):
                b['body'] = True
                turned_on += 1
                changed = True
            elif not should and b.get('body'):
                del b['body']
                turned_off += 1
                changed = True
        if changed:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(lst, f, ensure_ascii=False, separators=(',', ':'))
    print(f'body ids existing: {len(have)} | flags on +{turned_on} / off -{turned_off}')


if __name__ == '__main__':
    main()
