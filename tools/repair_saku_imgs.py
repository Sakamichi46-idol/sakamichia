#!/usr/bin/env python3
"""櫻坂46の写真リスト修復: 新しい /images/14/ 形式を取りこぼした記事を再抽出する。
保存済みリストより多く取れた場合だけ差し替える（縮むことはない）。
対象: 2026年以降の櫻坂46全記事＋写真リストのない櫻坂46記事＋写真0件の乃木坂46記事。
再開可能（tools/repair-imgs-progress.json）。
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_backfill as bf

PROG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'repair-imgs-progress.json')

def main():
    idx, years, imgs = bf.load_store()
    done = set()
    if os.path.exists(PROG):
        done = set(json.load(open(PROG)))
    todo_saku, todo_nogi = [], []
    for y, lst in years.items():
        for b in lst:
            if b['id'] in done or not b.get('url'):
                continue
            stored = imgs.get(y, {}).get(b['id'], [])
            if b['group'] == '櫻坂46' and (b['date'] >= '2026-01-01' or not stored):
                todo_saku.append((y, b))
            elif b['group'] == '乃木坂46' and not stored and not b.get('imgn'):
                todo_nogi.append((y, b))
    todo_saku.sort(key=lambda t: t[1]['date'], reverse=True)
    todo = todo_saku + todo_nogi
    print(f'targets: {len(todo)}', flush=True)
    dirty = set(); upgraded = 0; processed = 0
    for y, b in todo:
        try:
            html = bf.fetch(b['url'])
            got = bf.extract_imgs_scoped(b['url'], html)
        except Exception:
            got = []
        stored = imgs.get(y, {}).get(b['id'], [])
        if len(got) > len(stored):
            imgs.setdefault(y, {})[b['id']] = got
            b['imgn'] = len(got)
            if not b.get('thumb'):
                b['thumb'] = got[0]
            dirty.add(y); upgraded += 1
        done.add(b['id']); processed += 1
        if processed % 100 == 0:
            if dirty:
                bf.save_store(idx, years, imgs, dirty); dirty = set()
            json.dump(sorted(done), open(PROG, 'w'))
            print(f'{processed}/{len(todo)} upgraded={upgraded}', flush=True)
        time.sleep(1.0)
    if dirty:
        bf.save_store(idx, years, imgs, dirty)
    json.dump(sorted(done), open(PROG, 'w'))
    print(json.dumps({'processed': processed, 'upgraded': upgraded}, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
