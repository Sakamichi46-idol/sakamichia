# -*- coding: utf-8 -*-
"""SBA本文ファイルが揃ったレコードに body フラグを立てる。

使い方: python3 tools/finalize_sba_bodies.py
注意: ストアを書き換えるため、本文バックフィル（backfill_bodies.py）を
止めた状態で実行すること。
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_backfill as bf

BASE = bf.BASE


def main():
    idx, years, imgs = bf.load_store()
    dirty = set()
    n = 0
    for y, lst in years.items():
        for b in lst:
            if b.get('arch') != 'sakamichi.co' or b.get('body'):
                continue
            if os.path.exists(os.path.join(BASE, 'data/bodies', b['id'] + '.json')):
                b['body'] = True
                dirty.add(y)
                n += 1
    if dirty:
        bf.save_store(idx, years, imgs, dirty)
    print('flags set:', n)


if __name__ == '__main__':
    main()
