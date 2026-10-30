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
OLD_RE = re.compile(r'/(\d{5,})\.php(?:$|\?)')


def article_num(url):
    """公式記事番号を正規化して返す（旧ブログ形式 064217.php は 64217 に揃える）。"""
    mm = NUM_RE.search(url or '')
    if mm:
        return str(int(mm.group(1)))
    mm = OLD_RE.search(url or '')
    if mm:
        return str(int(mm.group(1)))
    return None


def curl_json(url):
    r = subprocess.run(['curl', '-s', '--max-time', '120', url], capture_output=True, timeout=150)
    return json.loads(r.stdout.decode('utf-8'))


def norm(n):
    return (n or '').replace(' ', '').replace('　', '').strip()


_TAG_TOKEN_RE = re.compile(r'(<[^>]+>)')
_TAG_NAME_RE = re.compile(r'</?\s*([a-zA-Z][a-zA-Z0-9]*)')
_IMG_MARK_RE = re.compile(r'(\x01\d+\x01)')
_ASCII_WS = ' \t\r\n\f\v'


def _classify_text(part):
    """テキスト断片を (可視文字あり, 空白実体のみ, 純粋な整形空白) に分類する。

    空白実体 = &nbsp; や全角スペースだけでできた断片。これらはブラウザで
    行ボックスを生む（＝空行になる）。ASCII空白だけの断片はブラウザで
    潰れるため、行を生まない（旧ブログの <div> </div> スペーサ等）。"""
    core = part.strip(_ASCII_WS)
    if not core:
        return (False, False)
    if not core.strip('\xa0\u3000'):
        return (False, True)
    return (True, False)


def content_to_blocks(inner, base_url):
    """クローラ保存HTML（div中心の旧ブログ本文）を blocks 形式へ変換する。

    元の表示に合わせる：
    - div の区切りは「行の改行」であって空行ではない。
    - ASCII空白だけの div（<div> </div> 等のスペーサ）はブラウザで潰れる
      ため行を生まない。
    - 連続する <br>、&nbsp; や全角スペースだけの div、<div><br></div> は
      元HTMLに実在する空行として break ブロックで保持する。
    - 画像の抽出方法・出現順は html_to_blocks と同一にする。
    """
    imgs = []

    def _sub(m):
        imgs.append(bf._urljoin(base_url, m.group(1).replace('&amp;', '&')))
        return f'\x01{len(imgs) - 1}\x01'

    s = bf._IMG_TAG_RE.sub(_sub, inner or '')

    lines = []   # 行 = セグメント列 [('t', text) | ('i', img_index)]
    cur = []     # 現在の行のセグメント
    stack = []   # 開いている div/p の {'content': bool, 'blank': bool, 'p': bool}

    def mark(key):
        for d in stack:
            d[key] = True

    def end_line(always=False):
        nonlocal cur
        if cur or always:
            lines.append(cur)
        cur = []

    def add_text(part):
        part = bf._html_lib.unescape(part)
        visible, blankish = _classify_text(part)
        if visible:
            cur.append(('t', part))
            mark('content')
        elif blankish:
            mark('blank')
        elif part and cur and cur[-1][0] == 't':
            # テキストに隣接する空白は末尾に付けて保持する（整形空白は cur が空）
            cur[-1] = ('t', cur[-1][1] + part)

    def add_image(idx):
        cur.append(('i', idx))
        mark('content')

    for token in _TAG_TOKEN_RE.split(s):
        if not token:
            continue
        if token.startswith('<') and token.endswith('>') and len(token) > 1:
            m = _TAG_NAME_RE.match(token)
            if not m:
                continue
            name = m.group(1).lower()
            closing = token.startswith('</')
            if name == 'br' and not closing:
                end_line(always=True)
            elif name == 'div' and not closing:
                end_line()
                stack.append({'content': False, 'blank': False, 'p': False})
            elif name == 'div' and closing:
                d = stack.pop() if stack else {'content': True, 'blank': False, 'p': False}
                if d['content']:
                    end_line()
                elif d['blank']:
                    end_line(always=True)
            elif name == 'p' and not closing:
                end_line()
                stack.append({'content': False, 'blank': False, 'p': True})
            elif name == 'p' and closing:
                d = stack.pop() if stack else {'content': True, 'blank': False, 'p': False}
                if d['content']:
                    end_line()
                    end_line(always=True)   # 段落の区切りとして空行1つ
                elif d['blank']:
                    end_line(always=True)
            elif name == 'hr' and not closing:
                end_line(always=True)
            # それ以外のタグは透過（中身だけ残る）
        else:
            for part in _IMG_MARK_RE.split(token):
                if not part:
                    continue
                if part.startswith('\x01') and part.endswith('\x01') and part[1:-1].isdigit():
                    add_image(int(part[1:-1]))
                else:
                    add_text(part)
    end_line()

    # 行列 → blocks（html_to_blocks と同じ組み立て規則）
    blocks = []
    cur_para = []
    pending = 0

    def flush_para():
        nonlocal cur_para
        text = '\n'.join(cur_para)
        cur_para = []
        if text.strip():
            blocks.append({'type': 'paragraph', 'text': text})

    def close_gap():
        nonlocal pending
        flush_para()
        if blocks and pending:
            for _ in range(pending):
                blocks.append({'type': 'break'})
        pending = 0

    for line in lines:
        if not line:
            pending += 1
            continue
        for kind, val in line:
            if kind == 'i':
                close_gap()
                blocks.append({'type': 'image', 'src': imgs[val], 'alt': ''})
            elif val.strip():
                if pending:
                    close_gap()
                cur_para.append(val)
            elif cur_para:
                cur_para[-1] += val
    flush_para()
    text_len = sum(len(b.get('text', '')) for b in blocks if b['type'] == 'paragraph')
    if text_len < 5 and not any(b['type'] == 'image' for b in blocks):
        return []
    return blocks


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
                num = article_num(b.get('url', ''))
                if num:
                    held_nums.add(num)
                held_keys.add((b['member'], b['date'], b['title']))
    added = Counter()
    skipped = 0
    dirty = set()
    for member, link in members.items():
        posts = curl_json(f'{ROOT}/mb/{link}result.json')
        base = f'{ROOT}/mb/{link}'
        for p in posts:
            raw_url = p.get('url') or ''
            num = article_num(raw_url)
            url_less = not num and raw_url in ('', '#')
            if not num and not url_less:
                continue
            dt = (p.get('datetime') or '').replace('.', '-').replace('/', '-')
            parts = dt.split(' ')
            if len(parts) != 2 or not parts[0]:
                print(f'  SKIP (datetime不正): {member} {raw_url}', flush=True)
                continue
            date, time = parts[0], parts[1][:5]
            title = p['title']
            if (num and num in held_nums) or (member, date, title) in held_keys:
                skipped += 1
                continue
            blocks = content_to_blocks(p.get('content') or '', base)
            img_urls = [b['src'] for b in blocks if b['type'] == 'image']
            if num:
                rid = f'crw-nogi-{num}'
            else:
                import hashlib
                rid = 'crw-nogi-h' + hashlib.md5(f'{member}|{p["datetime"]}|{title}'.encode()).hexdigest()[:10]
            rec = {'id': rid, 'group': '乃木坂46', 'member': member, 'title': title,
                   'date': date, 'time': time, 'url': raw_url if num else '', 'urldead': True,
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
