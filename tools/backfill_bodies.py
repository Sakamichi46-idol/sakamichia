#!/usr/bin/env python3
"""既存記事の本文バックフィル（再開可能）。

公式記事ページを新しい順に巡回し、本文 blocks を data/bodies/<id>.json に保存する。
あわせて不足している時刻(time)の補完、写真リストの増強、リンク切れ(404/410)の
urldead マークも同じ巡回で行う。既存の本文ファイル（旧サイト保存分）は上書きしない。
ストアの保存は50件ごとに .store.lock を取って行う。
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_backfill as bf

BASE = bf.BASE
LOCK = os.path.join(BASE, 'tools', '.store.lock')
DESKTOP_UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'}
PACE = 0.9


def log(msg):
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def acquire_lock():
    while True:
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return True
        except FileExistsError:
            if time.time() - os.path.getmtime(LOCK) > 45 * 60:
                os.remove(LOCK)
                continue
            time.sleep(5)


def release_lock():
    try:
        os.remove(LOCK)
    except OSError:
        pass


def fetch_status(url, desktop=False):
    headers = DESKTOP_UA if desktop else bf.UA
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'ignore')
    except urllib.error.HTTPError as e:
        return e.code, ''
    except Exception:
        return None, ''


def main():
    idx, years, imgs = bf.load_store()
    targets = []
    for lst in years.values():
        for b in lst:
            if not os.path.exists(os.path.join(bf.BODIES_DIR, b['id'] + '.json')):
                targets.append(b)
    targets.sort(key=lambda b: (b['date'], b.get('time') or '00:00'), reverse=True)
    total = len(targets)
    log(f'targets: {total}')
    done = bodies = times = dead = 0
    dirty = set()

    def flush():
        if not dirty:
            return
        acquire_lock()
        try:
            bf.save_store(idx, years, imgs, dirty)
        finally:
            release_lock()
        dirty.clear()

    for b in targets:
        done += 1
        desktop = 'keyakizaka46.com' in b['url']
        status, html = fetch_status(b['url'], desktop)
        if status == 200 and html:
            blocks = bf.extract_body_blocks(b['url'], html)
            if blocks and bf.save_body(b, blocks):
                bodies += 1
                dirty.add(b['date'][:4])
            if not b.get('time'):
                t = bf.detail_datetime(html, b['date'])
                if t:
                    b['time'] = t
                    times += 1
                    dirty.add(b['date'][:4])
            if b['group'] != '日向坂46':
                got = bf.extract_imgs_scoped(b['url'], html)
                if len(got) > (b.get('imgn') or 0):
                    y = b['date'][:4]
                    imgs.setdefault(y, {})[b['id']] = got
                    b['imgn'] = len(got)
                    dirty.add(y)
        elif status in (404, 410):
            if not b.get('urldead'):
                b['urldead'] = True
                dead += 1
                dirty.add(b['date'][:4])
        if done % 50 == 0:
            flush()
            log(f'{done}/{total} bodies+={bodies} times+={times} dead={dead}')
        time.sleep(PACE)
    flush()
    log(f'ALL DONE {done}/{total} bodies+={bodies} times+={times} dead={dead}')


if __name__ == '__main__':
    main()
