#!/usr/bin/env python3
"""写真一覧に混入した「他記事の写真」（ページモジュール由来）を取り除く一括除去ツール。

背景：欅坂46の公式アーカイブ記事ページには最新記事モジュール（box-txt）が含まれ、
記事コンテナに限定しない抽出がそのモジュール内の他記事の写真まで拾っていた。
その結果、2015〜2020年の欅坂46記事4,965件の写真一覧に、2020年7〜10月の新着記事の
写真（246種）が混入し、1記事あたり平均11枚ほど「その記事の写真でないもの」が
並んでいた（2026-11-03 の全面見直しで検出。抽出側は blog_backfill.py の
extract_imgs_scoped で記事コンテナ内限定に修正済み）。

除去ルール（保守的）：
- 本文（bodies-pack）のある記事だけを対象にする（本文が写真の実態）。
- 一覧のエントリのうち「その記事の本文に無い」ものを候補とし、その中でも
  「5件以上の記事で同じく本文に無いエントリとして現れるURL」だけを除去する。
  モジュール写真は数百〜数千記事に同一URLが現れるため、この条件で
  その記事固有の写真（他記事と重複しない）や、写真の所有者である記事は守られる。
- 除去は blog-imgs のみ。blogs 側の imgn / thumb / media は tools/sync_imgn.py で同期する。

使い方：python3 tools/drop_module_imgs.py [--apply]（既定は dry-run）
"""
import json, os, sys, glob
from collections import Counter

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIN_ARTICLES = 5


def norm(u):
    u = u.replace("://www.keyakizaka46.com/", "://cdn.keyakizaka46.com/")
    u = u.replace("://www.hinatazaka46.com/", "://cdn.hinatazaka46.com/")
    return u


def main():
    apply = "--apply" in sys.argv

    blogs = {}
    for f in sorted(glob.glob(os.path.join(BASE, "data/blogs/y*.json"))):
        for b in json.load(open(f, encoding="utf-8")):
            blogs[b["id"]] = b
    imgs_by_year = {}
    for f in sorted(glob.glob(os.path.join(BASE, "data/blog-imgs/y*.json"))):
        y = os.path.basename(f)[1:5]
        imgs_by_year[y] = json.load(open(f, encoding="utf-8"))
    id_year = {}
    for f in sorted(glob.glob(os.path.join(BASE, "data/blogs/y*.json"))):
        y = os.path.basename(f)[1:5]
        for b in json.load(open(f, encoding="utf-8")):
            id_year[b["id"]] = y
    bodies = {}
    for f in sorted(glob.glob(os.path.join(BASE, "data/bodies-pack/*.json"))):
        pack = json.load(open(f, encoding="utf-8"))
        for aid, v in pack.items():
            if isinstance(v, dict):
                bodies[aid] = [blk.get("src") for blk in (v.get("blocks") or [])
                               if blk.get("type") == "image" and blk.get("src")]

    # 混入URL集合：本文のある記事で「本文に無いエントリ」として現れる記事数を数える
    extra_count = Counter()
    for aid, lst in ((aid, imgs_by_year.get(id_year.get(aid, ""), {}).get(aid))
                     for aid in bodies):
        if not lst:
            continue
        bset = {norm(u) for u in bodies[aid]}
        for u in lst:
            if norm(u) not in bset:
                extra_count[u] += 1
    foreign = {u for u, n in extra_count.items() if n >= MIN_ARTICLES}
    print(f"foreign urls (>={MIN_ARTICLES} articles): {len(foreign)}")

    changed = {}   # year -> {id: new_list}
    removed_total = 0
    emptied = 0
    for aid, body_urls in bodies.items():
        y = id_year.get(aid)
        if y is None:
            continue
        lst = imgs_by_year.get(y, {}).get(aid)
        if not lst:
            continue
        bset = {norm(u) for u in body_urls}
        new = [u for u in lst if not (u in foreign and norm(u) not in bset)]
        if new != lst:
            # 安全確認：一覧にあった「その記事の本文の写真」は絶対に消えていないこと
            # （本文内のスタンプgif等は元々一覧に無いため、対象は一覧∩本文のみ）
            new_norms = {norm(x) for x in new}
            for u in lst:
                if norm(u) in bset:
                    assert norm(u) in new_norms, f"own photo lost: {aid} {u}"
            changed.setdefault(y, {})[aid] = new
            removed_total += len(lst) - len(new)
            if not new:
                emptied += 1
    print(f"affected articles: {sum(len(v) for v in changed.values())}, entries removed: {removed_total}, lists emptied: {emptied}")
    if not apply:
        print("dry-run only (use --apply to write)")
        return
    for y, changes in changed.items():
        imgs = imgs_by_year[y]
        imgs.update(changes)
        with open(os.path.join(BASE, f"data/blog-imgs/y{y}.json"), "w", encoding="utf-8") as fh:
            json.dump(imgs, fh, ensure_ascii=False, separators=(",", ":"))
    print("applied. run tools/sync_imgn.py next to resync imgn/thumb/media.")


if __name__ == "__main__":
    main()
