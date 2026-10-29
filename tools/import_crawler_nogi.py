# -*- coding: utf-8 -*-
"""janelin612/n46-crawler（GitHub Pages）の乃木坂46卒業生ブログを取り込む。

使い方: python3 tools/import_crawler_nogi.py [メンバー1,メンバー2,...]（省略時は全員）

- メンバー別 result.json（{datetime, title, url, content}）を取得し、
  メタデータ＋本文（blocks化）＋写真をまとめて取り込む。
- 重複除去は公式記事番号（URLの detail/<番号>）を主キーにする
  （Sakamichi Blog Archive 取り込み分と同一記事は取り込まない）。
- 無題の記事は、アーカイブの慣例どおり本文の書き出しがタイトルになる。
"""
import json, os, re, subprocess, sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_backfill as bf

BASE = bf.BASE
ROOT = 'https://janelin612.github.io/n46-crawler'
NUM_RE = re.compile(r'detail/(\d+)')


def curl_json(url):
    r = subprocess.run(['curl', '-s', '--max-time', '120', url], capture_output=True, timeout=150)
    return json.loads(r.stdout.decode('utf-8'))


def norm(n):
    return (n or '').replace(' ', '').replace('　', '').strip()


def main():
    targets = set(sys.argv[1].split(',')) if len(sys.argv) > 1 else None
    memberlist = curl_json(ROOT + '/memberlist.json')
    members = {}
    for year in memberlist:
        for mm in year.get('member', []):
            nm = norm(mm['name'])
            if nm and nm != '研究生':
                members[nm] = mm['link']
    if targets:
        members = {k: v for k, v in members.items() if k in targets}
    idx, years, imgs = bf.load_store()
    held_nums = set()
    held_keys = set()
    for lst in years.values():
        for b in lst:
            if b['group'] == '乃木坂46':
                mm = NUM_RE.search(b.get('url', ''))
                if mm:
                    held_nums.add(mm.group(1))
                held_keys.add((b['member'], b['date'], b['title']))
    added = Counter()
    skipped = 0
    dirty = set()
    for member, link in members.items():
        posts = curl_json(f'{ROOT}/mb/{link}result.json')
        base = f'{ROOT}/mb/{link}'
        for p in posts:
            mm = NUM_RE.search(p.get('url', ''))
            if not mm:
                continue
            num = mm.group(1)
            dt = p['datetime'].replace('.', '-')
            date, time = dt.split(' ')
            time = time[:5]
            title = p['title']
            if num in held_nums or (member, date, title) in held_keys:
                skipped += 1
                continue
            html = re.sub(r'</div\s*>', '\n', p.get('content') or '', flags=re.I)
            blocks = bf.html_to_blocks(html, base)
            img_urls = [b['src'] for b in blocks if b['type'] == 'image']
            rid = f'crw-nogi-{num}'
            rec = {'id': rid, 'group': '乃木坂46', 'member': member, 'title': title,
                   'date': date, 'time': time, 'url': p['url'], 'urldead': True,
                   'arch': 'n46-crawler', 'media': 0, 'imgn': len(img_urls)}
            if img_urls:
                rec['thumb'] = img_urls[0]
                imgs.setdefault(date[:4], {})[rid] = img_urls
            if blocks:
                rec['body'] = True
                with open(os.path.join(BASE, 'data/bodies', rid + '.json'), 'w', encoding='utf-8') as f:
                    json.dump({'blocks': blocks, 'source': 'archive'}, f, ensure_ascii=False, separators=(',', ':'))
            years.setdefault(date[:4], []).append(rec)
            held_nums.add(num)
            held_keys.add((member, date, title))
            added[member] += 1
            dirty.add(date[:4])
        print(f'{member}: +{added[member]}', flush=True)
    bf.save_store(idx, years, imgs, dirty)
    print('added total:', sum(added.values()), '| skipped dup:', skipped, '| store total:', idx['total'])


if __name__ == '__main__':
    main()
