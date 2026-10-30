#!/usr/bin/env python3
"""既存記事の本文バックフィル（再開可能）。

公式記事ページを新しい順に巡回し、本文 blocks を data/bodies/<id>.json に保存する。
あわせて不足している時刻(time)の補完、写真リストの増強、リンク切れ(404/410)の
urldead マークも同じ巡回で行う。既存の本文ファイル（旧サイト保存分）は上書きしない。
ストアの保存は50件ごとに .store.lock を取って行う。

自動実行（GitHub Actions）対応:
- 本文の実在判定は data/bodies/ の個別ファイルだけでなく、配信用シャード
  data/bodies-pack/ も見る（Actions 上では個別ファイルが無いため）。
- --limit N で1回の処理件数を制限できる（自動実行は少しずつ進める）。
- 公式ページはあるが本文を抽出できなかった記事と、リンク切れ記事は
  tools/body-backfill-state.json の skip に記録し、毎回先頭で詰まらないようにする。
  ネットワークエラー等の一時的な失敗は skip に入れず、次回に再試行する。
"""
import glob
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
PACK_DIR = os.path.join(BASE, 'data', 'bodies-pack')
STATE_PATH = os.path.join(BASE, 'tools', 'body-backfill-state.json')


def load_have_ids():
    """本文データが既にある記事ID（個別ファイル＋配信用シャード）。"""
    ids = set()
    if os.path.isdir(PACK_DIR):
        for path in glob.glob(os.path.join(PACK_DIR, '*.json')):
            try:
                with open(path, encoding='utf-8') as f:
                    ids.update(json.load(f).keys())
            except Exception:
                pass
    if os.path.isdir(bf.BODIES_DIR):
        for name in os.listdir(bf.BODIES_DIR):
            if name.endswith('.json'):
                ids.add(name[:-5])
    return ids


def load_state():
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, encoding='utf-8') as f:
                return set(json.load(f).get('skip', []))
        except Exception:
            return set()
    return set()


def save_state(skip):
    with open(STATE_PATH, 'w', encoding='utf-8') as f:
        json.dump({'skip': sorted(skip)}, f, ensure_ascii=False)
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
    # curl の方が chunked 応答の途中切断（http.client の IncompleteRead）に
    # なりにくいので優先し、無い環境では urllib にフォールバックする
    import shutil
    import subprocess
    if shutil.which('curl'):
        try:
            p = subprocess.run(
                ['curl', '-sS', '-L', '--max-time', '30',
                 '-A', headers['User-Agent'], '-w', '\n%{http_code}', url],
                capture_output=True, timeout=40)
            out = p.stdout.decode('utf-8', 'ignore')
            body, _, code = out.rpartition('\n')
            if code.strip().isdigit() and int(code) > 0:
                status = int(code)
                return status, body if status == 200 else ''
        except Exception:
            pass
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', 'ignore')
    except urllib.error.HTTPError as e:
        return e.code, ''
    except Exception as e:
        partial = getattr(e, 'partial', None)
        if partial:
            return 200, partial.decode('utf-8', 'ignore')
        return None, ''


def main():
    limit = 0
    if '--limit' in sys.argv:
        limit = int(sys.argv[sys.argv.index('--limit') + 1])
    elif os.environ.get('BODY_BACKFILL_LIMIT'):
        limit = int(os.environ['BODY_BACKFILL_LIMIT'])
    idx, years, imgs = bf.load_store()
    have = load_have_ids()
    skip = load_state()
    targets = []
    for lst in years.values():
        for b in lst:
            if b.get('arch'):
                continue  # 外部アーカイブ復元分は公式に残っていないので巡回対象外
            if b.get('urldead'):
                continue  # リンク切れ確認済みは再巡回しない
            if b['id'] in have or b['id'] in skip:
                continue
            targets.append(b)
    targets.sort(key=lambda b: (b['date'], b.get('time') or '00:00'), reverse=True)
    total_all = len(targets)
    if limit:
        targets = targets[:limit]
    total = len(targets)
    log(f'targets: {total} (remaining: {total_all}, have: {len(have)}, skip: {len(skip)})')
    done = bodies = times = dead = 0
    dirty = set()

    def flush():
        save_state(skip)
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
            elif not blocks:
                # 公式ページはあるが本文コンテナを抽出できない記事は、
                # 毎回先頭で再試行し続けないよう skip に記録する
                skip.add(b['id'])
            if not b.get('time'):
                t = bf.detail_datetime(html, b['date'])
                if t:
                    b['time'] = t
                    times += 1
                    dirty.add(b['date'][:4])
            got = bf.extract_imgs_scoped(b['url'], html)
            if len(got) > (b.get('imgn') or 0):
                y = b['date'][:4]
                imgs.setdefault(y, {})[b['id']] = got
                b['imgn'] = len(got)
                if not b.get('thumb'):
                    b['thumb'] = got[0]
                dirty.add(y)
        elif status in (404, 410):
            skip.add(b['id'])
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
