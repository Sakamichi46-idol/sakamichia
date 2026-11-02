#!/usr/bin/env python3
"""本文ブロック（bodies-pack）にあるのに写真一覧（blog-imgs）に無い写真を補う修復ツール。

背景：写真一覧は取り込み時のURLパターン（moblog中心）で抽出してきたため、公式CMSの
新しい配信形式（/images/46/、/images/14/、/files/46/diary/.../MEMBER/直下、
/files/14/diary/.../*.jpeg）に乗り換えた写真を取りこぼし、「写真なし」扱いや
枚数不足になっていた。本文ブロックは後から全文パースで取り直されており、
そちらが「そのブログの写真」の実態に近いので、本文にある写真を一覧側へ補う。

ガード：
- スタンプ候補（.gif、/icon/、blob:、slack-edge）は補わない。
- 寸法監査（dims.jsonl）で両辺128px以下と実測されたURLはスタンプとして補わない。
- 既存の一覧からは一切削除しない（追加と並び替えのみ）。並びは本文順を正とする。
- 欅坂46の www/cdn ホスト違いは同一写真として扱い、二重に追加しない。
- 一覧が変わった記事は thumb を「一覧の先頭」に合わせる（thumb ルール）。
使い方：python3 tools/repair_blog_imgs.py [--apply] [--dims <dims.jsonl>]
"""
import json, os, sys, glob

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def norm(u):
    return u.replace("://www.keyakizaka46.com/", "://cdn.keyakizaka46.com/")


def is_stampy(u):
    return (not u.startswith("http") or u.endswith(".gif") or "/icon/" in u
            or "slack-edge" in u or u.startswith("blob:"))


def main():
    apply = "--apply" in sys.argv
    dims_path = None
    if "--dims" in sys.argv:
        dims_path = sys.argv[sys.argv.index("--dims") + 1]
    stamps = set()
    if dims_path and os.path.exists(dims_path):
        for line in open(dims_path, encoding="utf-8"):
            try:
                r = json.loads(line)
            except Exception:
                continue
            if (r.get("width") or 999) <= 128 and (r.get("height") or 999) <= 128:
                stamps.add(r["url"])
    print(f"measured stamps excluded: {len(stamps)}")

    # id -> (year, blog) と年別 imgs
    id_year = {}
    blogs_by_year = {}
    for f in sorted(glob.glob(os.path.join(BASE, "data/blogs/y*.json"))):
        y = os.path.basename(f)[1:5]
        blogs = json.load(open(f, encoding="utf-8"))
        blogs_by_year[y] = blogs
        for b in blogs:
            id_year[b["id"]] = y
    imgs_by_year = {}
    for f in sorted(glob.glob(os.path.join(BASE, "data/blog-imgs/y*.json"))):
        y = os.path.basename(f)[1:5]
        imgs_by_year[y] = json.load(open(f, encoding="utf-8"))

    changed_imgs = {}   # year -> {id: new_list}
    added_urls = 0
    affected = 0
    for f in sorted(glob.glob(os.path.join(BASE, "data/bodies-pack/*.json"))):
        pack = json.load(open(f, encoding="utf-8"))
        for aid, v in pack.items():
            if not isinstance(v, dict) or aid not in id_year:
                continue
            cands = []
            for b in (v.get("blocks") or []):
                if b.get("type") == "image":
                    u = b.get("src") or ""
                    if u and not is_stampy(u) and u not in stamps and u not in cands:
                        cands.append(u)
            if not cands:
                continue
            y = id_year[aid]
            existing = imgs_by_year.get(y, {}).get(aid) or []
            ex_set = set(existing)
            ex_norm = {norm(u) for u in existing}
            missing = [u for u in cands if u not in ex_set and norm(u) not in ex_norm]
            if not missing:
                continue
            # 本文順に再構成（既存分＋不足分）→ 既存にだけあるものは末尾に残す
            result, seen = [], set()
            for u in cands:
                if norm(u) not in seen:
                    result.append(u)
                    seen.add(norm(u))
            for u in existing:
                if norm(u) not in seen:
                    result.append(u)
                    seen.add(norm(u))
            if result != existing:
                changed_imgs.setdefault(y, {})[aid] = result
                added_urls += len(missing)
                affected += 1
    print(f"affected articles: {affected}, urls added: {added_urls}")
    if not apply:
        print("dry-run only (use --apply to write)")
        return
    thumb_fixed = 0
    for y, changes in changed_imgs.items():
        imgs = imgs_by_year.setdefault(y, {})
        imgs.update(changes)
        with open(os.path.join(BASE, f"data/blog-imgs/y{y}.json"), "w", encoding="utf-8") as fh:
            json.dump(imgs, fh, ensure_ascii=False, separators=(",", ":"))
        blogs = blogs_by_year[y]
        by_id = {b["id"]: b for b in blogs}
        dirty = False
        for aid, new_list in changes.items():
            b = by_id.get(aid)
            if b is not None:
                want = new_list[0] if new_list else None
                if b.get("thumb") != want:
                    b["thumb"] = want
                    thumb_fixed += 1
                    dirty = True
        if dirty:
            with open(os.path.join(BASE, f"data/blogs/y{y}.json"), "w", encoding="utf-8") as fh:
                json.dump(blogs, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"applied. thumbs fixed: {thumb_fixed}")


if __name__ == "__main__":
    main()
