# -*- coding: utf-8 -*-
"""Sakamichi Blog Archive (sakamichi.co) の保存記事をブログストアへ取り込む（メタデータ編）。

使い方:
  python3 tools/import_sba.py <corpus.json> <表示グループ> <メンバー1,メンバー2,...|ALL>

- corpus.json は SBA 一覧 API を全ページ集めたもの（items: uid/member_name/title/
  published_at/images/use_archive/url）。
- use_archive=true の記事だけを対象にする（公式に残っていない卒業メンバーの記事）。
- レコード id は sba-<apiグループ>-<uid>。公式リンクは出さない（urldead=true, arch='sakamichi.co'）。
- 本文は tools/fetch_sba_bodies.py で別途取得する。
"""
import json, os, sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_backfill as bf

BASE = bf.BASE
API_GROUP = {'欅坂46': 'keyaki', '乃木坂46': 'nogi', '櫻坂46': 'sakura', '日向坂46': 'hinata'}


def norm_name(n):
    return (n or '').replace(' ', '').replace('　', '').strip()


def main():
    corpus_path, group, members_arg = sys.argv[1], sys.argv[2], sys.argv[3]
    targets = None if members_arg == 'ALL' else set(members_arg.split(','))
    api = API_GROUP[group]
    corpus = json.load(open(corpus_path))
    idx, years, imgs = bf.load_store()
    have_ids = set()
    have_keys = set()
    for lst in years.values():
        for b in lst:
            have_ids.add(b['id'])
            have_keys.add((b['group'], b['member'], b['date'], b['title']))
    added = Counter()
    dirty = set()
    skipped_dup = 0
    items = []
    for it in corpus:
        if not it.get('use_archive'):
            continue
        member = norm_name(it.get('member_name'))
        if targets is not None and member not in targets:
            continue
        items.append((it, member))
    items.sort(key=lambda x: x[0]['published_at'])
    for it, member in items:
        rid = f"sba-{api}-{it['uid']}"
        dt = datetime.fromisoformat(it['published_at'].replace('Z', '+00:00')) \
            .astimezone(timezone(timedelta(hours=9)))
        date, time = dt.strftime('%Y-%m-%d'), dt.strftime('%H:%M')
        if rid in have_ids or (group, member, date, it['title']) in have_keys:
            skipped_dup += 1
            continue
        images = it.get('images') or []
        rec = {'id': rid, 'group': group, 'member': member, 'title': it['title'],
               'date': date, 'time': time, 'url': it['url'], 'urldead': True,
               'arch': 'sakamichi.co', 'media': 0, 'imgn': len(images)}
        if images:
            rec['thumb'] = images[0]['thumbnail_url']
            imgs.setdefault(date[:4], {})[rid] = [im['url'] for im in images]
        years.setdefault(date[:4], []).append(rec)
        have_ids.add(rid)
        have_keys.add((group, member, date, it['title']))
        added[member] += 1
        dirty.add(date[:4])
    bf.save_store(idx, years, imgs, dirty)
    print('added:', dict(added), '| total added:', sum(added.values()), '| dup skipped:', skipped_dup)
    print('store total:', idx['total'])


if __name__ == '__main__':
    main()
