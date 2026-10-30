#!/usr/bin/env python3
"""旧サイト『坂道日和』のメディア参照を、サカミチア内のファイルへ移行する。

旧サイト保存分のブログ記事（85件）の本文写真とサムネイルは、旧サイトの
/blog/public/media/ を直接参照していた。旧サイト削除に備え、写真実体を
assets/blog-media/ へ取り込み、参照を書き換える（2026-10-30）。

- 対象URLは bodies-pack・data/blogs の実データから収集する
- 画像はマジックバイトで検証し、失敗したURLは報告して参照を書き換えない
- 書き換えはURLプレフィックスの文字列置換のみ（JSONの整形は変えない）
"""
import glob
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD_PREFIX = 'https://sakamichi-biyori.pages.dev/blog/public/media/'
NEW_PREFIX = '/assets/blog-media/'
OUT_DIR = os.path.join(BASE, 'assets', 'blog-media')


def is_image(data):
    return (data[:8] == b'\x89PNG\r\n\x1a\n' or data[:3] == b'\xff\xd8\xff'
            or (data[:4] == b'RIFF' and data[8:12] == b'WEBP')
            or data[:6] in (b'GIF87a', b'GIF89a'))


def collect_urls():
    urls = set()
    for path in glob.glob(os.path.join(BASE, 'data', 'bodies-pack', '*.json')):
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        for body in d.values():
            for blk in body.get('blocks', []):
                src = blk.get('src', '') if blk.get('type') == 'image' else ''
                if src.startswith(OLD_PREFIX):
                    urls.add(src)
    for path in glob.glob(os.path.join(BASE, 'data', 'blogs', 'y*.json')):
        with open(path, encoding='utf-8') as f:
            for a in json.load(f):
                if str(a.get('thumb') or '').startswith(OLD_PREFIX):
                    urls.add(a['thumb'])
    return sorted(urls)


def download(url):
    rel = url[len(OLD_PREFIX):]
    dest = os.path.join(OUT_DIR, rel)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        with open(dest, 'rb') as f:
            if is_image(f.read(16)):
                return url, True, 0
    p = subprocess.run(['curl', '-sL', '--max-time', '30', url],
                       capture_output=True)
    data = p.stdout
    if p.returncode != 0 or not data or not is_image(data):
        return url, False, 0
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'wb') as f:
        f.write(data)
    return url, True, len(data)


def rewrite(paths, ok_urls):
    changed = 0
    for path in paths:
        with open(path, encoding='utf-8') as f:
            text = f.read()
        new = text
        for url in ok_urls:
            if url in new:
                new = new.replace(url, NEW_PREFIX + url[len(OLD_PREFIX):])
        if new != text:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(new)
            changed += 1
    return changed


def main():
    urls = collect_urls()
    print(f'target urls: {len(urls)}')
    ok, failed, total_bytes = [], [], 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for url, good, size in ex.map(download, urls):
            if good:
                ok.append(url)
                total_bytes += size
            else:
                failed.append(url)
    print(f'downloaded: {len(ok)} ({total_bytes // 1024} KiB), '
          f'failed: {len(failed)}')
    for url in failed:
        print(f'  FAILED: {url}')
    targets = (glob.glob(os.path.join(BASE, 'data', 'bodies-pack', '*.json'))
               + glob.glob(os.path.join(BASE, 'data', 'blogs', 'y*.json'))
               + glob.glob(os.path.join(BASE, 'data', 'bodies', '*.json')))
    changed = rewrite(targets, ok)
    print(f'rewritten files: {changed}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
