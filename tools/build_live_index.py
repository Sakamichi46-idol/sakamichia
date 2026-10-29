# -*- coding: utf-8 -*-
"""全公演のセットリストから検索索引 data/live-index.json を生成する。

形式: {公演id: {"s": [曲名...], "c": [センター名...], "p": [参加メンバー名...]}}
- s: その公演で披露された曲名（重複なし）
- c: センターを務めたメンバー（重複なし）
- p: 参加メンバーとして記録のあるメンバー（重複なし。出演者記録のある曲のみが対象）

使い方: python3 tools/build_live_index.py
"""
import glob, json, os, re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build_index(base=BASE):
    index = {}
    for f in sorted(glob.glob(os.path.join(base, 'data/shows/*.json'))):
        d = json.load(open(f))
        sid = os.path.basename(f)[:-5]
        songs, centers, perfs = [], [], []
        seen_s, seen_c, seen_p = set(), set(), set()
        for s in d.get('setlist', []):
            t = (s.get('title') or '').strip()
            if t and t not in seen_s:
                seen_s.add(t)
                songs.append(t)
            if s.get('center'):
                for c in re.split(r'[・→]', s['center']):
                    c = c.strip()
                    if c and c not in seen_c:
                        seen_c.add(c)
                        centers.append(c)
            for p in s.get('perf') or []:
                if p not in seen_p:
                    seen_p.add(p)
                    perfs.append(p)
        index[sid] = {'s': songs, 'c': centers, 'p': perfs}
    return index


def write_index(base=BASE):
    index = build_index(base)
    path = os.path.join(base, 'data/live-index.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    return path, len(index)


if __name__ == '__main__':
    path, n = write_index()
    size = os.path.getsize(path)
    print(f'wrote {path}: {n} shows, {size/1024:.0f} KiB')
