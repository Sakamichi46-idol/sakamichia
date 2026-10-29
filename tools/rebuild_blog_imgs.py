# -*- coding: utf-8 -*-
"""ブログ写真データの全面再取得。
公式記事ページから写真URLを抽出し直し、data/blog-imgs と各記事の thumb/imgn を作り直す。
櫻坂46の相対パス問題で写真が取れていなかった問題への対応（2026-10-29）。
再開可能: tools/rebuild-imgs-progress.json に処理済みIDを記録する。
使い方: python3 tools/rebuild_blog_imgs.py [件数上限]  （省略時は残り全部）
"""
import json, os, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_backfill as bf

BASE = bf.BASE
PROGRESS = os.path.join(BASE, 'tools', 'rebuild-imgs-progress.json')
SLEEP = 0.5

def fetch_html(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode('utf-8', 'ignore')

def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10**9
    idx, years, imgs = bf.load_store()
    done = set()
    if os.path.exists(PROGRESS):
        done = set(json.load(open(PROGRESS, encoding='utf-8')).get('done', []))
    todo = []
    for y in sorted(years):
        for b in years[y]:
            if b['group'] == '日向坂46':
                done.add(b['id'])  # 日向坂は一覧ブロック由来で検証済みのため対象外
                continue
            if b['id'] not in done and b.get('url'):
                todo.append((y, b))
    print(f"対象: {len(todo)} 件（処理済み {len(done)} 件）", flush=True)
    processed = 0
    stats = {'with_photos': 0, 'empty': 0, 'failed': 0, 'thumb_fixed': 0}
    dirty = set()
    by_id_year = {}
    for y, lst in years.items():
        for b in lst:
            by_id_year[b['id']] = (y, b)
    for y, b in todo:
        if processed >= limit:
            break
        try:
            html = fetch_html(b['url'])
            photos = bf.extract_imgs_scoped(b['url'], html)
        except Exception:
            photos = None
        time.sleep(SLEEP)
        processed += 1
        if photos is None:
            stats['failed'] += 1
            done.add(b['id'])  # 取得不能（削除済み等）は再試行しない
            continue
        old_imgs = imgs.get(y, {}).get(b['id'], [])
        if photos:
            stats['with_photos'] += 1
            if photos != old_imgs:
                imgs.setdefault(y, {})[b['id']] = photos
                dirty.add(y)
            if b.get('imgn') != len(photos):
                b['imgn'] = len(photos)
                dirty.add(y)
            # サムネイル: 記事の写真リストに含まれないものは先頭写真に差し替える
            if not b.get('thumb') or b['thumb'] not in photos:
                if b.get('thumb') != photos[0]:
                    stats['thumb_fixed'] += 1
                b['thumb'] = photos[0]
                dirty.add(y)
        else:
            stats['empty'] += 1
            if old_imgs:
                imgs.get(y, {}).pop(b['id'], None)
                dirty.add(y)
            if b.get('imgn'):
                b['imgn'] = 0
                dirty.add(y)
        done.add(b['id'])
        if processed % 100 == 0:
            bf.save_store(idx, years, imgs, dirty)
            dirty = set()
            json.dump({'done': sorted(done)}, open(PROGRESS, 'w', encoding='utf-8'))
            print(f"  {processed} 件処理… {stats}", flush=True)
    bf.save_store(idx, years, imgs, dirty)
    json.dump({'done': sorted(done)}, open(PROGRESS, 'w', encoding='utf-8'))
    print(json.dumps({'processed': processed, 'stats': stats, 'done_total': len(done)}, ensure_ascii=False))

if __name__ == '__main__':
    main()
