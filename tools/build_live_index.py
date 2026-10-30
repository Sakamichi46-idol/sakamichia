# -*- coding: utf-8 -*-
"""全公演のセットリストから検索索引 data/live-index.json を生成する。
あわせて、メンバーページ用の参加公演サマリ data/member-live.json も生成する。

live-index.json 形式: {公演id: {"s": [曲名...], "c": [センター名...], "p": [参加メンバー名...]}}
- s: その公演で披露された曲名（重複なし）
- c: センターを務めたメンバー（重複なし。名簿に一致する名前のみ）
- p: 参加したメンバー（重複なし）= 出演者記録（perf）＋センター＋次の推定。
  * 「全員」歌唱曲がある公演: その公演日にそのグループに在籍していたメンバー全員。
  * 通常の単独公演・ツアー等（外部イベント/ミニライブ/アンダーライブ等は除く）:
    セトリにクレジットが無い曲ばかりでも、公演日に在籍していたメンバーは参加として扱う。
    タイトルに「N期生」とある公演はその期だけに絞り、備考に休演・不在・欠席の
    記録があるメンバーは除く。

member-live.json 形式: {メンバー名: {"shows": 参加公演数, "centers": センター公演数}}

使い方: python3 tools/build_live_index.py
"""
import glob, json, os, re
from collections import Counter

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZENIN = re.compile(r'^全員(歌唱|バージョン)?$')


def _load_activity(base):
    """メンバー名 → (加入日, 卒業日 or None)。ドラフト用の在籍データを利用する。"""
    try:
        dm = json.load(open(os.path.join(base, 'data/draft-members.json'), encoding='utf-8'))
        tl = json.load(open(os.path.join(base, 'data/draft-timeline.json'), encoding='utf-8')).get('members', {})
    except Exception:
        return {}
    act = {}
    for m in dm:
        t = tl.get(m.get('id') or '')
        if t and t.get('joined'):
            act[m['name']] = (t['joined'], t.get('left'))
    return act


def _center_names(raw, roster):
    """センター文字列から名簿に一致する名前だけを取り出す（+◯期生などの接尾辞は落とす）。"""
    out = []
    for tok in re.split(r'[・→]', raw or ''):
        t = re.sub(r'（[^）]*）$', '', tok.strip())
        t = re.sub(r'\+.*$', '', t).strip()
        if t in roster:
            out.append(t)
    return out


def build_index(base=BASE):
    members = json.load(open(os.path.join(base, 'data/members.json'), encoding='utf-8'))
    roster = {m['name'] for m in members}
    groups_of = {m['name']: (m.get('groups') or [m.get('group')]) for m in members}
    gen_of = {m['name']: m.get('gen') or 0 for m in members}
    activity = _load_activity(base)
    lives = {l['id']: l for l in json.load(open(os.path.join(base, 'data/lives.json'), encoding='utf-8'))}
    INFER_TAGS = ('単独主催公演', 'BIRTHDAY LIVE', 'ANNIVERSARY LIVE', 'ひな誕祭',
                  '欅共和国/W-K FES.', 'がなくり/ひなくり', '合同公演')
    EXCLUDE_TAGS = {'外部のイベント', 'ミニライブなど', 'アンダーライブ', 'BACKS LIVE!!', 'ひなた坂46LIVE'}
    ABSENT = re.compile(r'([一-龯]{2,4}?)(?:休演|不在|欠席)')

    def active_roster(group, date):
        if not date:
            return []
        out = []
        for name, gs in groups_of.items():
            if group not in gs:
                continue
            rng = activity.get(name)
            if rng is None:
                continue
            if rng[0] <= date and (rng[1] is None or date <= rng[1]):
                out.append(name)
        return out

    index = {}
    stats = Counter()
    for f in sorted(glob.glob(os.path.join(base, 'data/shows/*.json'))):
        d = json.load(open(f))
        sid = os.path.basename(f)[:-5]
        songs, centers, perfs = [], [], []
        seen_s, seen_c, seen_p = set(), set(), set()
        zenin = False
        for s in d.get('setlist', []):
            t = (s.get('title') or '').strip()
            if t and t not in seen_s:
                seen_s.add(t)
                songs.append(t)
            for c in _center_names(s.get('center'), roster):
                if c not in seen_c:
                    seen_c.add(c)
                    centers.append(c)
            for p in s.get('perf') or []:
                if p not in seen_p:
                    seen_p.add(p)
                    perfs.append(p)
            rk = s.get('remark') or ''
            if any(ZENIN.match(cl.strip()) for cl in rk.split('、')):
                zenin = True
        p_all = list(perfs)
        seen_pa = set(p_all)
        for c in centers:
            if c not in seen_pa:
                seen_pa.add(c)
                p_all.append(c)
        meta = lives.get(sid, {})
        if zenin and len(d.get('setlist', [])) >= 5:
            for name in active_roster(meta.get('group', ''), meta.get('date', '')):
                if name not in seen_pa:
                    seen_pa.add(name)
                    p_all.append(name)
            stats['zenin_shows'] += 1
        # 通常公演は在籍メンバー全員が参加したものとして扱う（クレジットが無い曲のみの公演対策）
        tags = meta.get('tags') or []
        eligible = (any(t in INFER_TAGS for t in tags) or any('全国ツアー' in t for t in tags)) \
            and not any(t in EXCLUDE_TAGS for t in tags)
        if eligible:
            pool = active_roster(meta.get('group', ''), meta.get('date', ''))
            gm = re.search(r'(\d)期生', meta.get('title', ''))
            if gm:
                pool = [n for n in pool if gen_of.get(n) == int(gm.group(1))]
            # 備考に休演・不在・欠席とあるメンバーは除く（名前の前後一致が一意な場合のみ）
            absent = set()
            for s in d.get('setlist', []):
                for tok in ABSENT.findall(s.get('remark') or ''):
                    hit = [n for n in pool if n.startswith(tok) or n.endswith(tok)]
                    if len(hit) == 1:
                        absent.add(hit[0])
            added_here = 0
            for name in pool:
                if name not in absent and name not in seen_pa:
                    seen_pa.add(name)
                    p_all.append(name)
                    added_here += 1
            if added_here:
                stats['infer_shows'] += 1
        index[sid] = {'s': songs, 'c': centers, 'p': p_all}
        stats['shows'] += 1
    member_live = {}
    for e in index.values():
        for n in e['p']:
            if n in roster:
                member_live.setdefault(n, {'shows': 0, 'centers': 0})['shows'] += 1
        for n in e['c']:
            if n in roster:
                member_live.setdefault(n, {'shows': 0, 'centers': 0})['centers'] += 1
    return index, member_live, stats


def write_index(base=BASE):
    index, member_live, stats = build_index(base)
    path = os.path.join(base, 'data/live-index.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    path2 = os.path.join(base, 'data/member-live.json')
    with open(path2, 'w', encoding='utf-8') as f:
        json.dump(member_live, f, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    return path, len(index), stats


if __name__ == '__main__':
    path, n, stats = write_index()
    size = os.path.getsize(path)
    print(f'wrote {path}: {n} shows, {size/1024:.0f} KiB, stats={dict(stats)}')
