#!/usr/bin/env python3
"""残作業を直列に終わらせる監督スクリプト（ユーザー指示「終わったらZIPを送る」用）。
1. 欅坂46取り込み（keyaki_import.py）の終了を待つ
2. 乃木坂を一時skipして櫻坂・日向坂のバックフィルを優先実行（bf.run ラウンド制、ロック共有）
   完了条件: 日向坂メンバー全done かつ 櫻坂3期・4期メンバー全done（リレー期を優先）
3. 全年セーブでリレーブログのseriesタグ付け＋メンバー別件数を確定
4. ZIPを作成し、統計をログに残して COMPLETE を出す
ログ: tools/finish-chain.log
"""
import os, sys, time, json, re, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
LOGF = os.path.join(HERE, 'finish-chain.log')
LOCK = os.path.join(HERE, '.store.lock')
WALL_CAP = 3.5 * 3600
T0 = time.time()


def log(*a):
    line = time.strftime('%H:%M:%S') + ' ' + ' '.join(str(x) for x in a)
    print(line, flush=True)
    with open(LOGF, 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def acquire(wait=900):
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
            time.sleep(20)


def release():
    try:
        os.unlink(LOCK)
    except OSError:
        pass


def keyaki_running():
    out = subprocess.run(['pgrep', '-f', 'keyaki_impor' + 't.py'], capture_output=True, text=True).stdout.split()
    return [p for p in out if p.strip() and int(p) != os.getpid()]


def main():
    import blog_backfill as bf
    # 1) 欅坂取り込みの終了待ち
    while keyaki_running():
        if time.time() - T0 > WALL_CAP:
            log('keyaki wait timeout; proceeding anyway')
            break
        log('waiting for keyaki import...')
        time.sleep(60)
    log('keyaki import done (or gone)')

    # 櫻坂3期・4期のct集合（公式一覧の選択肢→名簿の期で判定）
    members = json.load(open(os.path.join(bf.BASE, 'data/members.json'), encoding='utf-8'))
    gen_of = {m['name']: m.get('gen') for m in members if '櫻坂46' in (m.get('groups') or [m.get('group')])}
    h = bf.fetch('https://www.sakurazaka46.com/s/s46/diary/blog/list')
    saku_priority = set()
    for ct, name in re.findall(r'ct=(\d+)"[^>]*>\s*([^<]+?)\s*\(', h):
        nm = name.replace(' ', '').replace('　', '')
        if gen_of.get(nm) in (3, 4):
            saku_priority.add(ct)
    log('saku priority cts (gen3/4):', sorted(saku_priority))

    # 2) 乃木坂を一時skip（状態ファイルはロック下で編集し、終了時に必ず戻す）
    state = json.load(open(bf.STATE_PATH))
    for ms in state.get('nogi', {}).get('members', {}).values():
        ms['skip'] = True
    json.dump(state, open(bf.STATE_PATH, 'w'), ensure_ascii=False, indent=1)
    try:
        rnd = 0
        while time.time() - T0 < WALL_CAP:
            rnd += 1
            if not acquire():
                log('lock busy; stopping rounds')
                break
            try:
                r = bf.run(budget_pages=40)
                log(f'round {rnd}: added {len(r["added"])} pages {r.get("pages_used")}')
            finally:
                release()
            st = json.load(open(bf.STATE_PATH))
            hina_pend = [ct for ct, v in st['hina']['members'].items() if not v.get('done') and not v.get('skip')]
            saku_pend = [ct for ct in saku_priority if not st['saku']['members'].get(ct, {}).get('done')]
            log(f'after round {rnd}: hina pending {len(hina_pend)}, saku gen3/4 pending {len(saku_pend)}')
            if not hina_pend and not saku_pend:
                log('priority backfill complete')
                break
            time.sleep(5)
    finally:
        state = json.load(open(bf.STATE_PATH))
        for ms in state.get('nogi', {}).get('members', {}).values():
            ms.pop('skip', None)
        json.dump(state, open(bf.STATE_PATH, 'w'), ensure_ascii=False, indent=1)
        log('nogi skip flags restored')

    # 3) 全年セーブ（タグ付け＋件数確定）
    if acquire():
        try:
            idx, years, imgs = bf.load_store()
            tagged = bf.apply_relay_windows(years)
            bf.save_store(idx, years, imgs, set(years.keys()))
            log('full save done; total', idx['total'], '| tagged this pass', tagged)
        finally:
            release()
    else:
        log('could not acquire lock for full save')

    # 4) ZIP＋統計
    import update_from_universe as upd
    zp = upd.build_zip()
    idx = json.load(open(os.path.join(bf.BASE, 'data/blogs/index.json'), encoding='utf-8'))
    from collections import Counter
    groups, series = Counter(), Counter()
    import glob as G
    for f in G.glob(os.path.join(bf.BASE, 'data/blogs/y*.json')):
        for b in json.load(open(f, encoding='utf-8')):
            groups[b['group']] += 1
            if b.get('series'):
                series[b['series']] += 1
    log('ZIP', zp)
    log('groups', dict(groups))
    log('series', dict(series))
    log('COMPLETE', json.dumps({'zip': zp, 'total': idx['total']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
