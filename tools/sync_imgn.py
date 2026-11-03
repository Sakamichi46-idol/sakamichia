#!/usr/bin/env python3
"""ブログ記事の imgn（写真枚数）と thumb を、写真一覧（data/blog-imgs）の実態に合わせる。

カードの「写真N枚」バッジは imgn を見るが、写真一覧は blog-imgs が正。
修復ツール等が blog-imgs だけを書き換えると imgn が取り残され、「写真は出るのに
バッジが出ない」「実枚数と違う枚数が表示される」不整合になる。このツールは
全記事について imgn = blog-imgs の実件数、thumb = その先頭（0枚なら None）に
同期する（blog_backfill.save_store の保存時ガードと同じ規則の一括版）。
旧取り込みに残る media（バッジ表示で imgn より優先される旧・写真数）も、
値がある記事については実件数に合わせる。
変更のあった年ファイルだけを書き直す。--dry-run で件数だけ確認できる。
"""
import glob
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    dry = '--dry-run' in sys.argv
    fixed_imgn = fixed_thumb = fixed_media = scanned = 0
    for bpath in sorted(glob.glob(os.path.join(BASE, 'data', 'blogs', 'y*.json'))):
        year = os.path.basename(bpath)
        ipath = os.path.join(BASE, 'data', 'blog-imgs', year)
        with open(bpath, encoding='utf-8') as f:
            lst = json.load(f)
        imgs = {}
        if os.path.exists(ipath):
            with open(ipath, encoding='utf-8') as f:
                imgs = json.load(f)
        changed = False
        for b in lst:
            scanned += 1
            own = imgs.get(b['id']) or []
            if b.get('imgn') != len(own):
                b['imgn'] = len(own)
                fixed_imgn += 1
                changed = True
            want_thumb = own[0] if own else None
            if b.get('thumb') != want_thumb:
                b['thumb'] = want_thumb
                fixed_thumb += 1
                changed = True
            # 旧 media（値がある記事のみ）も実件数に合わせる。バッジは
            # media || imgn の順で見るため、ずれると誤表示になる。
            if b.get('media') and b['media'] != len(own):
                b['media'] = len(own)
                fixed_media += 1
                changed = True
        if changed and not dry:
            with open(bpath, 'w', encoding='utf-8') as f:
                json.dump(lst, f, ensure_ascii=False, separators=(',', ':'))
    print(f'scanned: {scanned} | imgn fixed: {fixed_imgn} | thumb fixed: {fixed_thumb}'
          f' | media fixed: {fixed_media}'
          + (' (dry-run)' if dry else ''))


if __name__ == '__main__':
    main()
