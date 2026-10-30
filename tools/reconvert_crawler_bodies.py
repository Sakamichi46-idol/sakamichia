# -*- coding: utf-8 -*-
"""取り込み済み crw-* 記事の本文を、新しい変換（content_to_blocks）で
元HTML（n46-crawler の result.json）から再変換する。

旧変換は </div> を改行に置換して html_toBlocks に通していたため、行の
区切りが空行（break）として大量に記録される「改行の水増し」が起きていた。
本スクリプトは import_crawler_nogi.content_to_blocks で再変換し、
- 画像ブロックの src 列が完全一致すること
- 空白を除いた本文テキストが完全一致すること
を検証できた記事だけを書き換える（検証NGの記事は触らない）。

使い方:
  python3 tools/reconvert_crawler_bodies.py [--dry-run] [--only id1,id2,...]
"""
import hashlib, json, os, re, sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_backfill as bf
import import_crawler_nogi as ic

BASE = bf.BASE
WS_RE = re.compile(r'\s+')


def derive(post, member):
    """import_crawler_nogi.main と同じ規則で (rid, date) を導出する。"""
    raw_url = post.get('url') or ''
    num = ic.article_num(raw_url)
    url_less = not num and raw_url in ('', '#')
    if not num and not url_less:
        return None, None
    dt = (post.get('datetime') or '').replace('.', '-').replace('/', '-')
    parts = dt.split(' ')
    if len(parts) != 2 or not parts[0]:
        return None, None
    date = parts[0]
    if num:
        return f'crw-nogi-{num}', date
    h = hashlib.md5(f'{member}|{post["datetime"]}|{post["title"]}'.encode()).hexdigest()[:10]
    return 'crw-nogi-h' + h, date


def text_key(blocks):
    return WS_RE.sub('', ''.join(b.get('text', '') for b in blocks if b['type'] == 'paragraph'))


def img_list(blocks):
    return [b['src'] for b in blocks if b['type'] == 'image']


def counts(blocks):
    return Counter(b['type'] for b in blocks)


def main():
    dry = '--dry-run' in sys.argv
    only = None
    for a in sys.argv:
        if a.startswith('--only='):
            only = set(a.split('=', 1)[1].split(','))
    idx, years, _imgs = bf.load_store()
    store = {}
    for lst in years.values():
        for rec in lst:
            if rec['id'].startswith('crw-'):
                store[rec['id']] = rec
    memberlist = ic.curl_json(ic.ROOT + '/memberlist.json')
    members = {}
    for year in memberlist:
        for mm in year.get('member', []):
            nm = ic.norm(mm['name'])
            if nm and nm != '研究生':
                members[nm] = mm['link']
    stats = Counter()
    old_breaks = new_breaks = 0
    failures = []
    for member, link in members.items():
        try:
            posts = ic.curl_json(f'{ic.ROOT}/mb/{link}result.json')
        except Exception as e:
            stats['member_fetch_failed'] += 1
            failures.append((member, f'result.json 取得失敗: {e}'))
            continue
        base = f'{ic.ROOT}/mb/{link}'
        seen = set()
        for p in posts:
            rid, date = derive(p, member)
            if not rid or rid in seen:
                continue
            seen.add(rid)
            rec = store.get(rid)
            if rec is None:
                continue
            if only and rid not in only:
                continue
            if rec.get('member') != member or rec.get('date') != date or not rec.get('body'):
                stats['record_mismatch'] += 1
                failures.append((rid, 'レコードと一致しない/本文フラグなし'))
                continue
            path = os.path.join(BASE, 'data/bodies', rid + '.json')
            if not os.path.exists(path):
                stats['no_body_file'] += 1
                failures.append((rid, '本文ファイルなし'))
                continue
            old = json.load(open(path, encoding='utf-8'))
            old_blocks = old.get('blocks') or []
            new_blocks = ic.content_to_blocks(p.get('content') or '', base)
            if not new_blocks:
                stats['empty_new'] += 1
                failures.append((rid, '再変換結果が空'))
                continue
            if img_list(old_blocks) != img_list(new_blocks):
                stats['img_mismatch'] += 1
                failures.append((rid, '画像 src 列が不一致'))
                continue
            if text_key(old_blocks) != text_key(new_blocks):
                stats['text_mismatch'] += 1
                failures.append((rid, '空白を除く本文テキストが不一致'))
                continue
            stats['applied'] += 1
            old_breaks += counts(old_blocks)['break']
            new_breaks += counts(new_blocks)['break']
            if only:
                print(f'{rid}: old={dict(counts(old_blocks))} new={dict(counts(new_blocks))}')
            if not dry:
                with open(path, 'w', encoding='utf-8') as f:
                    json.dump({'blocks': new_blocks, 'source': old.get('source', 'archive')},
                              f, ensure_ascii=False, separators=(',', ':'))
        print(f'{member}: done', flush=True)
    print('---')
    print('stats:', dict(stats))
    print(f'breaks: {old_breaks} -> {new_breaks}')
    for rid, why in failures[:40]:
        print('SKIP', rid, why)
    if len(failures) > 40:
        print(f'... and {len(failures) - 40} more skips')


if __name__ == '__main__':
    main()
