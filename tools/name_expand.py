# -*- coding: utf-8 -*-
"""セットリスト備考の略称（C影山、井口・潮・…など）をフルネームへ展開する共通モジュール。

方針:
- 「C<名前>」節はセンター情報として center フィールドへ移す（フルネーム化して）。
- 備考が perf の略称複写なら備考を消す。perf が無く備考が名前リストなら perf にする。
- 展開は「その曲の出演者 → その公演の出演者 → そのグループ所属歴のあるメンバー」の
  順に候補を絞り、一意に決まる場合だけ置換する。曖昧なものは触らず報告に回す。
"""
import re

NEVER = {'全員', 'フル', 'ワンハーフ', 'なし', '無し', '不在', 'メドレー', 'ブロック',
         'ユニット', 'ソロ', 'ダンス', 'カップル', 'アンコール', '本編'}
C_HEAD = re.compile(r'^[CＣ][:：]?\s*(.+)$')
BRACKET = re.compile(r'(［[^］]*］)')
PAREN = re.compile(r'（[^）]*）')
ARROW_SPLIT = re.compile(r'\s*→\s*')


# 公演日と在籍期間による判別用コンテキスト（normalize_show が公演ごとに設定する）
_CTX = {'date': None, 'activity': {}}


def set_context(date, activity):
    _CTX['date'] = date
    _CTX['activity'] = activity or {}


def _active_filter(cands):
    """公演日に在籍していた候補だけに絞る。在籍情報が無い候補は残す。"""
    date, act = _CTX['date'], _CTX['activity']
    if not date or not act:
        return cands
    out = []
    for n in cands:
        rng = act.get(n)
        if rng is None:
            out.append(n)
        elif rng[0] <= date and (rng[1] is None or date <= rng[1]):
            out.append(n)
    return out


def _cands(token, pool):
    return [n for n in pool if n.startswith(token) or n.endswith(token)]


def expand_token(token, pools, all_names):
    """略称トークンをフルネームに展開。一意に決まらなければ None。
    同姓候補が複数ある場合は、公演日時点で在籍していたメンバーが1人だけならその人と判断する。"""
    token = token.strip()
    if not token or token in NEVER:
        return None
    if token in all_names:
        return token
    for pool in pools:
        c = _cands(token, pool)
        if len(c) == 1:
            return c[0]
        if len(c) > 1:
            f = _active_filter(c)
            if len(f) == 1:
                return f[0]
            if len(f) > 1:
                return None  # 在籍で絞っても曖昧なら確定できない
            # 在籍情報で全員外れた場合は次のプールへ
    return None


def _split_paren_suffix(token):
    m = re.match(r'^(.+?)(（[^）]*）)$', token)
    return (m.group(1), m.group(2)) if m else (token, '')


def _expand_list(text, pools, all_names, unresolved):
    """『・』区切り名前リストを展開。全トークン成功なら名前リスト、失敗があれば None。"""
    toks = [t.strip() for t in text.split('・')]
    if any(re.fullmatch(r'\d+|-?\d*期生?', t) for t in toks):
        return None  # 期生の列挙などは名前リストではない
    out = []
    for i, t in enumerate(toks):
        base, suffix = _split_paren_suffix(t)
        e = expand_token(base, pools, all_names)
        if e is None:
            r = _expand_role_token(base, pools, all_names)
            if r:
                e = r[1] if r[0] is None else f'{r[0]}：{r[1]}'
        if e is None:
            unresolved[t] += 1
            return None
        out.append(e + suffix)
    return out


def _expand_role_token(token, pools, all_names):
    """『ソロダンス井口』のように役割語＋略称がくっついたトークン。
    末尾の略称が展開できれば (役割語, フルネーム) を返す。
    『梅澤パート遠藤』のような「名前＋役割語＋名前」は (None, 展開済み文字列) を返す。"""
    for i in range(1, len(token) - 1):
        e = expand_token(token[i:], pools, all_names)
        if e:
            return token[:i], e
    for i in range(2, len(token) - 2):
        head = expand_token(token[:i], pools, all_names)
        if head:
            for j in range(i + 1, len(token)):
                tail = expand_token(token[j:], pools, all_names)
                if tail:
                    return None, head + token[i:j] + tail
    return None


def _expand_parens_and_brackets(text, pools, all_names, unresolved):
    """（…）や［…］の中の名前リスト／C略称をその場で展開する。"""
    def fix_inner(inner):
        m = C_HEAD.match(inner.strip())
        body = m.group(1) if m else inner
        parts = body.split('・')
        out = []
        changed = False
        for p in parts:
            seg = p.strip()
            # Cが途中に出る節（例： 夏曲メドレー・C井上）
            mm = C_HEAD.match(seg)
            target = mm.group(1) if mm else seg
            e = expand_token(target, pools, all_names)
            if e:
                out.append(e)
                changed = changed or (e != seg)
            else:
                out.append(seg)
        return '・'.join(out) if changed else inner
    text = PAREN.sub(lambda m: '（' + fix_inner(m.group(0)[1:-1]) + '）', text)
    text = BRACKET.sub(lambda m: '［' + fix_inner(m.group(0)[1:-1]) + '］', text)
    return text


def _expand_inplace(clause, pools, all_names, unresolved):
    """混在した節の中で、C<略称> と 『・』リストだけをその場で展開する（保守的）。"""
    # C<トークン> （区切り文字まで）
    def rep_c(m):
        e = expand_token(m.group(1), pools, all_names)
        if e:
            return e
        unresolved[m.group(1)] += 1
        return m.group(0)
    clause = re.sub(r'[CＣ][:：]?\s*([^\s、・／。［］（）]{1,8})', rep_c, clause)
    # 『・』リスト（2トークン以上、全展開できる場合のみ）
    def rep_list(m):
        got = _expand_list(m.group(0), pools, all_names, unresolved)
        if got:
            return '・'.join(got)
        # 部分展開（…除く等の混ざったリストでも、展開できる名前だけは直す）
        toks = m.group(0).split('・')
        out = []
        for t in toks:
            base, sep = (t[:-2], '除く') if t.endswith('除く') and len(t) > 2 else (t, '')
            e = expand_token(base, pools, all_names)
            out.append((e + sep) if e else t)
        return '・'.join(out)
    clause = re.sub(r'[^\s、・／。［］（）]+(?:・[^\s、・／。［］（）]+)+', rep_list, clause)
    return clause


BOUNDARY = r'(?:^|(?<=[はがをにのとへや、。・／「」『』\s]))'
BOUNDARY_R = r'(?=$|[はがをにのとへや、。・／「」『』\s])'


def _expand_standalone(clause, pools, all_names):
    """地の文の中の略称（助詞等に囲まれたもの）を、公演内で一意に決まる場合だけ展開する。
    例: 『だるまさんがころんだは井上と』→ 井上和（同じ公演の他曲で正式名が確認できる場合）"""
    show_pool = set(pools[0]) | set(pools[1])
    shorts = {}
    for name in show_pool:
        for ln in (2, 3):
            if len(name) > ln:
                for cand in (name[:ln], name[-ln:]):
                    e = expand_token(cand, pools, all_names)
                    if e == name:
                        shorts[cand] = name
    for cand in sorted(shorts, key=len, reverse=True):
        clause = re.sub(BOUNDARY + re.escape(cand) + BOUNDARY_R, shorts[cand], clause)
    return clause


def normalize_track(track, show_perf, group_members, all_names, unresolved, stats):
    remark = (track.get('remark') or '').strip()
    if not remark:
        return
    pools = [list(track.get('perf') or []), sorted(show_perf), group_members, all_names]
    leftover = []
    centers_found = []

    # 括弧ブロック［…］は節として独立に処理する
    parts = [p for p in BRACKET.split(remark) if p != '']
    clauses = []
    for p in parts:
        if p.startswith('［'):
            clauses.append(('bracket', p))
        else:
            for c in re.split(r'[、／]', p):
                if c.strip():
                    clauses.append(('text', c.strip()))

    for kind, clause in clauses:
        if kind == 'bracket':
            leftover.append(_expand_parens_and_brackets(clause, pools, all_names, unresolved))
            stats['bracket'] += 1
            continue
        # センターなし
        if re.match(r'^[CＣ][:：]?\s*(なし|無し|不在)', clause):
            rest = re.sub(r'^[CＣ][:：]?\s*(なし|無し|不在)', 'センターなし', clause)
            leftover.append(_expand_parens_and_brackets(rest, pools, all_names, unresolved))
            stats['centerless'] += 1
            continue
        m = C_HEAD.match(clause)
        if m:
            body = m.group(1).strip()
            # 矢印（センター交代）: C丹生→小坂
            if '→' in body:
                sides = ARROW_SPLIT.split(body)
                exp = [expand_token(s, pools, all_names) for s in sides]
                if all(exp):
                    centers_found.append(' → '.join(exp))
                    stats['arrow_center'] += 1
                    continue
            toks = [t.strip() for t in body.split('・')]
            names, roles, bad = [], [], False
            for t in toks:
                base, suffix = _split_paren_suffix(t)
                e = expand_token(base, pools, all_names)
                if e:
                    names.append(e + suffix)
                    continue
                r = _expand_role_token(base, pools, all_names)
                if r:
                    roles.append((r[1] if r[0] is None else f'{r[0]}：{r[1]}') + suffix)
                    continue
                bad = True
                unresolved[t] += 1
            if not bad and names:
                centers_found.append('・'.join(names))
                leftover.extend(roles)
                stats['center_from_remark'] += 1
                continue
            # 展開しきれないC節はそのまま（C略称だけ展開を試みる）
            leftover.append(_expand_inplace(clause, pools, all_names, unresolved))
            stats['c_leftover'] += 1
            continue
        # 純粋な名前リスト節
        if '・' in clause and not re.search(r'[ぁ-んァ-ヶa-zA-Z]{3,}.*(は|が|を|に|の|と|へ|から|まで|より)', clause):
            got = _expand_list(clause, pools, all_names, unresolved)
            if got:
                if set(got) == set(track.get('perf') or []):
                    stats['dup_list_dropped'] += 1
                    continue
                if (not track.get('perf') and not centers_found and not track.get('center')
                        and all(g in all_names for g in got)):
                    track['perf'] = got
                    pools[0] = got
                    stats['list_to_perf'] += 1
                    continue
                leftover.append('・'.join(got))
                stats['list_expanded'] += 1
                continue
        # 役割語＋名前だけの節（例: ボーカル純奈、歌い出し久保）
        if '・' not in clause:
            r = _expand_role_token(clause, pools, all_names)
            if r:
                leftover.append(r[1] if r[0] is None else f'{r[0]}：{r[1]}')
                stats['role_clause'] += 1
                continue
        # それ以外の節：括弧内とC略称・リスト・助詞に囲まれた略称をその場展開
        new = _expand_parens_and_brackets(clause, pools, all_names, unresolved)
        new = _expand_inplace(new, pools, all_names, unresolved)
        new = _expand_standalone(new, pools, all_names)
        leftover.append(new)
        stats['other'] += 1

    # センターの反映
    if centers_found:
        joined = centers_found[0] if len(centers_found) == 1 else '・'.join(centers_found)
        if not track.get('center'):
            track['center'] = joined
        elif track['center'] != joined:
            have = {c.strip() for c in re.split(r'[・→]', track['center'])}
            found = {c.strip() for c in re.split(r'[・→]', joined)}
            if found <= have:
                stats['center_covered'] += 1  # 既存センターに含まれる情報なので備考に残さない
            else:
                leftover.append('センター：' + joined)
                stats['center_conflict'] += 1
    new_remark = '、'.join([c for c in leftover if c])
    if new_remark != remark:
        if new_remark:
            track['remark'] = new_remark
        else:
            track.pop('remark', None)
        stats['changed'] += 1


def build_group_members(members):
    """グループ名 → その group に所属歴のあるメンバー名リスト。"""
    from collections import defaultdict
    g = defaultdict(list)
    for m in members:
        for gr in (m.get('groups') or [m.get('group')]):
            g[gr].append(m['name'])
    return g


def normalize_show(detail, group, members, group_members, all_names, unresolved, stats,
                   date=None, activity=None):
    set_context(date, activity)
    show_perf = set()
    for s in detail.get('setlist', []):
        show_perf.update(s.get('perf') or [])
        if s.get('center'):
            for c in re.split(r'[・→]', s['center']):
                show_perf.add(c.strip())
        rk = s.get('remark') or ''
        for n in all_names:
            if n in rk:
                show_perf.add(n)
    gm = group_members.get(group, [])
    for s in detail.get('setlist', []):
        normalize_track(s, show_perf, gm, all_names, unresolved, stats)
