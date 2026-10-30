#!/usr/bin/env python3
"""ブログ本文キーワード検索のための索引（バイグラム転置索引）を生成する。

入力:
  - data/blogs/y<年>.json … 記事の列挙（通し番号の決定に使う）
  - data/bodies-pack/*.json … 本文の唯一のソース（個別ファイルは本番に無い）

出力（data/body-index/）:
  - ids.json    … 通し番号順の記事ID配列
  - meta.json   … {version, builtAt, articles, bodies, shards:64, years, counts}
                    years/counts は「年（昇順）ごとの記事数」で、通し番号から
                    (年, その年の何番目か) を復元できる。
  - shard-<n>.bin … ポスティングの二進シャード（64個）

【形式仕様（assets/js/blog.js のデコーダと一致させること）】
- 記事の通し番号: 年の昇順 → 年ファイル内の出現順に 0..N-1。
- 本文テキスト: blocks の paragraph の text を連結し、空白類
  （半角スペース・タブ・改行 CR/LF・全角スペース U+3000）を除去する。
- バイグラム: 正規化済みテキストを UTF-16 コードユニット列とみなし、
  連続する2ユニット (u1, u2) の組。キー値は (u1<<16)|u2（u32）。
- シャード振り分け: FNV-1a 32bit（初期値 0x811C9DC5、素数 0x01000193）で
  u1, u2 の順にハッシュし、64 で割った余り。
- shard-<n>.bin の中身:
    u32le K                       … このシャードのバイグラム数
    K 個のレコード（キー昇順）:
      u16le u1, u16le u2          … バイグラム
      u32le M                     … ポスティング件数
      varint × M                  … 記事番号。先頭は絶対値、以降は前との差分
                                    （≧1）。varint は unsigned LEB128。
"""
import glob
import json
import os
import struct
import tempfile
import time
from array import array
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLOGS = os.path.join(BASE, 'data', 'blogs')
PACK = os.path.join(BASE, 'data', 'bodies-pack')
OUT = os.path.join(BASE, 'data', 'body-index')
SHARDS = 64

# 除去する空白類（blog.js の BWS と一致させること）
STRIP_TABLE = {ord(c): None for c in ' \t\n\r　'}


def bigram_shard(u1, u2):
    h = 0x811C9DC5
    h ^= u1
    h = (h * 0x01000193) & 0xFFFFFFFF
    h ^= u2
    h = (h * 0x01000193) & 0xFFFFFFFF
    return h % SHARDS


def write_varint(out, v):
    while True:
        b = v & 0x7F
        v >>= 7
        if v:
            out.append(b | 0x80)
        else:
            out.append(b)
            return


def main():
    t0 = time.time()
    os.makedirs(OUT, exist_ok=True)

    # --- 1. 記事の列挙（年の昇順 → ファイル内の出現順） ---
    ids = []
    id2num = {}
    years = []
    counts = []
    for path in sorted(glob.glob(os.path.join(BLOGS, 'y*.json'))):
        year = os.path.basename(path)[1:-5]
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        arts = data['articles'] if isinstance(data, dict) else data
        years.append(year)
        counts.append(len(arts))
        for a in arts:
            id2num[a['id']] = len(ids)
            ids.append(a['id'])
    n_articles = len(ids)
    print(f'articles enumerated: {n_articles} (years {years[0]}..{years[-1]})')

    # --- 2. 本文からバイグラムを集め、シャード別の一時ファイルへ ---
    # 一時ファイルには (キー u32le, 記事番号 u32le) の8バイトレコードを追記する。
    tmpdir = tempfile.mkdtemp(prefix='body-index-')
    bufs = [bytearray() for _ in range(SHARDS)]
    files = [open(os.path.join(tmpdir, f'pairs-{n}.bin'), 'wb') for n in range(SHARDS)]
    n_bodies = 0
    n_unknown = 0
    n_postings = 0
    try:
        for path in sorted(glob.glob(os.path.join(PACK, '*.json'))):
            with open(path, encoding='utf-8') as f:
                pack = json.load(f)
            for rid, body in pack.items():
                num = id2num.get(rid)
                if num is None:
                    n_unknown += 1
                    continue
                n_bodies += 1
                text = ''.join(b.get('text', '') for b in body.get('blocks', [])
                               if b.get('type') == 'paragraph')
                if not text:
                    continue
                stripped = text.translate(STRIP_TABLE)
                if len(stripped) < 2:
                    continue
                b = stripped.encode('utf-16-le', 'surrogatepass')
                # 4バイト窓 = UTF-16 コードユニット2つ分。そのままキー(u32le)のバイト列になる
                grams = {b[i:i + 4] for i in range(0, len(b) - 3, 2)}
                tail = struct.pack('<I', num)
                for g in grams:
                    u1 = g[0] | (g[1] << 8)
                    u2 = g[2] | (g[3] << 8)
                    sh = bigram_shard(u1, u2)
                    bufs[sh] += g
                    bufs[sh] += tail
                    n_postings += 1
                    if len(bufs[sh]) >= 1 << 20:
                        files[sh].write(bufs[sh])
                        bufs[sh] = bytearray()
        for n in range(SHARDS):
            if bufs[n]:
                files[n].write(bufs[n])
            files[n].close()
    finally:
        for f in files:
            try:
                f.close()
            except Exception:
                pass
    print(f'bodies indexed: {n_bodies} | unknown ids skipped: {n_unknown} '
          f'| postings: {n_postings} | pass1: {time.time() - t0:.1f}s')

    # --- 3. シャードごとに整列・グループ化して二進形式で書き出す ---
    total_bytes = 0
    total_grams = 0
    for n in range(SHARDS):
        with open(os.path.join(tmpdir, f'pairs-{n}.bin'), 'rb') as f:
            raw = f.read()
        pairs = array('I')
        pairs.frombytes(raw)
        # (キー<<32)|記事番号 に詰め替えてソートすると「キー昇順→番号昇順」になる
        packed = array('Q', ((pairs[i] << 32) | pairs[i + 1]
                             for i in range(0, len(pairs), 2)))
        packed = array('Q', sorted(packed))
        out = bytearray()
        out += b'\x00\x00\x00\x00'  # K は後で埋める
        k = 0
        i = 0
        total = len(packed)
        while i < total:
            key = packed[i] >> 32
            j = i
            nums = []
            while j < total and (packed[j] >> 32) == key:
                nums.append(packed[j] & 0xFFFFFFFF)
                j += 1
            out += struct.pack('<I', key)
            out += struct.pack('<I', len(nums))
            prev = 0
            for v in nums:
                write_varint(out, v - prev)
                prev = v
            k += 1
            i = j
        struct.pack_into('<I', out, 0, k)
        with open(os.path.join(OUT, f'shard-{n}.bin'), 'wb') as f:
            f.write(out)
        total_bytes += len(out)
        total_grams += k
        os.remove(os.path.join(tmpdir, f'pairs-{n}.bin'))
    os.rmdir(tmpdir)

    # --- 4. ids.json / meta.json ---
    with open(os.path.join(OUT, 'ids.json'), 'w', encoding='utf-8') as f:
        json.dump(ids, f, ensure_ascii=False, separators=(',', ':'))
    meta = {
        'version': 1,
        'builtAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'articles': n_articles,
        'bodies': n_bodies,
        'shards': SHARDS,
        'years': years,
        'counts': counts,
    }
    with open(os.path.join(OUT, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    total_bytes += os.path.getsize(os.path.join(OUT, 'ids.json'))
    total_bytes += os.path.getsize(os.path.join(OUT, 'meta.json'))
    print(f'distinct bigrams: {total_grams} | index total: {total_bytes / 1048576:.1f} MiB '
          f'| elapsed: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
