#!/usr/bin/env python3
"""サカミチア データ自動更新スクリプト

出典: Sakamichi Universe オープンデータ (meaning-of-goodbye.com/sakamichi-search/)
      Google Sheets CSV エクスポートを毎回取得して差分を取り込む。

ルール:
- ライブ: 開催済み（公演日 < 今日・JST）のみ追加。【中止】公演は追加しない。
  既存公演は一切変更しない（坂道日和由来の検証済みセンター/出演者を保持するため）。
- 楽曲: CSVに新規追加された曲を取り込む。センターはフォーメーションCSVの
  センターフラグから補完（既存値は上書きしない。手動上書き指定は最後に再適用）。
- フォーメーション: 公式発表分（既存データで official=true）は保持し、それ以外は
  CSVの最新データで再構築する。行0のみの曲は歌唱メンバー一覧として取り込む。
- メンバー: 差分があれば報告のみ（名簿は旧サイト由来データが正）。

出力: 変更内容のJSONサマリーを標準出力に表示。変更があれば配布用ZIPも生成する。
"""
import csv, datetime, json, os, re, sys, urllib.parse, urllib.request, zipfile
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import name_expand as nx  # 備考の略称（C影山など）をフルネーム化する共通処理
import build_live_index as bli  # 曲名・メンバー検索の索引

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(BASE, 'tools', '.universe-cache')
WS = os.path.expanduser('~/workspace')
TODAY = datetime.now(ZoneInfo('Asia/Tokyo')).strftime('%Y-%m-%d')

SHEETS = {
    'main': 'https://docs.google.com/spreadsheets/d/13nV17Gm9z5kITFnfsXOLsN9BO476KWjlh9RclSBzU-w/gviz/tq?tqx=out:csv&sheet=',
    'Nset': 'https://docs.google.com/spreadsheets/d/1DTmlTKMhkiEeiPmVng1uRJEDp1og7KzoN-HMMW3m8V4/gviz/tq?tqx=out:csv&sheet=',
    'Sset': 'https://docs.google.com/spreadsheets/d/1wz5EUR3tMZQLXts-5ExOdEEc_qrWSGsPKfjjHKEFh0I/gviz/tq?tqx=out:csv&sheet=',
    'Hset': 'https://docs.google.com/spreadsheets/d/1_76VitLQL6GrHracWOZVuPUGgPKsRlKqgQPo4DuwNBs/gviz/tq?tqx=out:csv&sheet=',
    'Nform': 'https://docs.google.com/spreadsheets/d/1511n4YNUdSZD_xDM81dpdUkPaO91Frgxu4FQU-TcfIE/gviz/tq?tqx=out:csv&sheet=',
    'Sform': 'https://docs.google.com/spreadsheets/d/1ZXyo5k47wvrRS_XIcbkfPsj7I8DLOfxH9MBzK46kxyg/gviz/tq?tqx=out:csv&sheet=',
    'Hform': 'https://docs.google.com/spreadsheets/d/1XghzjFFhcQyMM-9LWfVeRtiS1K9xYMGbNI9kyIf-260/gviz/tq?tqx=out:csv&sheet=',
}
FILES = {
    'Nmember': 'main', 'Smember': 'main', 'Hmember': 'main',
    'Nsongs': 'main', 'Ssongs': 'main', 'Hsongs': 'main',
    'Nwriter': 'main', 'Narranger': 'main', 'Swriter': 'main', 'Sarranger': 'main',
    'Hwriter': 'main', 'Harranger': 'main',
    'Nsetlist': 'Nset', 'Nlive_remarks': 'Nset',
    'Ssetlist': 'Sset', 'Slive_remarks': 'Sset',
    'Hsetlist': 'Hset', 'Hlive_remarks': 'Hset',
    'Nformation': 'Nform', 'Sformation': 'Sform', 'Hformation': 'Hform',
}
CENTER_OVERRIDES = {'太陽ノック': '生駒里奈', '五月雨よ': '田村保乃'}
GROUP_PREFIX = {'乃木坂46': 'nogi', '櫻坂46': 'sakura', '欅坂46': 'keyaki', '日向坂46': 'hinata', 'けやき坂46': 'hiragana'}
FAM_OF_PREFIX = {'nogi': 'N', 'sakura': 'S', 'keyaki': 'S', 'hinata': 'H', 'hiragana': 'H'}

def fetch_all():
    os.makedirs(CACHE, exist_ok=True)
    for name, book in FILES.items():
        url = SHEETS[book] + name
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
        with open(os.path.join(CACHE, name + '.csv'), 'wb') as f:
            f.write(data)

def rows(name):
    with open(os.path.join(CACHE, name + '.csv'), encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))

def norm(s):
    return (s or '').replace(' ', '').replace('　', '')

def song_yomi(reading):
    """楽曲シートの reading（「本読み、略称」形式）から本読みだけを取り、ひらがなに統一する。"""
    r = (reading or '').split('、')[0].strip()
    r = re.sub(r'^[！!？?・〜~\s]+|[！!？?・〜~\s]+$', '', r)
    return ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in r)

def clean_genre(g):
    return re.sub(r'^\d+', '', (g or '').strip())

def live_group(fam, date):
    if fam == 'N':
        return '乃木坂46'
    if fam == 'S':
        return '欅坂46' if date <= '2020-10-13' else '櫻坂46'
    return 'けやき坂46' if date <= '2019-02-28' else '日向坂46'

def update_lives(summary):
    lp = os.path.join(BASE, 'data/lives.json')
    lives = json.load(open(lp))
    have = defaultdict(set)
    for l in lives:
        p = l['id'].split('-')
        have[FAM_OF_PREFIX[p[0]]].add(p[1])
    remarks = {}
    for fam, fn in [('N', 'Nlive_remarks'), ('S', 'Slive_remarks'), ('H', 'Hlive_remarks')]:
        for r in rows(fn):
            remarks[(fam, r['liveid'])] = r
    members = json.load(open(os.path.join(BASE, 'data/members.json')))
    all_names = set(m['name'] for m in members)
    group_members = nx.build_group_members(members)

    def _iso(d):
        p = (d or '').strip().split('-')
        return f'{int(p[0]):04d}-{int(p[1]):02d}-{int(p[2]):02d}' if len(p) == 3 else None

    activity = {}
    for fn in ('Nmember', 'Smember', 'Hmember'):
        for r in rows(fn):
            name = (r.get('name1') or '').strip()
            join, grad = _iso(r.get('joindate')), _iso(r.get('graduatedate'))
            if name and join:
                if name in activity:
                    old = activity[name]
                    join = min(join, old[0])
                    grad = None if (grad is None or old[1] is None) else max(grad, old[1])
                activity[name] = (join, grad)
    added = []
    for fam, fn in [('N', 'Nsetlist'), ('S', 'Ssetlist'), ('H', 'Hsetlist')]:
        byshow = defaultdict(list)
        for r in rows(fn):
            byshow[r['liveid']].append(r)
        for lid, tracks in byshow.items():
            if lid in have[fam]:
                continue
            head = tracks[0]
            date = head['livedate']
            if date >= TODAY:
                continue
            if '【中止】' in head['liveseries']:
                continue
            group = live_group(fam, date)
            prefix = GROUP_PREFIX[group]
            sid = f"{prefix}-{lid}-{date}-{head['starttime']}".replace(':', '')
            tags = []
            for g in [clean_genre(head.get('livegenre2')), clean_genre(head.get('livegenre'))]:
                if g and g not in tags:
                    tags.append(g)
            if group == '乃木坂46':
                # 乃木坂の「真夏の全国ツアー」は「全国ツアー」にまとめる（ユーザー指定）
                tags = ['/'.join('全国ツアー' if seg == '真夏の全国ツアー' else seg
                                 for seg in t.split('/')) for t in tags]
                tags = list(dict.fromkeys(tags))
            lives.append({'id': sid, 'date': date, 'group': group, 'title': head['liveseries'],
                          'venue': head['stage'], 'region': head['region'], 'tags': tags,
                          'songCount': len(tracks), 'time': head['starttime']})
            sl = []
            for r in sorted(tracks, key=lambda x: int(x['kyokume'])):
                n = int(r['kyokume'])
                sec = 'main' if n < 100 else ('encore' if n < 200 else 'double')
                item = {'sec': sec, 'title': r['title']}
                if r.get('remark'):
                    item['remark'] = r['remark']
                sl.append(item)
            det = {'id': sid, 'setlist': sl}
            rk = remarks.get((fam, lid))
            if rk:
                if rk.get('live_remarks'):
                    det['note'] = rk['live_remarks']
                if rk.get('reference_url'):
                    det['ref'] = rk['reference_url']
            # 備考の略称をフルネーム化（C〜はセンターとして取り出す。同姓は公演日の在籍で判別）
            nx.normalize_show(det, group, members, group_members, all_names, Counter(), Counter(),
                              date=date, activity=activity)
            with open(os.path.join(BASE, 'data/shows', sid + '.json'), 'w', encoding='utf-8') as f:
                json.dump(det, f, ensure_ascii=False, separators=(',', ':'))
            added.append(f"{date} {group} {head['liveseries']}")
    if added:
        json.dump(lives, open(lp, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    if added or not os.path.exists(os.path.join(BASE, 'data/live-index.json')):
        bli.write_index(BASE)
        summary['live_index'] = 'rebuilt'
    summary['lives_added'] = added
    summary['lives_total'] = len(lives)

def song_type(genre):
    g = (genre or '').split(':', 1)[-1].split('：', 1)[-1]
    if '表題曲' in g:
        return '表題曲'
    if 'アンダー' in g:
        return 'アンダー曲'
    if 'ユニット' in g:
        return 'ユニット曲'
    if '期別' in g:
        return '期別曲'
    if 'ソロ' in g:
        return 'ソロ曲'
    if 'BACKS' in g:
        return 'BACKS曲'
    if '選抜曲' in g:
        return 'カップリング曲（選抜・全員）'
    return g.replace('/', '・').replace('ほか', '')

def build_formations():
    out = {}
    for sf, ff, mf in [('Nsongs', 'Nformation', 'Nmember'), ('Ssongs', 'Sformation', 'Smember'), ('Hsongs', 'Hformation', 'Hmember')]:
        songs = {r['songid']: r for r in rows(sf)}
        mem = {r['mid']: r['name1'] for r in rows(mf)}
        by = defaultdict(list)
        for r in rows(ff):
            by[r['songid']].append(r)
        for sid, rs in by.items():
            title = songs.get(sid, {}).get('title')
            if not title:
                continue
            rowmap = defaultdict(list)
            for r in rs:
                rowmap[r['row']].append(r)
            centers = [c for c in (mem.get(r['mid'], '') for r in rs if r['center'] in ('1', '2')) if c]
            if set(rowmap.keys()) == {'0'}:
                vocal = [v for v in (mem.get(r['mid'], '') for r in sorted(rs, key=lambda x: int(x['position']))) if v]
                if vocal:
                    out[norm(title)] = {'vocal': vocal, 'centers': centers}
                else:
                    remark = next((r.get('remark') for r in rs if r.get('remark')), '')
                    if remark:
                        out[norm(title)] = {'note': remark.replace('　', ' '), 'centers': centers}
            else:
                ordered = []
                for rk in sorted(rowmap, key=lambda x: int(x)):
                    ordered.append([v for v in (mem.get(m['mid'], '') for m in sorted(rowmap[rk], key=lambda x: int(x['position']))) if v])
                ordered = [r for r in ordered if r]
                ordered.reverse()
                if ordered:
                    out[norm(title)] = {'rows': ordered, 'centers': centers}
    return out

KEEP_FORMATIONS = {'坂道選抜|Audition', '坂道AKB|誰のことを一番 愛してる？', '坂道AKB|国境のない時代', '坂道AKB|初恋ドア'}

def update_songs_and_formations(summary):
    sp = os.path.join(BASE, 'data/songs.json')
    songs = json.load(open(sp))
    by_title = {norm(s['title']): s for s in songs}
    csv_forms = build_formations()
    readings = {}
    for sf in ['Nsongs', 'Ssongs', 'Hsongs']:
        for r in rows(sf):
            if r.get('title') and r.get('reading'):
                readings[norm(r['title'])] = song_yomi(r['reading'])
    writers, arrangers = defaultdict(list), defaultdict(list)
    for sf, wf, af in [('Nsongs', 'Nwriter', 'Narranger'), ('Ssongs', 'Swriter', 'Sarranger'), ('Hsongs', 'Hwriter', 'Harranger')]:
        s_map = {r['songid']: r['title'] for r in rows(sf)}
        for r in rows(wf):
            if s_map.get(r['songid']):
                writers[norm(s_map[r['songid']])].append(r['writer'])
        for r in rows(af):
            if s_map.get(r['songid']):
                arrangers[norm(s_map[r['songid']])].append(r['arranger'])
    group_of_col = {'KZ': '欅坂46', 'SZ': '櫻坂46', 'HK': 'けやき坂46', 'HZ': '日向坂46', 'WK': '欅坂46', 'SP': '坂道AKB'}
    added = []
    for sf in ['Nsongs', 'Ssongs', 'Hsongs']:
        for r in rows(sf):
            t = norm(r['title'])
            if not t or t == 'その他' or r.get('release') == 'others':
                continue
            if t in by_title:
                continue
            if sf == 'Nsongs':
                group, sid = '乃木坂46', f"N-{r['songid']}"
                special = ''
            else:
                col = r.get('group') or ''
                if col == 'ZZ':
                    continue
                group = group_of_col.get(col)
                if not group:
                    continue
                sid = f"{'S' if sf == 'Ssongs' else 'H'}-{col}{int(r.get('serial') or r['songid']):03d}"
                special = '坂道合同' if col == 'WK' else ''
            date = (r.get('releasedate') or '').replace('/', '-')
            parts = date.split('-')
            if len(parts) == 3 and parts[1].isdigit() and parts[2].isdigit():
                date = f"{parts[0]}-{int(parts[1]):02d}-{int(parts[2]):02d}"
            entry = {'id': sid, 'title': r['title'], 'group': group,
                     'year': int(date[:4]) if date[:4].isdigit() else 0, 'date': date,
                     'type': song_type(r.get('genre')), 'center': '', 'release': r.get('release') or '',
                     'writers': writers.get(t, []), 'arrangers': arrangers.get(t, []),
                     'ord': None, 'genre': r.get('genre') or '', 'yomi': song_yomi(r.get('reading'))}
            if special:
                entry['special'] = special
            f = csv_forms.get(t)
            if f and f['centers']:
                entry['center'] = '・'.join(dict.fromkeys(c for c in f['centers'] if c))
            songs.append(entry)
            by_title[t] = entry
            added.append(f"{date} {group} {r['title']}")
    filled = 0
    for s in songs:
        if not s.get('center'):
            f = csv_forms.get(norm(s['title']))
            if f and f['centers']:
                c = '・'.join(dict.fromkeys(x for x in f['centers'] if x))
                if c:
                    s['center'] = c
                    filled += 1
    for title, center in CENTER_OVERRIDES.items():
        s = by_title.get(norm(title))
        if s:
            s['center'] = center
    # センター表記を名簿の正式表記に統一する（川崎桜→川﨑桜などの異体字ゆれ対策）
    _VAR = {'﨑': '崎', '神': '神', '髙': '高', '邊': '辺', '邉': '辺', '齋': '斉', '齊': '斉', '澤': '沢', '眞': '真', '櫻': '桜', '檜': '桧', '嶋': '島', '瀨': '瀬', '惠': '恵', '寬': '寛', '增': '増', '榮': '栄', '龍': '竜', '學': '学', '舘': '館', '德': '徳', '內': '内', '綠': '緑', '緖': '緒', '啟': '啓', '祿': '禄'}
    def _nn(s):
        return ''.join(_VAR.get(c, c) for c in s.replace(' ', '').replace('　', ''))
    _roster = [m['name'] for m in json.load(open(os.path.join(BASE, 'data/members.json'), encoding='utf-8'))]
    _nmap = {}
    for _n in _roster:
        _nmap.setdefault(_nn(_n), []).append(_n)
    for s in songs:
        if s.get('center'):
            _toks = []
            for _t in s['center'].split('・'):
                _tt = _t.strip()
                if _tt not in _roster and len(_nmap.get(_nn(_tt), [])) == 1:
                    _toks.append(_nmap[_nn(_tt)][0])
                else:
                    _toks.append(_t)
            s['center'] = '・'.join(_toks)
    for s in songs:
        if not s.get('yomi') and readings.get(norm(s['title'])):
            s['yomi'] = readings[norm(s['title'])]
    json.dump(songs, open(sp, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    summary['songs_added'] = added
    summary['centers_filled'] = filled
    summary['songs_total'] = len(songs)
    fp = os.path.join(BASE, 'data/formations.json')
    old = json.load(open(fp))
    newf = {}
    kept_official = 0
    for key, v in old.items():
        if v.get('official') or key in KEEP_FORMATIONS:
            newf[key] = v
            kept_official += 1
    changed = 0
    for s in songs:
        key = f"{s['group']}|{s['title']}"
        if key in newf:
            continue
        f = csv_forms.get(norm(s['title']))
        if not f:
            continue
        entry = {}
        if f.get('rows'):
            entry['rows'] = f['rows']
        if f.get('vocal'):
            entry['vocal'] = f['vocal']
        if f.get('note'):
            entry['note'] = f['note']
        if not entry:
            continue
        entry['official'] = False
        if old.get(key) != entry:
            changed += 1
        newf[key] = entry
    json.dump(newf, open(fp, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    summary['formations_total'] = len(newf)
    summary['formations_updated'] = changed
    summary['formations_official_kept'] = kept_official
    # カップリング曲（選抜・全員）の振り分け: 歌唱人数と当時の在籍人数から判定
    def _pd(d):
        if not d:
            return None
        pp = d.replace('/', '-').split('-')
        return f"{pp[0]}-{int(pp[1]):02d}-{int(pp[2]):02d}" if len(pp) == 3 else None
    _rosters = {}
    for _fam, _fn in [('N', 'Nmember'), ('S', 'Smember'), ('H', 'Hmember')]:
        _rosters[_fam] = [(_pd(r['joindate']), _pd(r['graduatedate'])) for r in rows(_fn)]
    _FAM = {'乃木坂46': 'N', '欅坂46': 'S', '櫻坂46': 'S', 'けやき坂46': 'H', '日向坂46': 'H'}
    _ALL = {'W-KEYAKIZAKAの詩', '太陽は見上げる人を選ばない'}
    for s in songs:
        if s.get('type') != 'カップリング曲（選抜・全員）':
            continue
        if s['title'] in _ALL:
            s['type'] = 'カップリング曲（全員）'
            continue
        _f = csv_forms.get(norm(s['title'])) or {}
        _n = len([x for r in _f.get('rows', []) for x in r]) or len(_f.get('vocal', []))
        _r = sum(1 for j, g in _rosters[_FAM[s['group']]] if j and s['date'] and j <= s['date'] and (not g or g > s['date']))
        s['type'] = 'カップリング曲（全員）' if (_r and _n / _r >= 0.75) else 'カップリング曲（選抜）'
    json.dump(songs, open(sp, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    mp = os.path.join(BASE, 'data/members.json')
    members = json.load(open(mp))
    mynames = {m['name'] for m in members}
    csv_members = {}
    for fn in ['Nmember', 'Smember', 'Hmember']:
        for r in rows(fn):
            csv_members[r['name1']] = r
    notes = []
    for name in csv_members:
        if name not in mynames:
            notes.append(f"名簿に未登録: {name}")
    for m in members:
        r = csv_members.get(m['name'])
        if r and bool(r.get('graduatedate')) != bool(m.get('graduated')):
            notes.append(f"卒業状態の差分: {m['name']} (CSV卒業日: {r.get('graduatedate') or 'なし'})")
    summary['member_notes'] = notes
    for m in members:
        m['centerSongs'] = [s['title'] for s in sorted(
            (s for s in songs if s.get('center') and m['name'] in s['center'].split('・')),
            key=lambda s: (s.get('date') or '', s.get('ord') or 0, s['title']))]
    json.dump(members, open(mp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return bool(added) or filled > 0 or changed > 0


OLD_SITE = 'https://sakamichi-biyori.pages.dev'
MOBLOG = re.compile(r'https://[^"\'\s<>]+moblog[^"\'\s<>]+\.(?:jpg|jpeg|png)', re.I)
GROUP_JP = {'nogi': '乃木坂46', 'sakura': '櫻坂46', 'hinata': '日向坂46', 'keyaki': '欅坂46', 'hiragana': 'けやき坂46'}

def fetch_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

def extract_imgs(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'})
        with urllib.request.urlopen(req, timeout=25) as r:
            html = r.read().decode('utf-8', 'ignore')
        return extract_imgs_scoped(url, html)
    except Exception:
        return None

_MOBLOG_PAT = re.compile(r'(?:https://[^"\'\s<>]+)?/[^"\'\s<>]*moblog[^"\'\s<>]*\.(?:jpg|jpeg|png)', re.I)
_PRE_PAT = re.compile(r'/files/46/_pre/blog/[^"\'\s<>]+\.(?:jpg|jpeg|png)', re.I)

def extract_imgs_scoped(url, html):
    """公式記事ページから、その記事自身の写真だけを抽出する。
    詳細ページには他記事の写真モジュールが含まれるため、グループごとに本文範囲へ限定する。
    乃木坂46: 最新記事モジュール(bd--ne)より前、moblog＋移行データ(_pre)の両方。
    櫻坂46: フッター(blog-foot)より前。写真は相対パスなので絶対化する。
    日向坂46: 詳細ページは写真モジュールと混ざるため og:image（先頭写真）のみを返す。"""
    from urllib.parse import urljoin
    html = html.replace('&amp;', '&')
    if 'nogizaka46.com' in url:
        cut = html.find('bd--ne')
        seg = html[:cut] if cut > 0 else html
        hits = []
        for pat in (_MOBLOG_PAT, _PRE_PAT):
            for m in pat.finditer(seg):
                hits.append((m.start(), m.group(0)))
        out = []
        for _, u0 in sorted(hits):
            u = urljoin(url, u0)
            if u not in out:
                out.append(u)
        return out
    if 'sakurazaka46.com' in url:
        cut = html.find('blog-foot')
        seg = html[:cut] if cut > 0 else html
        out = []
        for m in _MOBLOG_PAT.finditer(seg):
            u = urljoin(url, m.group(0))
            if u not in out:
                out.append(u)
        return out
    if 'hinatazaka46.com' in url:
        m = re.search(r'property="og:image" content="([^"]+)"', html)
        return [m.group(1)] if m else []
    out = []
    for m in _MOBLOG_PAT.finditer(html):
        u = urljoin(url, m.group(0))
        if u not in out:
            out.append(u)
    return out

def update_blogs(summary):
    import blog_backfill as bf
    idx, years, imgs = bf.load_store()
    by_id = {}
    for lst in years.values():
        for b in lst:
            by_id[b['id']] = b
    try:
        remote = fetch_json(OLD_SITE + '/blog/data/articles.json')
        approved = fetch_json(OLD_SITE + '/blog/data/public-approved.json').get('articles', {})
    except Exception as e:
        summary['blogs_error'] = str(e)
        return False
    recs = remote.get('articles', remote if isinstance(remote, list) else [])
    changed = False
    added = []
    dirty = set()
    for r in recs:
        if not r.get('metadata_approved_for_public_display'):
            continue
        aid = r['id']
        info = approved.get(aid, {})
        if aid not in by_id:
            b = {'id': aid, 'group': GROUP_JP.get(r.get('group'), r.get('group') or ''),
                 'member': (r.get('member') or '').replace(' ', '').replace('　', ''),
                 'date': (r.get('date') or '')[:10], 'title': r.get('title') or '',
                 'url': r.get('official') or '', 'media': 0, 'body': False, 'thumb': None, 'imgn': 0}
            _d = r.get('date') or ''
            if len(_d) >= 16:
                b['time'] = _d[11:16]
            got = extract_imgs(b['url']) if b['url'] else []
            y = b['date'][:4]
            if got:
                b['thumb'] = got[0]
                b['imgn'] = len(got)
                imgs.setdefault(y, {})[aid] = got
            years.setdefault(y, []).append(b)
            if y not in idx['years']:
                idx['years'][y] = 0
            by_id[aid] = b
            added.append(f"{b['date']} {b['group']} {b['member']}「{b['title']}」")
            dirty.add(y)
            changed = True
        b = by_id[aid]
        y = b['date'][:4]
        mc = info.get('media_count', 0) if info.get('media_approved') else 0
        if b.get('media') != mc:
            b['media'] = mc
            dirty.add(y)
            changed = True
        want_body = bool(info.get('body_approved'))
        body_path = os.path.join(BASE, 'data/bodies', aid + '.json')
        if want_body and not os.path.exists(body_path):
            try:
                d = fetch_json(OLD_SITE + '/blog/public/body/' + urllib.parse.quote(aid))
                for blk in d.get('blocks', []):
                    if blk.get('type') == 'image' and blk.get('src', '').startswith('/'):
                        blk['src'] = OLD_SITE + blk['src']
                os.makedirs(os.path.dirname(body_path), exist_ok=True)
                json.dump({'blocks': d.get('blocks', [])}, open(body_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
            except Exception:
                want_body = False
        if b.get('body') != want_body:
            b['body'] = want_body
            dirty.add(y)
            changed = True
        _recent = (datetime.now(ZoneInfo('Asia/Tokyo')).date() - timedelta(days=21)).isoformat()
        if not b.get('thumb') and b.get('url') and b.get('date', '') >= _recent:
            got = extract_imgs(b['url'])
            if got:
                b['thumb'] = got[0]
                if len(got) > (b.get('imgn') or 0):
                    b['imgn'] = len(got)
                    imgs.setdefault(y, {})[aid] = got
                dirty.add(y)
                changed = True
            elif b.get('media'):
                media = info.get('media_urls') or []
                if media:
                    b['thumb'] = OLD_SITE + media[0]
                    dirty.add(y)
                    changed = True
    if changed:
        bf.save_store(idx, years, imgs, dirty)
    summary['blogs_added'] = added
    summary['blogs_total'] = idx['total']
    # 公式サイトからの新着チェック（サカミチア独自取り込み）
    try:
        nres = bf.newest_pass()
        if nres['added']:
            changed = True
            summary['newest_added'] = len(nres['added'])
    except Exception as e:
        summary['newest_error'] = str(e)
    # 過去分の段階取り込み
    try:
        bfres = bf.run(budget_pages=120)
        if bfres['added']:
            changed = True
            summary['backfill_added'] = len(bfres['added'])
            summary['backfill_progress'] = bfres['progress']
            summary['backfill_complete'] = bfres['complete']
    except Exception as e:
        summary['backfill_error'] = str(e)
    try:
        summary['blogs_total'] = json.load(open(os.path.join(BASE, 'data/blogs/index.json'), encoding='utf-8'))['total']
    except Exception:
        pass
    return changed

def build_zip():
    versions = []
    for fn in os.listdir(WS):
        m = re.match(r'sakamichia-pages-v(\d+)\.zip', fn)
        if m:
            versions.append(int(m.group(1)))
    nxt = (max(versions) + 1) if versions else 1
    zpath = os.path.join(WS, f'sakamichia-pages-v{nxt}.zip')
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(BASE):
            dirs[:] = [d for d in dirs if d not in ('tools', '__pycache__')]
            for fn in files:
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, BASE)
                z.write(full, rel)
    return zpath

def main():
    # ブログストアの書き込み競合を避けるため、newest_check と共通のロックを取る
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import newest_check
    if not newest_check.acquire_lock(600):
        print(json.dumps({'error': 'store lock busy'}, ensure_ascii=False))
        return
    try:
        _main_inner()
    finally:
        newest_check.release_lock()

def _main_inner():
    fetch_all()
    summary = {}
    update_lives(summary)
    changed = update_songs_and_formations(summary)
    blog_changed = update_blogs(summary)
    has_changes = bool(summary.get('lives_added')) or changed or blog_changed
    summary['changed'] = has_changes
    if has_changes:
        if not os.environ.get('SAKAMICHIA_NO_ZIP'):
            summary['zip'] = build_zip()
    print(json.dumps(summary, ensure_ascii=False, indent=1))

if __name__ == '__main__':
    main()
