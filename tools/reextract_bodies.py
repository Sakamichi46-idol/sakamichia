#!/usr/bin/env python3
"""取り込み済み本文の取り直し（改行・空白を元のまま保持する新ロジックへの移行）。

2026-10-30 のユーザー指定「ブログ本文の改行や空白はもとにしたものそのままに。
勝手に減らさないで」で html_to_blocks を修正した（commit b2b1f934）。
それ以前に旧ロジックで取り込んだ本文（連続空行が最大6個に潰れる等）を、
公式ページから新しい順に再取得して置き換える。ユーザー選択により実施。

設計:
- 対象は arch（外部アーカイブ復元分）以外の、本文が既にある記事のみ。
  arch は公式に残っていない記事なので対象外。本文がまだ無い記事は
  backfill_bodies.py（body-backfill ワークフロー）が担当する。
- 置き換えは data/bodies/<id>.json への書き出しまでで、配信シャードへの
  反映はワークフローの pack_bodies.py（個別ファイルを上書きマージ）が行う。
- 安全ガード: 新本文の「空白を除いた文字数」が旧本文の8割未満なら、
  ページ側の変化や抽出失敗の疑いとして置き換えず、review に記録して保持する。
- 公式ページが 404/410 の場合は既存本文を保持し、done として再試行しない。
- 進捗は tools/body-reextract-state.json（done / review）に記録する。
  一時的なネットワーク失敗はどちらにも入れず、次回に再試行する。
"""
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blog_backfill as bf
import backfill_bodies as bb
import pack_bodies as pk

BASE = bf.BASE
STATE_PATH = os.path.join(BASE, 'tools', 'body-reextract-state.json')
PACK_DIR = os.path.join(BASE, 'data', 'bodies-pack')
PACE = 0.9


def log(msg):
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def visible_len(blocks):
    """空白類を除いた文字数（改行・空白の保持量に左右されない本文量）。"""
    return sum(len(re.sub(r'\s+', '', b.get('text', '')))
               for b in blocks if b.get('type') == 'paragraph')


def load_old_body(aid):
    p = os.path.join(bf.BODIES_DIR, aid + '.json')
    if os.path.exists(p):
        try:
            with open(p, encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return None
    shard = os.path.join(PACK_DIR, pk.shard_of(aid) + '.json')
    if os.path.exists(shard):
        try:
            with open(shard, encoding='utf-8') as f:
                return json.load(f).get(aid)
        except Exception:
            return None
    return None


def write_body(b, blocks):
    """本文ファイルを上書き保存する。

    bf.save_body は「既存ファイルがあれば書かない」設計（取り込み用）なので、
    取り直し専用のこちらで書き出す。形式は save_body と同じ。
    """
    os.makedirs(bf.BODIES_DIR, exist_ok=True)
    path = os.path.join(bf.BODIES_DIR, b['id'] + '.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'blocks': blocks, 'source': 'official'}, f,
                  ensure_ascii=False)
    b['body'] = True
    return True


def load_state():
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, encoding='utf-8') as f:
                d = json.load(f)
            return set(d.get('done', [])), set(d.get('review', []))
        except Exception:
            pass
    return set(), set()


def save_state(done, review):
    with open(STATE_PATH, 'w', encoding='utf-8') as f:
        json.dump({'done': sorted(done), 'review': sorted(review)},
                  f, ensure_ascii=False)


def main():
    limit = 0
    if '--limit' in sys.argv:
        limit = int(sys.argv[sys.argv.index('--limit') + 1])
    elif os.environ.get('BODY_REEXTRACT_LIMIT'):
        limit = int(os.environ['BODY_REEXTRACT_LIMIT'])
    idx, years, imgs = bf.load_store()
    have = bb.load_have_ids()
    done_set, review_set = load_state()
    targets = []
    for lst in years.values():
        for b in lst:
            if b.get('arch'):
                continue  # 外部アーカイブ復元分は公式に無いので対象外
            if b['id'] not in have:
                continue  # 本文が無い記事は backfill_bodies の担当
            if b['id'] in done_set or b['id'] in review_set:
                continue
            targets.append(b)
    targets.sort(key=lambda b: (b['date'], b.get('time') or '00:00'),
                 reverse=True)
    total_all = len(targets)
    if limit:
        targets = targets[:limit]
    total = len(targets)
    log(f'reextract targets: {total} (remaining: {total_all}, '
        f'done: {len(done_set)}, review: {len(review_set)})')
    done = replaced = kept = gone = 0
    for b in targets:
        done += 1
        old = load_old_body(b['id'])
        if not old or not old.get('blocks'):
            done_set.add(b['id'])
            continue
        if old.get('source') not in (None, 'official'):
            # アーカイブ由来など公式抽出以外の本文は触らない
            review_set.add(b['id'])
            kept += 1
            continue
        desktop = 'keyakizaka46.com' in b['url']
        status, html = bb.fetch_status(b['url'], desktop)
        if status == 200 and html:
            blocks = bf.extract_body_blocks(b['url'], html)
            if not blocks:
                # 今は抽出できない。既存本文を守り、再試行はしない
                review_set.add(b['id'])
                kept += 1
            else:
                old_vis = visible_len(old['blocks'])
                new_vis = visible_len(blocks)
                if old_vis and new_vis < old_vis * 0.8:
                    log(f"guard: {b['id']} new text {new_vis} < 80% of "
                        f"old {old_vis}; keeping old body")
                    review_set.add(b['id'])
                    kept += 1
                elif write_body(b, blocks):
                    replaced += 1
                    done_set.add(b['id'])
                else:
                    review_set.add(b['id'])
                    kept += 1
        elif status in (404, 410):
            # 公式から消えた記事。本文は既存を保持し、再試行しない
            done_set.add(b['id'])
            gone += 1
        # それ以外（ネットワーク失敗等）は次回に再試行する
        if done % 50 == 0:
            save_state(done_set, review_set)
            log(f'{done}/{total} replaced={replaced} kept={kept} gone={gone}')
        time.sleep(PACE)
    save_state(done_set, review_set)
    log(f'ALL DONE {done}/{total} replaced={replaced} kept={kept} gone={gone}')


if __name__ == '__main__':
    main()
