#!/usr/bin/env python3
"""ブログ記事に投稿時刻（time）を補完する補修スクリプト。再開可能（時刻ありはスキップ）。
Phase A: 旧サイトカタログ（articles.json は日時つき）から無料で付与
Phase B: 日向坂は一覧ブロックに時刻があるのでメンバー別一覧を巡回して付与
Phase C: 乃木坂46・櫻坂46は詳細ページから取得（新しい順）
Phase D: 欅坂46は詳細ページから取得（新しい順）
保存は .store.lock を取ってから行う。ログ: tools/repair-times.log
"""
import os, re, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_backfill as bf

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, 'repair-times.log')
LOCK = os.path.join(HERE, '.store.lock')
CATALOG = '/home/hatch/workspace/sakamichia-import/articles.json'


def log(*a):
    line = time.strftime('%H:%M:%S') + ' '.join(str(x) for x in a)
    print(line, flush=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def acquire(wait=180):
    deadline = time.time() + wait
    while True:
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f'{os.getpid()}'.encode())
            os.close(fd)
            return True
        except FileExistsError:
            try:
                if time.time() - os.path.getmtime(LOCK) > 45 * 60:
                    os.unlink(LOCK)
                    continue
            except OSError:
                pass
            if time.time() >= deadline:
                return False
            time.sleep(10)


def release():
    try:
        os.unlink(LOCK)
    except OSError:
        pass


def save(idx, years, imgs, dirty):
    if not dirty:
        return True
    if not acquire():
        log('lock busy; deferring save of', len(dirty), 'years')
        return False
    try:
        bf.save_store(idx, years, imgs, set(dirty))
        return True
    finally:
        release()


def main():
    idx, years, imgs = bf.load_store()
    by_id, by_key = {}, {}
    for lst in years.values():
        for b in lst:
            by_id[b['id']] = b
            by_key[bf.url_key(b['url'])] = b
    dirty = set()

    # ---- Phase A: 旧カタログ ----
    cat = json.load(open(CATALOG, encoding='utf-8'))
    items = cat if isinstance(cat, list) else cat.get('articles', [])
    n = 0
    for it in items:
        d = it.get('date') or ''
        b = by_id.get(it.get('id'))
        if b and len(d) >= 16 and not b.get('time') and b['date'] == d[:10]:
            b['time'] = d[11:16]
            dirty.add(b['date'][:4])
            n += 1
    log('phase A catalog: applied', n)
    if save(idx, years, imgs, dirty):
        dirty = set()

    # ---- Phase B: 日向坂 一覧 ----
    state = json.load(open(bf.STATE_PATH))
    n = 0
    for ct in state.get('hina', {}).get('members', {}):
        page, empty = 1, 0
        while empty < 2:
            try:
                posts = bf.hina_page(ct, page)
            except Exception:
                posts = None
            if not posts:
                empty += 1
                page += 1
                continue
            empty = 0
            for p in posts:
                if not p.get('time'):
                    continue
                rec = by_key.get(bf.url_key(p['url']))
                if rec and not rec.get('time'):
                    rec['time'] = p['time']
                    dirty.add(rec['date'][:4])
                    n += 1
            page += 1
            time.sleep(0.8)
        if dirty and save(idx, years, imgs, dirty):
            dirty = set()
    log('phase B hinata lists: applied', n)

    # ---- Phase C: 乃木坂・櫻坂 詳細 ----
    targets = [b for lst in years.values() for b in lst
               if b['group'] in ('乃木坂46', '櫻坂46') and not b.get('time')]
    targets.sort(key=lambda b: b['date'], reverse=True)
    log('phase C targets:', len(targets))
    done = 0
    for b in targets:
        got, tm = bf.extract_detail(b['url'], b['date'])
        if tm:
            b['time'] = tm
            dirty.add(b['date'][:4])
        if got and len(got) > (b.get('imgn') or 0):
            y = b['date'][:4]
            imgs.setdefault(y, {})[b['id']] = got
            b['imgn'] = len(got)
            if not b.get('thumb'):
                b['thumb'] = got[0]
            dirty.add(y)
        done += 1
        if done % 50 == 0:
            if save(idx, years, imgs, dirty):
                dirty = set()
            log(f'phase C {done}/{len(targets)}')
        time.sleep(1.0)
    if save(idx, years, imgs, dirty):
        dirty = set()
    log('phase C done')

    # ---- Phase D: 欅坂 詳細 ----
    from keyaki_import import fetch_pc
    targets = [b for lst in years.values() for b in lst
               if b['group'] == '欅坂46' and not b.get('time')]
    targets.sort(key=lambda b: b['date'], reverse=True)
    log('phase D targets:', len(targets))
    done = 0
    for b in targets:
        try:
            html = fetch_pc(b['url'])
            tm = bf.detail_datetime(html, b['date'])
        except Exception:
            tm = None
        if tm:
            b['time'] = tm
            dirty.add(b['date'][:4])
        done += 1
        if done % 50 == 0:
            if save(idx, years, imgs, dirty):
                dirty = set()
            log(f'phase D {done}/{len(targets)}')
        time.sleep(1.0)
    if save(idx, years, imgs, dirty):
        dirty = set()
    log('phase D done')

    have = sum(1 for lst in years.values() for b in lst if b.get('time'))
    total = sum(len(lst) for lst in years.values())
    log(f'ALL DONE with-time {have}/{total}')


if __name__ == '__main__':
    main()
