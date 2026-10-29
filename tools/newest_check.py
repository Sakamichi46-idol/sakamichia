#!/usr/bin/env python3
"""最新記事だけを高頻度で取り込む専用チェック（15分おきの定期ジョブ用）。
3グループの新着フィード（全メンバー横断の一覧）と乃木坂リレーの1ページ目だけを確認し、
未登録の記事があれば取り込んで次番号のZIPを作る（軽量版 feed_newest_pass）。
全メンバー巡回は毎朝の自動更新（newest_pass）が担う。
ブログストアへの書き込み競合を避けるため、update_from_universe.py と共通のロックを使う。
出力はJSON 1行: {"status": "ok"|"locked"|"error", "newest_added": n, "by_member": {...}, "zip": path?}
"""
import json, os, sys, time
from collections import Counter

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
LOCK = os.path.join(_HERE, '.store.lock')


def acquire_lock(wait_seconds=0):
    deadline = time.time() + wait_seconds
    while True:
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f'{os.getpid()} {time.time()}'.encode())
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
            time.sleep(30)


def release_lock():
    try:
        os.unlink(LOCK)
    except OSError:
        pass


def main():
    if not acquire_lock(0):
        print(json.dumps({'status': 'locked'}))
        return
    try:
        import blog_backfill as bf
        import update_from_universe as upd
        r = bf.feed_newest_pass()
        added = r.get('added', [])
        by_member = Counter()
        for b in added:
            if isinstance(b, dict):
                by_member[b.get('member', '?')] += 1
        out = {'status': 'ok', 'newest_added': len(added),
               'by_member': dict(by_member), 'pages_used': r.get('pages_used')}
        if added:
            if not os.environ.get('SAKAMICHIA_NO_ZIP'):
                out['zip'] = upd.build_zip()
        print(json.dumps(out, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'status': 'error', 'error': f'{type(e).__name__}: {e}'}, ensure_ascii=False))
    finally:
        release_lock()


if __name__ == '__main__':
    main()
