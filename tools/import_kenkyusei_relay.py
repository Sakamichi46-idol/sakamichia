# -*- coding: utf-8 -*-
"""janelin612/n46-crawler の mb/40006（乃木坂46・研究生＝2期生リレーブログ）を取り込む。

- 対象は2013-07-01〜2015-01-31の467件。著者は tools/kenkyusei-relay-assignments.json
  （datetime → 著者名）で与える。444件はタイトルの署名・本文の名乗り等の証拠から判定し、
  判定できなかった23件はユーザー（寺谷さん）が2026-10-30に全件回答した。
- レコードには series='研究生リレーブログ' を付け、著者からもシリーズからも
  絞り込めるようにする（blog.js のメンバー絞り込みは member / series の両方を見る）。
- 本文は通常の pack_bodies だと未公開の他アーカイブ本文まで巻き込むため、
  この取り込み分だけを pack_bodies.shard_of でシャードへ直接マージする。
"""
import json, os, re, subprocess, sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_backfill as bf
import pack_bodies

BASE = bf.BASE
ROOT = 'https://janelin612.github.io/n46-crawler'
SERIES = '研究生リレーブログ'
NUM_RE = re.compile(r'detail/(\d+)')
ASSIGN_PATH = os.path.join(BASE, 'tools', 'kenkyusei-relay-assignments.json')


def curl_json(url):
    r = subprocess.run(['curl', '-s', '--max-time', '120', url], capture_output=True, timeout=150)
    return json.loads(r.stdout.decode('utf-8'))


def main():
    assign = json.load(open(ASSIGN_PATH, encoding='utf-8'))
    posts = curl_json(f'{ROOT}/mb/40006/result.json')
    if len(posts) != len(assign):
        raise SystemExit(f'件数不一致: posts={len(posts)} assignments={len(assign)}')
    idx, years, imgs = bf.load_store()
    held_nums = set()
    held_keys = set()
    for lst in years.values():
        for b in lst:
            if b['group'] == '乃木坂46':
                mm = NUM_RE.search(b.get('url', ''))
                if mm:
                    held_nums.add(str(int(mm.group(1))))
                held_keys.add((b['member'], b['date'], b['title']))
    added = Counter()
    skipped = 0
    dirty = set()
    new_bodies = {}
    base = f'{ROOT}/mb/40006/'
    for p in posts:
        author = assign.get(p['datetime'])
        if not author:
            raise SystemExit(f"著者割り当てが無い: {p['datetime']} {p['title']}")
        raw_url = p.get('url') or ''
        mm = NUM_RE.search(raw_url)
        num = str(int(mm.group(1))) if mm else None
        dt = (p.get('datetime') or '').replace('.', '-').replace('/', '-')
        parts = dt.split(' ')
        if len(parts) != 2 or not parts[0]:
            print(f'  SKIP (datetime不正): {raw_url}', flush=True)
            continue
        date, time = parts[0], parts[1][:5]
        title = p['title']
        if (num and num in held_nums) or (author, date, title) in held_keys:
            skipped += 1
            continue
        html = re.sub(r'</div\s*>', '\n', p.get('content') or '', flags=re.I)
        blocks = bf.html_to_blocks(html, base)
        img_urls = [b['src'] for b in blocks if b['type'] == 'image']
        if num:
            rid = f'crw-nogi-{num}'
        else:
            import hashlib
            rid = 'crw-nogi-h' + hashlib.md5(f'{SERIES}|{p["datetime"]}|{title}'.encode()).hexdigest()[:10]
        rec = {'id': rid, 'group': '乃木坂46', 'member': author, 'series': SERIES,
               'title': title, 'date': date, 'time': time,
               'url': raw_url if num else '', 'urldead': True,
               'arch': 'n46-crawler', 'media': 0, 'imgn': len(img_urls)}
        if img_urls:
            rec['thumb'] = img_urls[0]
            imgs.setdefault(date[:4], {})[rid] = img_urls
        if blocks:
            rec['body'] = True
            body = {'blocks': blocks, 'source': 'archive'}
            with open(os.path.join(BASE, 'data/bodies', rid + '.json'), 'w', encoding='utf-8') as f:
                json.dump(body, f, ensure_ascii=False, separators=(',', ':'))
            new_bodies[rid] = body
        years.setdefault(date[:4], []).append(rec)
        if num:
            held_nums.add(num)
        held_keys.add((author, date, title))
        added[author] += 1
        dirty.add(date[:4])
    bf.save_store(idx, years, imgs, dirty)
    # 取り込み分だけをシャードへマージ
    shards = {}
    for rid, body in new_bodies.items():
        shards.setdefault(pack_bodies.shard_of(rid), {})[rid] = body
    for shard, entries in shards.items():
        path = os.path.join(BASE, 'data/bodies-pack', shard + '.json')
        cur = {}
        if os.path.exists(path):
            cur = json.load(open(path, encoding='utf-8'))
        cur.update(entries)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(cur, f, ensure_ascii=False, separators=(',', ':'))
    print('added:', dict(added), '| total added:', sum(added.values()),
          '| skipped dup:', skipped, '| bodies:', len(new_bodies),
          '| shards touched:', len(shards), '| store total:', idx['total'])


if __name__ == '__main__':
    main()
