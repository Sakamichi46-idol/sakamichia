#!/usr/bin/env python3
"""One-time import of the Keyakizaka46 official blog archive (keyakizaka46.com).

The unified member feed /s/k46o/diary/member/list?ima=0000&page=N&cd=member
embeds full article bodies incl. all photos (like Hinatazaka's list pages),
newest first, 20 posts/page. Crawl to the end; group label:
  - members whose affiliation includes 欅坂46 -> 欅坂46
  - けやき坂46 members -> user rule: date >= 2019-03-27 is 日向坂46 else けやき坂46
Graduated members are retained on this site, so the full era is covered.
Resumable: progress in tools/keyaki-import-state.json.
"""
import sys, os, re, json, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_backfill as bf


def fetch_pc(url):
    # keyakizaka46.com serves a reduced smartphone layout to the iPhone UA
    # that bf.fetch uses; the PC layout embeds full bodies + photos in list cards.
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8', 'ignore')

BASE = bf.BASE
STATE_F = os.path.join(BASE, 'tools/keyaki-import-state.json')
FEED = 'https://www.keyakizaka46.com/s/k46o/diary/member/list?ima=0000&page={}&cd=member'
IMG_PAT = re.compile(r'https://cdn\.keyakizaka46\.com/(?:files/14/diary/[^"\s<>]+|images/14/[0-9a-f]{3}/[0-9a-f]+(?:-\d+)?)\.(?:jpg|jpeg|png)', re.I)
FOLD = {'邉': '辺', '邊': '辺', '齋': '斎', '﨑': '崎', '澤': '沢', '嶋': '島'}


def fold(s):
    s = re.sub(r'\s+', '', s or '')
    return ''.join(FOLD.get(c, c) for c in s)


def roster_map():
    members = json.load(open(os.path.join(BASE, 'data/members.json'), encoding='utf-8'))
    m = {}
    for mem in members:
        m[fold(mem['name'])] = mem
    return m


def group_of(mem, date):
    groups = mem.get('groups') or [mem.get('group')]
    if '欅坂46' in groups:
        return '欅坂46'
    if 'けやき坂46' in groups:
        return '日向坂46' if date >= '2019-03-27' else 'けやき坂46'
    return mem.get('group')


def parse_cards(html):
    out = []
    for a in re.findall(r'<article>(.*?)</article>', html, re.S):
        link = re.search(r'href="(/s/k46o/diary/detail/(\d+)[^"]*)"', a)
        t = re.search(r'<h3>\s*<a[^>]*>(.*?)</a>', a, re.S)
        n = re.search(r'<p class="name">\s*([^<]+?)\s*</p>', a)
        times = re.findall(r'<time>([^<]+)</time>', a)
        if not (link and n and len(times) == 2):
            continue
        ym = re.match(r'(\d{4})\.(\d{1,2})', times[0].strip())
        if not ym:
            continue
        date = f"{ym.group(1)}-{int(ym.group(2)):02d}-{int(times[1].strip()):02d}"
        body = re.search(r'<div class="box-article">(.*)', a, re.S)
        imgs, seen = [], set()
        if body:
            for u in IMG_PAT.findall(body.group(1)):
                if u not in seen:
                    seen.add(u)
                    imgs.append(u)
        title = re.sub(r'<[^>]+>', '', t.group(1)).strip() if t else ''
        out.append({
            'detail': link.group(2),
            'url': 'https://www.keyakizaka46.com' + link.group(1).split('?')[0],
            'title': title,
            'name': re.sub(r'\s+', '', n.group(1)),
            'date': date,
            'imgs': imgs,
        })
    return out


def main():
    state = json.load(open(STATE_F)) if os.path.exists(STATE_F) else {'next_page': 1, 'empty': 0, 'added': 0, 'skipped_dup': 0, 'unknown_authors': {}}
    rmap = roster_map()
    idx, years, imgs = bf.load_store()
    known = {bf.url_key(b['url']) for lst in years.values() for b in lst}
    page = state['next_page']
    SAVE_EVERY = 25
    since_save = 0
    while state['empty'] < 2:
        try:
            html = fetch_pc(FEED.format(page))
        except Exception as e:
            print(f'page {page}: fetch error {e}; retry in 10s', flush=True)
            time.sleep(10)
            try:
                html = fetch_pc(FEED.format(page))
            except Exception as e2:
                print(f'page {page}: failed twice ({e2}); stopping', flush=True)
                break
        cards = parse_cards(html)
        if not cards:
            state['empty'] += 1
            print(f'page {page}: EMPTY ({state["empty"]}/2)', flush=True)
        else:
            state['empty'] = 0
            dirty = set()
            for c in cards:
                key = bf.url_key(c['url'])
                if key in known:
                    state['skipped_dup'] += 1
                    continue
                mem = rmap.get(fold(c['name']))
                if mem is None:
                    state['unknown_authors'][c['name']] = state['unknown_authors'].get(c['name'], 0) + 1
                    continue
                group = group_of(mem, c['date'])
                year = c['date'][:4]
                bid = f"ofc-keya-{c['detail']}"
                years.setdefault(year, []).append({
                    'id': bid, 'group': group, 'member': mem['name'], 'date': c['date'],
                    'title': c['title'], 'url': c['url'],
                    'thumb': c['imgs'][0] if c['imgs'] else None,
                    'imgn': len(c['imgs']), 'body': False, 'media': 0,
                })
                if c['imgs']:
                    imgs.setdefault(year, {})[bid] = c['imgs']
                known.add(key)
                state['added'] += 1
                dirty.add(year)
            if dirty:
                bf.save_store(idx, years, imgs, dirty)
        state['next_page'] = page + 1
        since_save += 1
        if page % 25 == 0:
            print(f'page {page}: added so far {state["added"]}, dup {state["skipped_dup"]}, unknown {state["unknown_authors"]}', flush=True)
            json.dump(state, open(STATE_F, 'w'), ensure_ascii=False)
        page += 1
        time.sleep(1.5)
    json.dump(state, open(STATE_F, 'w'), ensure_ascii=False)
    print(f'DONE page={page} added={state["added"]} dup={state["skipped_dup"]} unknown={state["unknown_authors"]}', flush=True)


if __name__ == '__main__':
    main()
