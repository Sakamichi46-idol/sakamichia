#!/usr/bin/env python3
"""ブログ本文の配信用シャードを生成する。

作業用フォーマット data/bodies/<id>.json（各ツールが書く個別ファイル）を、
配信用の data/bodies-pack/<h3>.json（h3 = id の djb2 ハッシュ先頭3桁）に
まとめる。Cloudflare Pages の「1デプロイ最大20,000ファイル」制限の回避策。

- 既存シャードに、個別ファイルの内容を上書きマージする（変更のあった
  シャードだけを書き直すので、git の差分は最小になる）。
- --prune: 個別ファイルが存在しないIDをシャードからも消す。
  個別ファイルの全量が揃っているローカルでのみ使うこと
  （GitHub Actions 上では個別ファイルが無いため絶対に使わない）。
"""
import json
import os
import sys
from collections import defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BODIES = os.path.join(BASE, 'data', 'bodies')
PACK = os.path.join(BASE, 'data', 'bodies-pack')


def shard_of(rid):
    # FNV-1a + Murmur3 finalizer（blog.js の bodyShard と一致させること）
    h = 0x811C9DC5
    for ch in rid:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    h ^= h >> 16
    h = (h * 0x85EBCA6B) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & 0xFFFFFFFF
    h ^= h >> 16
    return format(h & 0xFFF, '03x')


def main():
    prune = '--prune' in sys.argv
    os.makedirs(PACK, exist_ok=True)
    by_shard = defaultdict(dict)  # shard -> {id: body}
    n_files = 0
    if os.path.isdir(BODIES):
        for name in os.listdir(BODIES):
            if not name.endswith('.json'):
                continue
            rid = name[:-5]
            try:
                with open(os.path.join(BODIES, name), encoding='utf-8') as f:
                    by_shard[shard_of(rid)][rid] = json.load(f)
                n_files += 1
            except Exception as e:
                print(f'WARN: skip {name}: {e}')
    touched = set(by_shard)
    if prune:
        touched |= {n[:-5] for n in os.listdir(PACK) if n.endswith('.json')}
    written = removed = total = 0
    max_size = 0
    for shard in sorted(touched):
        path = os.path.join(PACK, shard + '.json')
        cur = {}
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                cur = json.load(f)
        new = dict(cur)
        new.update(by_shard.get(shard, {}))
        if prune:
            new = {k: v for k, v in new.items() if k in by_shard.get(shard, {})}
        total += len(new)
        if new == cur:
            continue
        if not new:
            os.remove(path)
            removed += 1
            continue
        text = json.dumps(new, ensure_ascii=False, separators=(',', ':'))
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)
        written += 1
        max_size = max(max_size, len(text.encode('utf-8')))
    n_shards = len([n for n in os.listdir(PACK) if n.endswith('.json')])
    print(f'individual files: {n_files} | shards: {n_shards} | bodies packed: {total} '
          f'| shards written: {written} removed: {removed} | max shard: {max_size / 1024:.0f} KiB')


if __name__ == '__main__':
    main()
