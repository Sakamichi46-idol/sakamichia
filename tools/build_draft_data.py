#!/usr/bin/env python3
"""ドラフト用データを作る。

旧『坂道日和』のドラフト名簿（members-data.js）と在籍期間（draft-timeline.js）は
内部IDで一致しているので、そのままJSON化して取り込む（出典：旧サイトの公開データ）。
保存したソースは ~/workspace/sakamichia-import/oldsite-draft/ にある。

出力:
- data/draft-members.json  [{id, name, group, generation, groups, graduated, reading}]
- data/draft-timeline.json {version, ready, members: {id: {joined, left, uncertainEnd}}}
"""
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.expanduser('~/workspace/sakamichia-import/oldsite-draft')


def read_js(path):
    return open(os.path.join(SRC, path), encoding='utf-8').read()


def main():
    src = read_js('members-data.js')
    roster = json.loads(src[src.index('['):src.rindex(']') + 1])
    ours = json.load(open(os.path.join(BASE, 'data', 'members.json'), encoding='utf-8'))
    our_names = sorted(m['name'] for m in ours if m['name'] != 'ポカ')
    if sorted(m['name'] for m in roster) != our_names:
        raise SystemExit('名簿の名前集合がサカミチアのメンバーと一致しません')
    json.dump(roster, open(os.path.join(BASE, 'data', 'draft-members.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    print('draft-members:', len(roster))

    tsrc = read_js('draft-timeline.js')
    timeline = json.loads(tsrc[tsrc.index('{'):tsrc.rindex('}') + 1])
    ids = {m['id'] for m in roster}
    tl_ids = set(timeline['members'].keys())
    print('timeline entries:', len(tl_ids), '| roster ids missing timeline:', len(ids - tl_ids))
    json.dump(timeline, open(os.path.join(BASE, 'data', 'draft-timeline.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
