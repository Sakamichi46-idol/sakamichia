# -*- coding: utf-8 -*-
"""SBA取り込み記事のサムネイルを原寸写真に差し替える（ワンオフ修正）。

import_sba.py が thumbnail_url（160×160）を thumb に入れていたため、
カード表示で画質が悪かった。写真一覧（imgs）にある原寸URLの1枚目に差し替える。
今後の取り込みは import_sba.py 側で原寸を使うよう修正済み。
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_backfill as bf

def main():
    idx, years, imgs = bf.load_store()
    fixed = 0
    noimg = 0
    dirty = set()
    for y, lst in years.items():
        year_imgs = imgs.get(y, {})
        for b in lst:
            t = b.get('thumb') or ''
            if 'images.sakamichi.co' not in t:
                continue
            photos = year_imgs.get(b['id']) or []
            if photos:
                if b['thumb'] != photos[0]:
                    b['thumb'] = photos[0]
                    fixed += 1
                    dirty.add(y)
            else:
                noimg += 1
    bf.save_store(idx, years, imgs, dirty)
    print(f'fixed: {fixed}, sba thumbs without photos: {noimg}, years touched: {sorted(dirty)}')

if __name__ == '__main__':
    main()
