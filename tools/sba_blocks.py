# -*- coding: utf-8 -*-
"""Sakamichi Blog Archive の本文HTML → blocks 変換。

平手友梨奈の取り込み時に使われた変換を、保存済み本文との照合で再現したもの。
公式取り込み用 blog_backfill.html_to_blocks とは別物（そちらは段落・空白行の扱いが違う）：
- タグは <br> と <img> 以外すべて除去し、テキストは空白も含めそのまま連結する
- 空行（完全に空の行）だけを break として数え、先頭の break も保持する
"""
import html as _html_lib
import re

_IMG_TAG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.I)


def sba_html_to_blocks(html, base_url=''):
    imgs = []

    def _sub(m):
        u = m.group(1).replace('&amp;', '&')
        if u.startswith('/'):
            u = 'https://' + base_url.strip('/').split('/')[0] + u if base_url else u
        imgs.append(u)
        return f'\x01{len(imgs) - 1}\x01'

    s = _IMG_TAG_RE.sub(_sub, html)
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = re.sub(r'<[^>]+>', '', s)
    s = _html_lib.unescape(s)
    blocks = []
    cur = []
    pending = 0

    def flush_para():
        nonlocal cur
        text = '\n'.join(cur)
        cur = []
        if text.strip():
            blocks.append({'type': 'paragraph', 'text': text})

    def close_gap():
        nonlocal pending
        flush_para()
        if pending:
            for _ in range(min(pending, 6)):
                blocks.append({'type': 'break'})
        pending = 0

    for raw in s.split('\n'):
        if raw == '':
            pending += 1
            continue
        for part in re.split(r'(\x01\d+\x01)', raw):
            if not part:
                continue
            if part.startswith('\x01') and part.endswith('\x01') and part[1:-1].isdigit():
                close_gap()
                blocks.append({'type': 'image', 'src': imgs[int(part[1:-1])], 'alt': ''})
            else:
                if pending:
                    close_gap()
                cur.append(part)
    flush_para()
    text_len = sum(len(b.get('text', '')) for b in blocks if b['type'] == 'paragraph')
    if text_len < 5 and not any(b['type'] == 'image' for b in blocks):
        return []
    return blocks
