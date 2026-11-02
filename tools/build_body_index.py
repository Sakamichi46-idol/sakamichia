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
# 3文字以上のクエリ用トライグラム索引（data/body-index3/）。形式はバイグラムと
# 同じ発想で、レコードのキーが u16le ×3（48bit）になる。シャード数は128。
OUT3 = os.path.join(BASE, 'data', 'body-index3')
SHARDS3 = 128
# 4文字以上のクエリ用 4-gram 索引（data/body-index4/）。
# トライグラムだけでは「卒業します」のような検索で、断片（卒業し／業しま／します）
# が別々に現れる記事が混ざるため、4文字以上はない交わりをさらに絞る。
# レコードのキーは 4-gram そのもの（64bit）ではなく FNV-1a 32bit ハッシュにする
# （JS の数値精度に収まり、キー保存も小さくなる）。ハッシュが衝突した 4-gram 同士は
# ポスティングが合体する（ヒット漏れはなく、外れがごく僅かに増えるだけ）。
OUT4 = os.path.join(BASE, 'data', 'body-index4')
SHARDS4 = 256

# 除去する空白類（blog.js の BWS と一致させること）
STRIP_TABLE = {ord(c): None for c in ' \t\n\r　'}


def bigram_shard(u1, u2):
    h = 0x811C9DC5
    h ^= u1
    h = (h * 0x01000193) & 0xFFFFFFFF
    h ^= u2
    h = (h * 0x01000193) & 0xFFFFFFFF
    return h % SHARDS


def trigram_shard(u1, u2, u3):
    h = 0x811C9DC5
    for u in (u1, u2, u3):
        h ^= u
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h % SHARDS3


def quadgram_hash(u1, u2, u3, u4):
    h = 0x811C9DC5
    for u in (u1, u2, u3, u4):
        h ^= u
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def quadgram_shard(u1, u2, u3, u4):
    return quadgram_hash(u1, u2, u3, u4) % SHARDS4


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
    # 一時ファイルは /tmp ではなく data/ の下に作る（/tmp が小さい環境では
    # バイグラム＋トライグラムのペア書き出しで溢れるため）。data/.gitignore 対象。
    tmpdir = tempfile.mkdtemp(prefix='.body-index-tmp-', dir=os.path.join(BASE, 'data'))
    bufs = [bytearray() for _ in range(SHARDS)]
    files = [open(os.path.join(tmpdir, f'pairs-{n}.bin'), 'wb') for n in range(SHARDS)]
    bufs3 = [bytearray() for _ in range(SHARDS3)]
    files3 = [open(os.path.join(tmpdir, f'pairs3-{n}.bin'), 'wb') for n in range(SHARDS3)]
    bufs4 = [bytearray() for _ in range(SHARDS4)]
    files4 = [open(os.path.join(tmpdir, f'pairs4-{n}.bin'), 'wb') for n in range(SHARDS4)]
    n_bodies = 0
    n_unknown = 0
    n_postings = 0
    n_postings3 = 0
    n_postings4 = 0
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
                # トライグラム（6バイト窓）も同じ走査で集める
                if len(stripped) >= 3:
                    grams3 = {b[i:i + 6] for i in range(0, len(b) - 5, 2)}
                    for g in grams3:
                        u1 = g[0] | (g[1] << 8)
                        u2 = g[2] | (g[3] << 8)
                        u3 = g[4] | (g[5] << 8)
                        sh = trigram_shard(u1, u2, u3)
                        bufs3[sh] += g
                        bufs3[sh] += tail
                        n_postings3 += 1
                        if len(bufs3[sh]) >= 1 << 20:
                            files3[sh].write(bufs3[sh])
                            bufs3[sh] = bytearray()
                # 4-gram（8バイト窓）も同じ走査で集める
                if len(stripped) >= 4:
                    grams4 = {b[i:i + 8] for i in range(0, len(b) - 7, 2)}
                    for g in grams4:
                        u1 = g[0] | (g[1] << 8)
                        u2 = g[2] | (g[3] << 8)
                        u3 = g[4] | (g[5] << 8)
                        u4 = g[6] | (g[7] << 8)
                        sh = quadgram_shard(u1, u2, u3, u4)
                        bufs4[sh] += g
                        bufs4[sh] += tail
                        n_postings4 += 1
                        if len(bufs4[sh]) >= 1 << 20:
                            files4[sh].write(bufs4[sh])
                            bufs4[sh] = bytearray()
        for n in range(SHARDS):
            if bufs[n]:
                files[n].write(bufs[n])
            files[n].close()
        for n in range(SHARDS3):
            if bufs3[n]:
                files3[n].write(bufs3[n])
            files3[n].close()
        for n in range(SHARDS4):
            if bufs4[n]:
                files4[n].write(bufs4[n])
            files4[n].close()
    finally:
        for f in files + files3 + files4:
            try:
                f.close()
            except Exception:
                pass
    print(f'bodies indexed: {n_bodies} | unknown ids skipped: {n_unknown} '
          f'| postings: {n_postings} | trigram postings: {n_postings3} '
          f'| quadgram postings: {n_postings4} | pass1: {time.time() - t0:.1f}s')

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

    # --- 3b. トライグラムのシャード書き出し（data/body-index3/） ---
    os.makedirs(OUT3, exist_ok=True)
    total_bytes3 = 0
    total_grams3 = 0
    for n in range(SHARDS3):
        with open(os.path.join(tmpdir, f'pairs3-{n}.bin'), 'rb') as f:
            raw = f.read()
        recs = []
        for off in range(0, len(raw), 10):
            key = int.from_bytes(raw[off:off + 6], 'little')
            num = int.from_bytes(raw[off + 6:off + 10], 'little')
            recs.append((key, num))
        recs.sort()
        out = bytearray()
        out += b'\x00\x00\x00\x00'  # K は後で埋める
        k = 0
        i = 0
        total = len(recs)
        while i < total:
            key = recs[i][0]
            nums = []
            while i < total and recs[i][0] == key:
                nums.append(recs[i][1])
                i += 1
            out += key.to_bytes(6, 'little')
            out += struct.pack('<I', len(nums))
            prev = 0
            for v in nums:
                write_varint(out, v - prev)
                prev = v
            k += 1
        struct.pack_into('<I', out, 0, k)
        with open(os.path.join(OUT3, f'shard-{n}.bin'), 'wb') as f:
            f.write(out)
        total_bytes3 += len(out)
        total_grams3 += k
        os.remove(os.path.join(tmpdir, f'pairs3-{n}.bin'))

    # --- 3c. 4-gram のシャード書き出し（data/body-index4/、一時レコードは12バイト） ---
    # 書き出し形式: K のあと、キー昇順に「キー差分 varint / 件数 varint /
    # 記事番号の差分 varint ×件数」。キーは FNV-1a 32bit ハッシュ値。
    os.makedirs(OUT4, exist_ok=True)
    total_bytes4 = 0
    total_grams4 = 0
    for n in range(SHARDS4):
        with open(os.path.join(tmpdir, f'pairs4-{n}.bin'), 'rb') as f:
            raw = f.read()
        recs = []
        for off in range(0, len(raw), 12):
            g = raw[off:off + 8]
            u1 = g[0] | (g[1] << 8)
            u2 = g[2] | (g[3] << 8)
            u3 = g[4] | (g[5] << 8)
            u4 = g[6] | (g[7] << 8)
            key = quadgram_hash(u1, u2, u3, u4)
            num = int.from_bytes(raw[off + 8:off + 12], 'little')
            recs.append((key, num))
        recs.sort()
        out = bytearray()
        out += b'\x00\x00\x00\x00'  # K は後で埋める
        k = 0
        i = 0
        total = len(recs)
        prev_key = 0
        while i < total:
            key = recs[i][0]
            nums = []
            while i < total and recs[i][0] == key:
                nums.append(recs[i][1])
                i += 1
            write_varint(out, key - prev_key)
            prev_key = key
            write_varint(out, len(nums))
            prev = 0
            for v in nums:
                write_varint(out, v - prev)
                prev = v
            k += 1
        struct.pack_into('<I', out, 0, k)
        with open(os.path.join(OUT4, f'shard-{n}.bin'), 'wb') as f:
            f.write(out)
        total_bytes4 += len(out)
        total_grams4 += k
        os.remove(os.path.join(tmpdir, f'pairs4-{n}.bin'))
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
    # トライグラム側の ids / meta（記事番号の付け方はバイグラムと共通）
    with open(os.path.join(OUT3, 'ids.json'), 'w', encoding='utf-8') as f:
        json.dump(ids, f, ensure_ascii=False, separators=(',', ':'))
    meta3 = dict(meta)
    meta3['shards'] = SHARDS3
    with open(os.path.join(OUT3, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta3, f, ensure_ascii=False, indent=1)
    print(f'distinct trigrams: {total_grams3} | trigram index total: '
          f'{total_bytes3 / 1048576:.1f} MiB | elapsed: {time.time() - t0:.1f}s')
    # 4-gram 側の ids / meta
    with open(os.path.join(OUT4, 'ids.json'), 'w', encoding='utf-8') as f:
        json.dump(ids, f, ensure_ascii=False, separators=(',', ':'))
    meta4 = dict(meta)
    meta4['shards'] = SHARDS4
    with open(os.path.join(OUT4, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta4, f, ensure_ascii=False, indent=1)
    print(f'distinct quadgrams: {total_grams4} | quadgram index total: '
          f'{total_bytes4 / 1048576:.1f} MiB | elapsed: {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
