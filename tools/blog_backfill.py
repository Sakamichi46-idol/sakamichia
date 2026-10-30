# -*- coding: utf-8 -*-
"""過去ブログの段階取り込み。
公式サイトのメンバー別ブログ一覧を新しい順にたどり、未登録の記事を年別データへ追加する。
- 乃木坂46: 一覧カード（タイトル/日付/サムネイル）。写真一覧は詳細ページが必要なため imgn=0 で登録し、後段フェーズで補完する。
- 日向坂46: 一覧ページに本文・写真が含まれるため、写真一覧まで一括で取得できる。
- 卒業メンバーの一覧は公式側で空になっているため、対象は現行メンバーの一覧に限る。
状態は tools/blog-backfill-state.json に保持し、1回の実行では budget_pages 件までの一覧ページを処理する。
"""
import json, os, re, time, urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_PATH = os.path.join(BASE, 'tools', 'blog-backfill-state.json')
UA = {'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'}
SLEEP = 1.5

def fetch(url):
    import sys, time
    t0 = time.time()
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read().decode('utf-8', 'ignore')
    if os.environ.get('BF_DEBUG'):
        print(f'fetch {time.time()-t0:.1f}s {len(data)}B {url[:90]}', file=sys.stderr, flush=True)
    return data

def load_store():
    idx = json.load(open(os.path.join(BASE, 'data/blogs/index.json')))
    years = {}
    for y in idx['years']:
        years[y] = json.load(open(os.path.join(BASE, f'data/blogs/y{y}.json')))
    imgs = {}
    for y in idx['years']:
        p = os.path.join(BASE, f'data/blog-imgs/y{y}.json')
        imgs[y] = json.load(open(p)) if os.path.exists(p) else {}
    return idx, years, imgs

# 櫻坂46・日向坂46・欅坂46のリレーブログは個人ブログに統合されたため、公式側に
# リレーの印が残っていない。ユーザー指定の期間×期生メンバーで series を付ける。
# (group, series, 世代メンバー名集合 or None=そのグループの期で判定, 開始日, 終了日)
RELAY_WINDOWS = [
    # 乃木坂46の3期生は2018-02-21までリレーブログ（個人ブログ開始は2018-02-22）。
    # 公式統合分は series 付きで取り込まれているが、外部アーカイブ復元分には印が無い。
    ('乃木坂46', '3期生リレーブログ', None, 3, '2016-12-19', '2018-02-21'),
    ('櫻坂46', '櫻坂46三期生リレーブログ', None, 3, '2023-03-07', '2023-10-06'),
    ('櫻坂46', '櫻坂46四期生リレーブログ', None, 4, '2025-06-16', '2025-09-30'),
    ('欅坂46', '欅坂46新二期生リレーブログ',
     {'遠藤光莉', '大園玲', '大沼晶保', '幸阪茉里乃', '増本綺良', '守屋麗奈'}, None, '2020-04-06', '2020-06-28'),
    ('日向坂46', '日向坂46新三期生リレーブログ',
     {'髙橋未来虹', '森本茉莉', '山口陽世'}, None, '2020-04-06', '2020-06-28'),
    ('日向坂46', '日向坂46四期生リレーブログ', None, 4, '2022-10-26', '2023-08-09'),
    ('日向坂46', '日向坂46五期生リレーブログ', None, 5, '2025-04-08', '2025-09-30'),
]
_roster_cache = None


def _roster():
    global _roster_cache
    if _roster_cache is None:
        _roster_cache = json.load(open(os.path.join(BASE, 'data/members.json'), encoding='utf-8'))
    return _roster_cache


def _gen_of(group, name):
    for m in _roster():
        if m['name'] == name and group in (m.get('groups') or [m.get('group')]):
            return m.get('gen')
    return None


def apply_relay_windows(years):
    """統合済みリレーブログの投稿に series を付ける（未設定のものだけ）。"""
    tagged = 0
    for lst in years.values():
        for b in lst:
            if b.get('series'):
                continue
            for group, series, names, gen, start, end in RELAY_WINDOWS:
                if b['group'] != group or not (start <= b['date'] <= end):
                    continue
                if names is not None:
                    if b['member'] not in names:
                        continue
                elif _gen_of(group, b['member']) != gen:
                    continue
                b['series'] = series
                tagged += 1
                break
    return tagged


def save_store(idx, years, imgs, dirty_years):
    apply_relay_windows(years)
    for y in dirty_years:
        lst = sorted(years[y], key=lambda b: (b['date'], b.get('time') or '00:00'), reverse=True)
        years[y] = lst
        json.dump(lst, open(os.path.join(BASE, f'data/blogs/y{y}.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        json.dump(imgs.get(y, {}), open(os.path.join(BASE, f'data/blog-imgs/y{y}.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
        idx['years'][y] = len(lst)
    for y in list(idx['years']):
        if idx['years'][y] == 0:
            del idx['years'][y]
            for f in (f'data/blogs/y{y}.json', f'data/blog-imgs/y{y}.json'):
                fp = os.path.join(BASE, f)
                if os.path.exists(fp):
                    os.remove(fp)
    counts = {}
    myears = {}
    for y, lst in years.items():
        for b in lst:
            k = f"{b['group']}|{b['member']}"
            counts[k] = counts.get(k, 0) + 1
            # メンバー（著者名）別・シリーズ別の年別件数。ブログ画面の年チップ表示に使う
            for key in {b['member'], b.get('series')}:
                if key:
                    d = myears.setdefault(key, {})
                    d[str(y)] = d.get(str(y), 0) + 1
    idx['memberCounts'] = counts
    idx['memberYears'] = myears
    idx['total'] = sum(idx['years'].values())
    json.dump(idx, open(os.path.join(BASE, 'data/blogs/index.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

def url_key(url):
    m = re.search(r'(nogizaka46\.com|sakurazaka46\.com|hinatazaka46\.com|keyakizaka46\.com)/.*?detail/(\d+)', url or '')
    return f'{m.group(1)}:{m.group(2)}' if m else (url or '')

# ---------- 乃木坂46 ----------
def nogi_seed(state):
    h = fetch('https://www.nogizaka46.com/s/n46/diary/MEMBER')
    codes = sorted(set(re.findall(r'MEMBER/list\?[^"]*?ct=(\d+)', h)))
    members = state.setdefault('nogi', {'members': {}})['members']
    for ct in codes:
        members.setdefault(ct, {'name': '', 'next_page': 1, 'done': False})
    return len(codes)

def nogi_page(ct, page):
    h = fetch(f'https://www.nogizaka46.com/s/n46/diary/MEMBER/list?ct={ct}&page={page - 1}')
    name = ''
    m = re.search(r'class="[^"]*f--head[^"]*">([^<]+?) 公式ブログ</p>', h)
    if m:
        name = m.group(1).strip()
    posts = []
    for c in re.findall(r'<a class="bl--card.*?</a>', h, re.S):
        dm = re.search(r'diary/detail/(\d+)', c)
        tm = re.search(r'bl--card__ttl">(.*?)</p>', c, re.S)
        dtm = re.search(r'bl--card__date">\s*([0-9]{4})\.([0-9]{2})\.([0-9]{2})', c)
        sm = re.search(r'data-src="([^"]+)"', c)
        if not (dm and tm and dtm):
            continue
        posts.append({
            'detail': dm.group(1),
            'title': re.sub(r'<[^>]+>', '', tm.group(1)).strip(),
            'date': f'{dtm.group(1)}-{int(dtm.group(2)):02d}-{int(dtm.group(3)):02d}',
            'thumb': sm.group(1) if sm and 'none.png' not in sm.group(1) else None,
            'imgs': None,
            'url': f'https://www.nogizaka46.com/s/n46/diary/detail/{dm.group(1)}',
        })
    return name, posts

# ---------- 日向坂46 ----------
def hina_seed(state):
    h = fetch('https://www.hinatazaka46.com/s/official/diary/member')
    pairs = re.findall(r'diary/member/list\?[^"]*?ct=(\d+)', h)
    members = state.setdefault('hina', {'members': {}})['members']
    for ct in sorted(set(pairs)):
        # ct=000 はマスコットのポカ。除外するとポカの記事が一切取り込まれないため含める
        members.setdefault(ct, {'name': '', 'next_page': 1, 'done': False})
    return len(members)

def hina_page(ct, page):
    h = fetch(f'https://www.hinatazaka46.com/s/official/diary/member/list?ct={ct}&page={page - 1}')
    posts = []
    blocks = re.split(r'<div class="p-blog-article">', h)[1:]
    for b in blocks:
        tm = re.search(r'c-blog-article__title">\s*(.*?)\s*</div>', b, re.S)
        dtm = re.search(r'c-blog-article__date">\s*([0-9]{4})\.([0-9]{1,2})\.([0-9]{1,2})(?:\s+([0-9]{1,2}):([0-9]{2}))?', b)
        nm = re.search(r'c-blog-article__name">\s*(.*?)\s*</div>', b, re.S)
        dm = re.search(r'diary/detail/(\d+)', b)
        if not (tm and dtm and dm):
            continue
        imgs = []
        for u in re.findall(r'<img\s+src="(https://[^"]*?(?:moblog|cdn\.hinatazaka46\.com/files/)[^"]+)"', b):
            if u not in imgs:
                imgs.append(u)
        url = f'https://www.hinatazaka46.com/s/official/diary/detail/{dm.group(1)}'
        posts.append({
            'detail': dm.group(1),
            'title': re.sub(r'<[^>]+>', '', tm.group(1)).strip(),
            'date': f'{dtm.group(1)}-{int(dtm.group(2)):02d}-{int(dtm.group(3)):02d}',
            'member': (nm.group(1) if nm else '').replace(' ', '').replace('　', ''),
            'thumb': imgs[0] if imgs else None,
            'time': f'{int(dtm.group(4)):02d}:{dtm.group(5)}' if dtm.group(4) else None,
            'imgs': imgs,
            'url': url,
            'blocks': extract_body_blocks(url, b),
        })
    return posts


# ---------- 櫻坂46 ----------
def saku_seed(state):
    h = fetch('https://sakurazaka46.com/s/s46/diary/blog/list')
    codes = sorted(set(re.findall(r'blog/list\?[^"]*?ct=(\d+)', h)))
    members = state.setdefault('saku', {'members': {}})['members']
    for ct in codes:
        members.setdefault(ct, {'name': '', 'next_page': 1, 'done': False})
    return len(members)

def saku_page(ct, page):
    h = fetch(f'https://sakurazaka46.com/s/s46/diary/blog/list?ct={ct}&page={page - 1}')
    posts = []
    for b in re.findall(r'<li class="box"><a href="/s/s46/diary/detail/(\d+)[^"]*">(.*?)</a>', h, re.S):
        detail, inner = b
        tm = re.search(r'<h3 class="title">(.*?)</h3>', inner, re.S)
        dtm = re.search(r'<p class="date[^"]*">([0-9]{4})/([0-9]{1,2})/([0-9]{1,2})</p>', inner)
        nm = re.search(r'<p class="name">(.*?)</p>', inner, re.S)
        sm = re.search(r'background-image: url\((https://[^)]+moblog[^)]+)\)', inner)
        if not (tm and dtm):
            continue
        posts.append({
            'detail': detail,
            'title': re.sub(r'<[^>]+>', '', tm.group(1)).strip(),
            'date': f'{dtm.group(1)}-{int(dtm.group(2)):02d}-{int(dtm.group(3)):02d}',
            'member': (nm.group(1) if nm else '').replace(' ', '').replace('　', ''),
            'thumb': sm.group(1) if sm else None,
            'imgs': None,
            'url': f'https://sakurazaka46.com/s/s46/diary/detail/{detail}',
        })
    return posts

SITES = {
    'nogi': {'seed': nogi_seed, 'group': lambda date, member: '乃木坂46', 'id_prefix': 'n46'},
    'saku': {'seed': saku_seed, 'group': lambda date, member: '欅坂46' if date < '2020-10-14' else '櫻坂46', 'id_prefix': 's46'},
    'hina': {'seed': hina_seed, 'group': lambda date, member: 'けやき坂46' if date < '2019-03-27' else '日向坂46', 'id_prefix': 'hina'},
}

MOBLOG = re.compile(r'https://[^"\'\s<>]+moblog[^"\'\s<>]+\.(?:jpg|jpeg|png)', re.I)

def extract_detail_imgs(url):
    return extract_detail(url)[0]


_DT_RE = re.compile(r'(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{2})')


def detail_datetime(html, want_date=None):
    fallback = None
    for m in _DT_RE.finditer(html or ''):
        d = f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'
        t = f'{int(m.group(4)):02d}:{m.group(5)}'
        if want_date is None or d == want_date:
            return t
        if fallback is None:
            fallback = t
    return fallback


def extract_detail(url, want_date=None):
    try:
        html = fetch(url)
        return extract_imgs_scoped(url, html), detail_datetime(html, want_date), extract_body_blocks(url, html)
    except Exception:
        return [], None, []


# ---------- 本文の抽出と保存 ----------
# 本文は公式記事ページの本文コンテナから blocks 形式（paragraph/break/image）で保存する。
# 旧サイト保存分（sourceなし）とは区別し、source='official' を付ける。既存ファイルは上書きしない。
import html as _html_lib
from urllib.parse import urljoin as _urljoin

BODIES_DIR = os.path.join(BASE, 'data', 'bodies')
_BODY_MARKERS = (
    ('nogizaka46.com', 'class="bd--edit"'),
    ('sakurazaka46.com', 'class="box-article"'),
    ('keyakizaka46.com', 'class="box-article"'),
    ('hinatazaka46.com', 'c-blog-article__text'),
)


def _slice_div(html, open_idx):
    """open_idx の <div> の内側HTMLを、divの入れ子を数えて切り出す。"""
    gt = html.find('>', open_idx)
    if gt < 0:
        return ''
    start = gt + 1
    depth = 1
    for m in re.finditer(r'<div\b|</div\s*>', html[start:]):
        if m.group(0).startswith('</'):
            depth -= 1
            if depth == 0:
                return html[start:start + m.start()]
        else:
            depth += 1
    return html[start:]


_IMG_TAG_RE = re.compile(r'<img[^>]+src="([^"]+)"[^>]*>', re.I)


def html_to_blocks(inner, base_url):
    """本文コンテナのHTMLを blocks 形式へ変換する。
    改行・空白は元のまま保持する（ユーザー指定：勝手に減らさない）。
    1つの改行は段落内の改行として保持し、空行は break ブロックとして
    個数をそのまま（上限なしで）記録する。文字のある行は、行頭・行末の
    空白（全角スペースや &nbsp; を含む）を切り取らずにそのまま格納する。
    空白だけの行は空行として数える（全角スペースだけの行も、公式の
    見た目では空白行のため）。"""
    imgs = []

    def _sub(m):
        imgs.append(_urljoin(base_url, m.group(1).replace('&amp;', '&')))
        return f'\x01{len(imgs) - 1}\x01'

    s = _IMG_TAG_RE.sub(_sub, inner)
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = re.sub(r'</p\s*>|<p[^>]*>', '\n\n', s, flags=re.I)
    s = re.sub(r'<[^>]+>', '', s)
    s = _html_lib.unescape(s)
    blocks = []
    cur = []      # 現在の段落の行
    pending = 0   # 段落の間にある空行の数

    def flush_para():
        nonlocal cur
        text = '\n'.join(cur)
        cur = []
        if text.strip():
            blocks.append({'type': 'paragraph', 'text': text})

    def close_gap():
        nonlocal pending
        flush_para()
        if blocks and pending:
            for _ in range(pending):
                blocks.append({'type': 'break'})
        pending = 0

    for raw in s.split('\n'):
        line = raw.rstrip('\r')
        if not line.strip():
            pending += 1
            continue
        for part in re.split(r'(\x01\d+\x01)', line):
            if part.startswith('\x01') and part.endswith('\x01') and part[1:-1].isdigit():
                close_gap()
                blocks.append({'type': 'image', 'src': imgs[int(part[1:-1])], 'alt': ''})
            elif part.strip():
                if pending:
                    close_gap()
                cur.append(part)
            elif part and cur:
                # 画像の前後などにある空白だけの断片は、直前の行の末尾に付けて保持する
                cur[-1] += part
    flush_para()
    text_len = sum(len(b.get('text', '')) for b in blocks if b['type'] == 'paragraph')
    if text_len < 5 and not any(b['type'] == 'image' for b in blocks):
        return []
    return blocks


def extract_body_blocks(url, html):
    """詳細ページ全体（または日向坂の一覧ブロック断片）から本文 blocks を抽出する。"""
    if not html:
        return []
    marker = next((mk for dom, mk in _BODY_MARKERS if dom in url), None)
    if not marker:
        return []
    i = html.find(marker)
    if i < 0:
        return []
    open_idx = html.rfind('<div', 0, i)
    if open_idx < 0:
        return []
    return html_to_blocks(_slice_div(html, open_idx), url)


def save_body(rec, blocks):
    """本文ファイルが無い場合だけ保存し、rec['body'] を立てる。既存（旧サイト保存分）は守る。"""
    if not blocks:
        return False
    os.makedirs(BODIES_DIR, exist_ok=True)
    path = os.path.join(BODIES_DIR, rec['id'] + '.json')
    if os.path.exists(path):
        rec['body'] = True
        return False
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'blocks': blocks, 'source': 'official'}, f, ensure_ascii=False)
    rec['body'] = True
    return True

_MOBLOG_PAT = re.compile(r'(?:https://[^"\'\s<>]+)?/[^"\'\s<>]*moblog[^"\'\s<>]*\.(?:jpg|jpeg|png)', re.I)
_PRE_PAT = re.compile(r'/files/46/_pre/blog/[^"\'\s<>]+\.(?:jpg|jpeg|png)', re.I)
# 櫻坂46の新しい写真は /images/14/<dir>/<hash>(-NN).jpg 形式（moblogでない）で配信される
_IMAGES14_PAT = re.compile(r'/images/14/[0-9a-f]{3}/[0-9a-f]+(?:-\d+)?\.(?:jpg|jpeg|png)', re.I)

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
        hits = []
        for pat in (_MOBLOG_PAT, _IMAGES14_PAT):
            for m in pat.finditer(seg):
                hits.append((m.start(), m.group(0)))
        out = []
        for _, u0 in sorted(hits):
            u = urljoin(url, u0)
            if u not in out:
                out.append(u)
        return out
    if 'hinatazaka46.com' in url:
        # 本文コンテナ内に限れば、その記事自身の写真だけを文書順に取得できる
        i = html.find('c-blog-article__text')
        if i >= 0:
            open_idx = html.rfind('<div', 0, i)
            if open_idx >= 0:
                seg = _slice_div(html, open_idx)
                out = []
                for m in _MOBLOG_PAT.finditer(seg):
                    u = urljoin(url, m.group(0))
                    if u not in out:
                        out.append(u)
                if out:
                    return out
        m = re.search(r'property="og:image" content="([^"]+)"', html)
        return [m.group(1)] if m else []
    out = []
    for m in _MOBLOG_PAT.finditer(html):
        u = urljoin(url, m.group(0))
        if u not in out:
            out.append(u)
    return out

# ---------- 乃木坂46リレーブログの著者判定 ----------
# 詳細ページの見出しは「タイトル 著者名」の形式で著者が明示される。それで決まらない場合は
# 本文の自己紹介・署名パターン（旧サイトの判定方針を踏襲）で同・期生の範囲から一意に決める。
# 決まらない記事は著者を推測せず、リレーブログ名義のまま取り込む。
import unicodedata
_NOGI_ROSTER = None
_RELAY_ALIAS = {'川崎桜': '川﨑桜', '伊藤々杏': '伊藤理々杏'}

def _nogi_roster():
    global _NOGI_ROSTER
    if _NOGI_ROSTER is None:
        _NOGI_ROSTER = {}
        try:
            members = json.load(open(os.path.join(BASE, 'data/members.json'), encoding='utf-8'))
            for m in members:
                if '乃木坂46' in (m.get('groups') or [m.get('group')]):
                    _NOGI_ROSTER[m['name']] = m.get('gen') or 0
        except Exception:
            pass
    return _NOGI_ROSTER

def _norm(s):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', str(s or '')))

def series_name(raw):
    n = _norm(raw)
    m = re.fullmatch(r'(新)?([0-9]+)期生', n)
    if m:
        return f"{'新' if m.group(1) else ''}{m.group(2)}期生リレーブログ"
    return n + 'リレーブログ'

def series_gen(raw):
    n = _norm(raw)
    m = re.search(r'([0-9]+)期生', n)
    return int(m.group(1)) if m else 0

def _plain(html):
    h = re.sub(r'<script.*?</script>', '', html, flags=re.S)
    h = re.sub(r'<style.*?</style>', '', h, flags=re.S)
    return _norm(re.sub(r'<[^>]+>', ' ', h))

def resolve_relay_author(html, title, gen):
    roster = _nogi_roster()
    names = [n for n, g in roster.items() if g == gen]
    variants = {}
    for n in names:
        variants[_norm(n)] = n
    for a, o in _RELAY_ALIAS.items():
        if o in names:
            variants[_norm(a)] = o
    # 1) 見出し「タイトル 著者名」
    m = re.search(r'<h1 class="bd--hd__ttl[^"]*">(.*?)</h1>', html, re.S)
    if m:
        h1 = _norm(re.sub(r'<[^>]+>', '', m.group(1)))
        t0 = _norm(title)
        hits = [v for k, v in variants.items() if h1 == t0 + k]
        if len(set(hits)) == 1:
            return hits[0]
        hits = [v for k, v in variants.items() if h1.endswith(k) and len(h1) > len(k)]
        if len(set(hits)) == 1:
            return hits[0]
    # 2) 本文の自己紹介・署名（冒頭と末尾だけを見る）
    text = _plain(html)
    windows = [text[:900], text[-500:]]
    found = set()
    for k, v in variants.items():
        a = re.escape(k)
        pats = (
            rf'(?:担当は|今日は|本日は|今回の担当は|私は|わたしは|僕は|名前は).{{0,30}}?{a}(?:です|と申します|といいます)',
            rf'{a}(?:です|と申します|といいます|でした|より|からでした)',
        )
        if any(re.search(pt, w) for w in windows for pt in pats):
            found.add(v)
    if len(found) == 1:
        return next(iter(found))
    return ''


def clean_relay_title(title, gen, author=''):
    """リレー記事のタイトル末尾に付く著者名（公式の表示形式）を取り除く。"""
    t0 = (title or '').strip()
    cands = [author] if author else [n for n, g in _nogi_roster().items() if g == gen]
    for n in cands:
        if n and t0.endswith(n) and len(t0) > len(n):
            rest = t0[:len(t0) - len(n)].strip(' 　')
            if rest:
                return rest
    return t0

def relay_detail(p, gen):
    """リレー記事の詳細を取得し、(著者名 or '', 写真リスト, 時刻, 本文) を返す。"""
    try:
        html = fetch(p['url'])
    except Exception:
        return '', [], None, []
    author = resolve_relay_author(html, p['title'], gen)
    photos = extract_imgs_scoped(p['url'], html)
    return author, photos, detail_datetime(html, p['date']), extract_body_blocks(p['url'], html)

GENERIC_AUTHOR = re.compile(r'運営スタッフ|スタッフ|研究生|.+期生')


def _feed_cards(site, page):
    """全メンバー横断の新着一覧（フィード）をパースする。page は1始まり。"""
    posts = []
    if site == 'nogi':
        h = fetch(f'https://www.nogizaka46.com/s/n46/diary/MEMBER/list?page={page - 1}')
        for c in re.findall(r'<a class="bl--card.*?</a>', h, re.S):
            dm = re.search(r'diary/detail/(\d+)', c)
            tm = re.search(r'bl--card__ttl">(.*?)</p>', c, re.S)
            dtm = re.search(r'bl--card__date">\s*([0-9]{4})\.([0-9]{1,2})\.([0-9]{1,2})', c)
            sm = re.search(r'data-src="([^"]+)"', c)
            if not (dm and tm and dtm):
                continue
            posts.append({'detail': dm.group(1),
                          'title': re.sub(r'<[^>]+>', '', tm.group(1)).strip(),
                          'date': f'{dtm.group(1)}-{int(dtm.group(2)):02d}-{int(dtm.group(3)):02d}',
                          'member': '', 'imgs': None,
                          'thumb': sm.group(1) if sm and 'none.png' not in sm.group(1) else None,
                          'url': f'https://www.nogizaka46.com/s/n46/diary/detail/{dm.group(1)}'})
    elif site == 'saku':
        h = fetch(f'https://www.sakurazaka46.com/s/s46/diary/blog/list?page={page - 1}')
        for detail, inner in re.findall(r'<li class="box"><a href="/s/s46/diary/detail/(\d+)[^"]*">(.*?)</a>', h, re.S):
            tm = re.search(r'<h3 class="title">(.*?)</h3>', inner, re.S)
            dtm = re.search(r'<p class="date[^"]*">([0-9]{4})/([0-9]{1,2})/([0-9]{1,2})</p>', inner)
            nm = re.search(r'<p class="name">(.*?)</p>', inner, re.S)
            sm = re.search(r'background-image: url\((https://[^)]+moblog[^)]+)\)', inner)
            if not (tm and dtm):
                continue
            posts.append({'detail': detail,
                          'title': re.sub(r'<[^>]+>', '', tm.group(1)).strip(),
                          'date': f'{dtm.group(1)}-{int(dtm.group(2)):02d}-{int(dtm.group(3)):02d}',
                          'member': (nm.group(1) if nm else '').replace(' ', '').replace('　', ''),
                          'imgs': None, 'thumb': sm.group(1) if sm else None,
                          'url': f'https://sakurazaka46.com/s/s46/diary/detail/{detail}'})
    else:
        h = fetch(f'https://www.hinatazaka46.com/s/official/diary/member/list?page={page - 1}')
        for b in re.split(r'<div class="p-blog-article">', h)[1:]:
            tm = re.search(r'c-blog-article__title">\s*(.*?)\s*</div>', b, re.S)
            dtm = re.search(r'c-blog-article__date">\s*([0-9]{4})\.([0-9]{1,2})\.([0-9]{1,2})(?:\s+([0-9]{1,2}):([0-9]{2}))?', b)
            nm = re.search(r'c-blog-article__name">\s*(.*?)\s*</div>', b, re.S)
            dm = re.search(r'diary/detail/(\d+)', b)
            if not (tm and dtm and dm):
                continue
            imgs = []
            for u in re.findall(r'<img\s+src="(https://[^"]*?(?:moblog|cdn\.hinatazaka46\.com/files/)[^"]+)"', b):
                if u not in imgs:
                    imgs.append(u)
            url = f'https://www.hinatazaka46.com/s/official/diary/detail/{dm.group(1)}'
            posts.append({'detail': dm.group(1),
                          'title': re.sub(r'<[^>]+>', '', tm.group(1)).strip(),
                          'date': f'{dtm.group(1)}-{int(dtm.group(2)):02d}-{int(dtm.group(3)):02d}',
                          'member': (nm.group(1) if nm else '').replace(' ', '').replace('　', ''),
                          'imgs': imgs,
                          'time': f'{int(dtm.group(4)):02d}:{dtm.group(5)}' if dtm.group(4) else None, 'thumb': imgs[0] if imgs else None,
                          'url': url,
                          'blocks': extract_body_blocks(url, b)})
    return posts


def _nogi_detail_info(url):
    """乃木坂の詳細ページヘッダー（○○ 公式ブログ）から著者名と写真・本文を取得する。"""
    try:
        html = fetch(url)
    except Exception:
        return '', [], None, []
    m = re.search(r'MEMBER/list\?[^"]*ct=\d+">([^<]+?)\s*公式ブログ</a>', html)
    name = m.group(1).replace(' ', '').replace('　', '') if m else ''
    return name, extract_imgs_scoped(url, html), detail_datetime(html), extract_body_blocks(url, html)


def feed_newest_pass(max_pages=3):
    """高頻度チェック用: 3グループの新着フィードだけを見て未登録記事を取り込む（軽量）。
    乃木坂フィードのカードには著者が載らないため詳細ヘッダーで著者を確定する。
    乃木坂リレーはフィードで著者が判らないため、リレー各コードの1ページ目も確認する。
    全メンバー巡回は毎朝の newest_pass が担う。"""
    state = json.load(open(STATE_PATH)) if os.path.exists(STATE_PATH) else {}
    idx, years, imgs = load_store()
    known = {}
    for lst in years.values():
        for b in lst:
            known[url_key(b['url'])] = b
    added, dirty, pages_used = [], set(), 0

    def register(site, p, member, plist, series=None, title=None, tm=None, blocks=None):
        cfg = SITES[site]
        rec = {'id': f"ofc-{cfg['id_prefix']}-{p['detail']}",
               'group': cfg['group'](p['date'], member),
               'member': member, 'date': p['date'], 'title': title if title is not None else p['title'],
               'url': p['url'], 'media': 0, 'body': False,
               'thumb': p['thumb'] or (plist[0] if plist else None),
               'imgn': len(plist)}
        if blocks:
            save_body(rec, blocks)
        if tm:
            rec['time'] = tm
        if series:
            rec['series'] = series
        y = p['date'][:4]
        years.setdefault(y, []).append(rec)
        if y not in idx['years']:
            idx['years'][y] = 0
        if plist:
            imgs.setdefault(y, {})[rec['id']] = plist
        known[url_key(p['url'])] = rec
        dirty.add(y)
        added.append(rec)

    for site in ('nogi', 'saku', 'hina'):
        for page in range(1, max_pages + 1):
            try:
                posts = _feed_cards(site, page)
            except Exception:
                posts = None
            pages_used += 1
            time.sleep(SLEEP)
            if not posts:
                break
            new_here = 0
            for p in posts:
                if url_key(p['url']) in known:
                    continue
                if site == 'nogi':
                    name, plist, tm, blocks = _nogi_detail_info(p['url'])
                    time.sleep(SLEEP)
                    if not name or GENERIC_AUTHOR.fullmatch(name):
                        continue
                    register(site, p, name, plist, tm=tm, blocks=blocks)
                elif site == 'saku':
                    if not p['member'] or GENERIC_AUTHOR.fullmatch(p['member']):
                        continue
                    plist, tm, blocks = extract_detail(p['url'], p['date'])
                    time.sleep(SLEEP)
                    register(site, p, p['member'], plist or [], tm=tm, blocks=blocks)
                else:
                    if not p['member'] or GENERIC_AUTHOR.fullmatch(p['member']):
                        continue
                    register(site, p, p['member'], p['imgs'] or [], tm=p.get('time'), blocks=p.get('blocks'))
                new_here += 1
            if new_here == 0:
                break
    # ポカ（ct=000）は全体フィードの一覧に載らないため、専用一覧の1ページ目も確認する
    try:
        poka_posts = hina_page('000', 1)
    except Exception:
        poka_posts = None
    pages_used += 1
    time.sleep(SLEEP)
    if poka_posts:
        for p in poka_posts:
            if url_key(p['url']) in known:
                continue
            if not p['member'] or GENERIC_AUTHOR.fullmatch(p['member']):
                continue
            register('hina', p, p['member'], p['imgs'] or [], tm=p.get('time'), blocks=p.get('blocks'))
    relay_members = state.get('nogi', {}).get('members', {})
    for ct, ms in relay_members.items():
        if not ms.get('relay'):
            continue
        try:
            _, posts = nogi_page(ct, 1)
        except Exception:
            posts = None
        pages_used += 1
        time.sleep(SLEEP)
        if not posts:
            continue
        for p in posts:
            if url_key(p['url']) in known:
                continue
            sname = series_name(ms['name'])
            author, plist, rtime, blocks = relay_detail(p, series_gen(ms['name']))
            time.sleep(SLEEP)
            register('nogi', p, author or sname, plist, series=sname, tm=rtime, blocks=blocks,
                     title=clean_relay_title(p['title'], series_gen(ms['name']), author))
    if dirty:
        save_store(idx, years, imgs, dirty)
    return {'added': added, 'pages_used': pages_used}


def newest_pass(max_extra_pages=3):
    """各メンバーの最新ページを確認し、未登録の新着記事を公式サイトから直接取り込む。
    旧サイトの公開データに依存しない、サカミチア独自の新着取り込み。"""
    state = json.load(open(STATE_PATH)) if os.path.exists(STATE_PATH) else {}
    idx, years, imgs = load_store()
    known = {}
    for lst in years.values():
        for b in lst:
            known[url_key(b['url'])] = b
    added = []
    dirty = set()
    pages_used = 0
    for site, cfg in SITES.items():
        if not state.get(site, {}).get('seeded'):
            continue
        for ct, ms in state[site]['members'].items():
            if ms.get('skip'):
                continue
            page = 1
            while page <= max_extra_pages:
                try:
                    if site == 'nogi':
                        name, posts = nogi_page(ct, page)
                        if name and not ms['name']:
                            ms['name'] = name.replace(' ', '').replace('　', '')
                    elif site == 'saku':
                        posts = saku_page(ct, page)
                    else:
                        posts = hina_page(ct, page)
                except Exception:
                    posts = None
                pages_used += 1
                time.sleep(SLEEP)
                if not posts:
                    break
                new_here = 0
                for p in posts:
                    if ms.get('relay'):
                        key = url_key(p['url'])
                        if key in known:
                            continue
                        sname = series_name(ms['name'])
                        author, plist, rtime, blocks = relay_detail(p, series_gen(ms['name']))
                        time.sleep(SLEEP)
                        member = author or sname
                        rec = {'id': f"ofc-{cfg['id_prefix']}-{p['detail']}",
                               'group': cfg['group'](p['date'], member),
                               'member': member, 'series': sname,
                               'date': p['date'], 'title': clean_relay_title(p['title'], series_gen(ms['name']), author),
                               'url': p['url'], 'media': 0, 'body': False,
                               'thumb': p['thumb'] or (plist[0] if plist else None),
                               'imgn': len(plist)}
                        if blocks:
                            save_body(rec, blocks)
                        if rtime:
                            rec['time'] = rtime
                        y = p['date'][:4]
                        years.setdefault(y, []).append(rec)
                        if y not in idx['years']:
                            idx['years'][y] = 0
                        if plist:
                            imgs.setdefault(y, {})[rec['id']] = plist
                        known[key] = rec
                        dirty.add(y)
                        new_here += 1
                        added.append(f"{rec['date']} {rec['group']} {rec['member']}「{rec['title']}」")
                        continue
                    author = p.get('member') or ms['name']
                    if re.fullmatch(r'運営スタッフ|スタッフ|研究生|.+期生', author or ''):
                        continue
                    key = url_key(p['url'])
                    if key in known:
                        rec = known[key]
                        if not rec.get('thumb') and p['thumb']:
                            rec['thumb'] = p['thumb']
                            dirty.add(rec['date'][:4])
                        # 日向坂: 一覧ブロックの写真リストが保存分より完全なら差し替える
                        if p.get('time') and not rec.get('time'):
                            rec['time'] = p['time']
                            dirty.add(rec['date'][:4])
                        if p['imgs'] and len(p['imgs']) > (rec.get('imgn') or 0):
                            yy = rec['date'][:4]
                            imgs.setdefault(yy, {})[rec['id']] = p['imgs']
                            rec['imgn'] = len(p['imgs'])
                            dirty.add(yy)
                        if p.get('blocks') and not rec.get('body'):
                            if save_body(rec, p['blocks']):
                                dirty.add(rec['date'][:4])
                        continue
                    plist = p['imgs'] or []
                    tm = p.get('time')
                    blocks = p.get('blocks')
                    if site in ('nogi', 'saku'):
                        got, tm2, blocks2 = extract_detail(p['url'], p['date'])
                        time.sleep(SLEEP)
                        if got:
                            plist = got
                        if tm2:
                            tm = tm2
                        if blocks2:
                            blocks = blocks2
                    rec = {'id': f"ofc-{cfg['id_prefix']}-{p['detail']}",
                           'group': cfg['group'](p['date'], author),
                           'member': author, 'date': p['date'], 'title': p['title'],
                           'url': p['url'], 'media': 0, 'body': False,
                           'thumb': p['thumb'] or (plist[0] if plist else None),
                           'imgn': len(plist)}
                    if blocks:
                        save_body(rec, blocks)
                    if tm:
                        rec['time'] = tm
                    y = p['date'][:4]
                    years.setdefault(y, []).append(rec)
                    if y not in idx['years']:
                        idx['years'][y] = 0
                    if plist:
                        imgs.setdefault(y, {})[rec['id']] = plist
                    known[key] = rec
                    dirty.add(y)
                    new_here += 1
                    added.append(f"{rec['date']} {rec['group']} {rec['member']}「{rec['title']}」")
                if new_here == 0:
                    break
                page += 1
    if dirty:
        save_store(idx, years, imgs, dirty)
    json.dump(state, open(STATE_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return {'added': added, 'pages_used': pages_used}

def run(budget_pages=120):
    state = json.load(open(STATE_PATH)) if os.path.exists(STATE_PATH) else {}
    idx, years, imgs = load_store()
    known = {}
    for lst in years.values():
        for b in lst:
            known[url_key(b['url'])] = b
    added = []
    repaired = 0
    dirty = set()
    for site, cfg in SITES.items():
        if not state.get(site, {}).get('seeded'):
            n = cfg['seed'](state)
            state[site]['seeded'] = True
            state[site]['seeded_count'] = n
    pages_used = 0
    # サイト間を巡回しながら少しずつ進める（1サイトだけが予算を使い切らないように）
    active = {site: [ct for ct, ms in state[site]['members'].items() if not ms['done'] and not ms.get('skip')]
              for site in SITES}
    while pages_used < budget_pages and any(active.values()):
        for site, cfg in SITES.items():
            if pages_used >= budget_pages:
                break
            queue = active[site]
            while queue and pages_used < budget_pages:
                ct = queue[0]
                ms = state[site]['members'][ct]
                page = ms['next_page']
                try:
                    if site == 'nogi':
                        name, posts = nogi_page(ct, page)
                        if name and not ms['name']:
                            ms['name'] = name.replace(' ', '').replace('　', '')
                    elif site == 'saku':
                        posts = saku_page(ct, page)
                    else:
                        posts = hina_page(ct, page)
                except Exception:
                    posts = None
                pages_used += 1
                time.sleep(SLEEP)
                if posts is None:
                    break
                if not posts:
                    ms['empty_count'] = ms.get('empty_count', 0) + 1
                    if ms['empty_count'] >= 2:
                        ms['done'] = True
                        queue.pop(0)
                    break
                ms['empty_count'] = 0
                for p in posts:
                    if ms.get('relay'):
                        key = url_key(p['url'])
                        if key in known:
                            continue
                        sname = series_name(ms['name'])
                        author, plist, rtime, blocks = relay_detail(p, series_gen(ms['name']))
                        time.sleep(SLEEP)
                        member = author or sname
                        rec = {'id': f"ofc-{cfg['id_prefix']}-{p['detail']}",
                               'group': cfg['group'](p['date'], member),
                               'member': member, 'series': sname,
                               'date': p['date'], 'title': clean_relay_title(p['title'], series_gen(ms['name']), author),
                               'url': p['url'], 'media': 0, 'body': False,
                               'thumb': p['thumb'] or (plist[0] if plist else None),
                               'imgn': len(plist)}
                        if blocks:
                            save_body(rec, blocks)
                        if rtime:
                            rec['time'] = rtime
                        y = p['date'][:4]
                        years.setdefault(y, []).append(rec)
                        if y not in idx['years']:
                            idx['years'][y] = 0
                        if plist:
                            imgs.setdefault(y, {})[rec['id']] = plist
                        known[key] = rec
                        dirty.add(y)
                        added.append(f"{rec['date']} {rec['group']} {rec['member']}「{rec['title']}」")
                        continue
                    # 運営スタッフなど個人でない著者は登録しない（旧サイトと同じ方針。リレーは上の分岐で処理）
                    _author = p.get('member') or ms['name']
                    if re.fullmatch(r'運営スタッフ|スタッフ|研究生|.+期生', _author or ''):
                        continue
                    key = url_key(p['url'])
                    if key in known:
                        rec = known[key]
                        if not rec.get('thumb') and p['thumb']:
                            rec['thumb'] = p['thumb']
                            dirty.add(rec['date'][:4])
                            repaired += 1
                        if p.get('time') and not rec.get('time'):
                            rec['time'] = p['time']
                            dirty.add(rec['date'][:4])
                        if p['imgs'] and len(p['imgs']) > (rec.get('imgn') or 0):
                            yy = rec['date'][:4]
                            imgs.setdefault(yy, {})[rec['id']] = p['imgs']
                            rec['imgn'] = len(p['imgs'])
                            dirty.add(yy)
                        if p.get('blocks') and not rec.get('body'):
                            if save_body(rec, p['blocks']):
                                dirty.add(rec['date'][:4])
                        continue
                    member = p.get('member') or ms['name']
                    plist = p['imgs'] or []
                    tm = p.get('time')
                    blocks = p.get('blocks')
                    if site in ('nogi', 'saku'):
                        got, tm2, blocks2 = extract_detail(p['url'], p['date'])
                        time.sleep(SLEEP)
                        if got:
                            plist = got
                        if tm2:
                            tm = tm2
                        if blocks2:
                            blocks = blocks2
                    rec = {'id': f"ofc-{cfg['id_prefix']}-{p['detail']}",
                           'group': cfg['group'](p['date'], member),
                           'member': member, 'date': p['date'], 'title': p['title'],
                           'url': p['url'], 'media': 0, 'body': False,
                           'thumb': p['thumb'] or (plist[0] if plist else None), 'imgn': len(plist)}
                    if blocks:
                        save_body(rec, blocks)
                    if tm:
                        rec['time'] = tm
                    y = p['date'][:4]
                    years.setdefault(y, []).append(rec)
                    if y not in idx['years']:
                        idx['years'][y] = 0
                    if plist:
                        imgs.setdefault(y, {})[rec['id']] = plist
                    known[key] = rec
                    dirty.add(y)
                    added.append(f"{rec['date']} {rec['group']} {rec['member']}「{rec['title']}」")
                ms['next_page'] = page + 1
                break  # 1ページ処理したら次のサイトへ
            # このサイトの先頭メンバーが終わっていたら次へ（queueはpop済み）
    if dirty:
        save_store(idx, years, imgs, dirty)
    json.dump(state, open(STATE_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    progress = {}
    for site in SITES:
        ms = state[site]['members']
        progress[site] = {'members_done': sum(1 for v in ms.values() if v['done']), 'members_total': len(ms)}
    return {'added': added, 'repaired': repaired, 'pages_used': pages_used, 'progress': progress,
            'complete': all(v['members_done'] == v['members_total'] for v in progress.values())}

def run_relay(budget_pages=200):
    """乃木坂46リレーブログ専用の取り込み（著者判定つき）。"""
    state = json.load(open(STATE_PATH)) if os.path.exists(STATE_PATH) else {}
    idx, years, imgs = load_store()
    known = {}
    for lst in years.values():
        for b in lst:
            known[url_key(b['url'])] = b
    added = []
    dirty = set()
    pages_used = 0
    cfg = SITES['nogi']
    members = state.get('nogi', {}).get('members', {})
    queue = [ct for ct, ms in members.items() if ms.get('relay') and not ms['done']]
    while pages_used < budget_pages and queue:
        for ct in list(queue):
            if pages_used >= budget_pages:
                break
            ms = members[ct]
            page = ms['next_page']
            try:
                name, posts = nogi_page(ct, page)
            except Exception:
                posts = None
            pages_used += 1
            time.sleep(SLEEP)
            if posts is None:
                continue
            if not posts:
                ms['empty_count'] = ms.get('empty_count', 0) + 1
                if ms['empty_count'] >= 2:
                    ms['done'] = True
                    queue.remove(ct)
                continue
            ms['empty_count'] = 0
            sname = series_name(ms['name'])
            gen = series_gen(ms['name'])
            for p in posts:
                key = url_key(p['url'])
                if key in known:
                    continue
                author, plist, rtime, blocks = relay_detail(p, gen)
                time.sleep(SLEEP)
                member = author or sname
                rec = {'id': f"ofc-{cfg['id_prefix']}-{p['detail']}",
                       'group': cfg['group'](p['date'], member),
                       'member': member, 'series': sname,
                       'date': p['date'], 'title': clean_relay_title(p['title'], gen, author),
                       'url': p['url'], 'media': 0, 'body': False,
                       'thumb': p['thumb'] or (plist[0] if plist else None),
                       'imgn': len(plist)}
                if blocks:
                    save_body(rec, blocks)
                if rtime:
                    rec['time'] = rtime
                y = p['date'][:4]
                years.setdefault(y, []).append(rec)
                if y not in idx['years']:
                    idx['years'][y] = 0
                if plist:
                    imgs.setdefault(y, {})[rec['id']] = plist
                known[key] = rec
                dirty.add(y)
                added.append(f"{rec['date']} {rec['member']}「{rec['title']}」")
            ms['next_page'] = page + 1
    if dirty:
        save_store(idx, years, imgs, dirty)
    json.dump(state, open(STATE_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    progress = {ct: {'name': members[ct]['name'], 'next_page': members[ct]['next_page'], 'done': members[ct]['done']}
                for ct in members if members[ct].get('relay')}
    return {'added': added, 'pages_used': pages_used, 'progress': progress}

if __name__ == '__main__':
    import sys
    budget = int(sys.argv[1]) if len(sys.argv) > 1 else 25
    r = run(budget)
    print(json.dumps({'added_count': len(r['added']), 'pages_used': r['pages_used'],
                      'progress': r['progress'], 'complete': r['complete'],
                      'sample': r['added'][:5]}, ensure_ascii=False, indent=1))
