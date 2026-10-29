# -*- coding: utf-8 -*-
"""全公演データの備考略称をフルネームへ展開する一括変換（tools/name_expand.py を使用）。
使い方: python3 tools/expand_remarks.py [--dry]"""
import json, glob, os, sys
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import name_expand as nx

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY = '--dry' in sys.argv


def main():
    members = json.load(open(os.path.join(BASE, 'data/members.json')))
    all_names = set(m['name'] for m in members)
    gm = nx.build_group_members(members)
    lives = {l['id']: l for l in json.load(open(os.path.join(BASE, 'data/lives.json')))}
    unresolved, stats = Counter(), Counter()
    changed_files = 0
    for f in sorted(glob.glob(os.path.join(BASE, 'data/shows/*.json'))):
        d = json.load(open(f))
        sid = os.path.basename(f)[:-5]
        before = json.dumps(d, ensure_ascii=False, sort_keys=True)
        nx.normalize_show(d, lives.get(sid, {}).get('group', ''), members, gm,
                          all_names, unresolved, stats)
        if json.dumps(d, ensure_ascii=False, sort_keys=True) != before:
            changed_files += 1
            if not DRY:
                json.dump(d, open(f, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('stats:', dict(stats))
    print('changed files:', changed_files)
    print('unresolved top:', unresolved.most_common(15))


if __name__ == '__main__':
    main()
