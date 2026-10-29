# -*- coding: utf-8 -*-
"""全公演データの備考略称をフルネームへ展開する一括変換（tools/name_expand.py を使用）。
使い方: python3 tools/expand_remarks.py [--dry]"""
import csv, io, json, glob, os, sys, urllib.request
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import name_expand as nx

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY = '--dry' in sys.argv
MAIN = 'https://docs.google.com/spreadsheets/d/13nV17Gm9z5kITFnfsXOLsN9BO476KWjlh9RclSBzU-w/gviz/tq?tqx=out:csv&sheet='


def _iso(d):
    if not d:
        return None
    p = d.strip().split('-')
    if len(p) != 3:
        return None
    return f'{int(p[0]):04d}-{int(p[1]):02d}-{int(p[2]):02d}'


def fetch_activity():
    """Sakamichi Universe メンバー表から在籍期間（加入日〜卒業日）を取得する。"""
    act = {}
    for sheet in ('Nmember', 'Smember', 'Hmember'):
        raw = urllib.request.urlopen(MAIN + sheet, timeout=60).read().decode('utf-8-sig')
        for r in csv.DictReader(io.StringIO(raw)):
            name = (r.get('name1') or '').strip()
            join, grad = _iso(r.get('joindate') or ''), _iso(r.get('graduatedate') or '')
            if not name or not join:
                continue
            if name in act:  # 複数シートに載る場合は期間を広く取る
                old = act[name]
                join = min(join, old[0])
                grad = None if (grad is None or old[1] is None) else max(grad, old[1])
            act[name] = (join, grad)
    return act


def main():
    members = json.load(open(os.path.join(BASE, 'data/members.json')))
    all_names = set(m['name'] for m in members)
    gm = nx.build_group_members(members)
    lives = {l['id']: l for l in json.load(open(os.path.join(BASE, 'data/lives.json')))}
    activity = fetch_activity()
    print('activity members:', len(activity))
    unresolved, stats = Counter(), Counter()
    changed_files = 0
    for f in sorted(glob.glob(os.path.join(BASE, 'data/shows/*.json'))):
        d = json.load(open(f))
        sid = os.path.basename(f)[:-5]
        before = json.dumps(d, ensure_ascii=False, sort_keys=True)
        nx.normalize_show(d, lives.get(sid, {}).get('group', ''), members, gm,
                          all_names, unresolved, stats,
                          date=lives.get(sid, {}).get('date'), activity=activity)
        if json.dumps(d, ensure_ascii=False, sort_keys=True) != before:
            changed_files += 1
            if not DRY:
                json.dump(d, open(f, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('stats:', dict(stats))
    print('changed files:', changed_files)
    print('unresolved top:', unresolved.most_common(15))


if __name__ == '__main__':
    main()
