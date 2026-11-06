#!/usr/bin/env python3
"""アナグラム（ミニゲーム）用の検証済みシャッフルを事前生成する。

ユーザーの条件「アナグラムされたものが、文章としてある程度成立していること」
を満たすため、シャッフルはランダムではなく次を必須とする:

  シャッフル結果の文字列が、形態素解析辞書 IPADIC (mecab-ipadic 2.7.0) の
  語彙だけで「未知語なく全分割」できること（単一単語でも複数単語の連なりでも可）。

判定は MeCab 本体ではなく、IPADIC の CSV 語彙に対する厳密被覆探索で行う。
（カタカナだけの文字列は形態素解析器にかけても未知語として丸ごと返ることが多く、
語彙集合への被覆判定の方が「辞書の単語に分割できるか」の判定として正確なため。
動詞・形容詞は基本形に加えて連用形も語彙に含める＝複合動詞「履きかかる」の
ような連用形＋基本形の連なりも分割可能とみなす。これは形態素解析が実際に
行う分割（例: ハキカカル → 履き＋掛かる）と一致する。）

素材の範囲:
  メンバー: 読みがカタカナにできる全員（文字数の下限は2、上限なし）
  楽曲    : 「その他」を除く全曲のうち、読みがカナだけで表せるもの
            （文字数の上限なし。35文字級も含む）
関門は上記の辞書判定1つだけ。検証を通らない素材はプールに入らない。
長い素材は探索が重くなるため、素材ごとに探索予算（ノード数と秒数）を設け、
予算超過は「検証不通過」として扱う。

探索は2系統を使い分ける:
  9文字以下: 素材の文字マルチセットに対する単語の厳密被覆 DFS（従来方式）
  10文字以上と組み合わせ: 「最も候補の少ない文字」から伸ばす DFS
  （部分マルチセットの列挙を避けるため、文字→単語の索引で候補を引く。
  10〜11文字は従来方式だとノード上限まで空転しやすいためこちらを使う）

選定基準（良い順）: 単語数が少ない → 1文字ピースが少ない
→ 元の文字列の連続部分文字列（3文字以上）をそのまま含むピースが少ない
（元の語の塊が残っていると「並べ替えた」感が薄いため）
→ 最長単語が長い → ピースの IPADIC コスト合計が小さい（ありふれた単語の
連なりほど自然に読める）→ 元の位置のままの文字が少ない。
単体は各素材につき最大3個を残す。

採用条件（単体）:
  - 元の文字列と異なる
  - 元の位置のままの文字数 <= floor(文字数 / 3)
  - 単語数 <= max(2, ceil(文字数 / 2))、1文字ピースは1個まで
  - 5文字以上の素材では最長単語が3文字以上

複数個バージョン（組み合わせ）:
  採用済みの単体素材から2個・3個の組み合わせをランダムに作り、混ぜた全体が
  同じ条件で分割できるシャッフルを事前に検証して収録する。カテゴリ
  （メンバー同士／楽曲同士／混成）×個数（2・3）の6区分で確保する。
  採用条件は単体と同じ考え方で、「元の位置」は構成素材の連結順の全順列のうち
  最も一致が少ないものと比べて判定する。各組み合わせにつき最大2個を残す。

辞書が無い場合は Debian の pool から mecab-ipadic の原 tarball を取得して
~/workspace/sakamichia-import/anagram-dic/ に展開する（リポジトリには入れない）。

出力: data/anagram.json
使い方: python3 tools/build_anagram.py
"""
import csv
import itertools
import json
import math
import random
import re
import sys
import tarfile
import time
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DIC_HOME = Path.home() / "workspace" / "sakamichia-import" / "anagram-dic"
DIC_DIR = DIC_HOME / "ipadic"
DIC_URL = ("http://deb.debian.org/debian/pool/main/m/mecab-ipadic/"
           "mecab-ipadic_2.7.0-20070801+main.orig.tar.gz")
OUT = REPO / "data" / "anagram.json"

KANA_RE = re.compile(r"^[ァ-ヶヰヱヲー]+$")
DIC_FILES = [
    "Noun.csv", "Noun.adjv.csv", "Noun.adverbal.csv", "Noun.demonst.csv",
    "Noun.nai.csv", "Noun.name.csv", "Noun.number.csv", "Noun.org.csv",
    "Noun.others.csv", "Noun.place.csv", "Noun.proper.csv", "Noun.verbal.csv",
    "Verb.csv", "Adj.csv", "Adverb.csv", "Adnominal.csv", "Conjunction.csv",
    "Interjection.csv", "Filler.csv", "Postp.csv", "Postp-col.csv", "Auxil.csv",
]
NODE_CAP = 300_000
RESULT_CAP = 600
KEEP = 20
KEEP_COMBO = 20
COMBO_TARGET = 300          # カテゴリ×個数ごとの採用目標
COMBO_MAX_ATTEMPTS = 3000   # カテゴリ×個数ごとの試行上限
COMBO_MAX_LEN = 10 ** 9     # 組み合わせ全体の文字数上限（ユーザー方針で実質無制限：長い組み合わせも採用する）
COMBO_SEED = 20261104


def ensure_dictionary() -> Path:
    if DIC_DIR.is_dir() and (DIC_DIR / "Verb.csv").exists():
        return DIC_DIR
    DIC_HOME.mkdir(parents=True, exist_ok=True)
    tar_path = DIC_HOME / "mecab-ipadic.orig.tar.gz"
    if not tar_path.exists():
        print(f"辞書をダウンロードします: {DIC_URL}")
        urllib.request.urlretrieve(DIC_URL, tar_path)
    with tarfile.open(tar_path) as tf:
        tf.extractall(DIC_HOME / "src", filter="data")
    src = next((DIC_HOME / "src").glob("mecab-ipadic-*/"))
    src.rename(DIC_DIR)
    return DIC_DIR


def build_lexicon(dic: Path):
    """(語彙集合, 読み -> 採用エントリ内の最小 IPADIC コスト) を返す。"""
    lex = set()
    cost = {}
    for fn in DIC_FILES:
        path = dic / fn
        if not path.exists():
            continue
        with open(path, encoding="euc-jp") as f:
            for row in csv.reader(f):
                if len(row) < 12:
                    continue
                surf, pos, cform, reading = row[0], row[4], row[9], row[11]
                if not reading or not KANA_RE.match(reading):
                    continue
                keep = False
                if pos in ("名詞", "副詞", "連体詞", "接続詞", "感動詞", "フィラー"):
                    keep = len(reading) >= 2 or (pos == "名詞" and len(surf) == 1)
                elif pos == "助詞":
                    keep = True
                elif pos == "助動詞":
                    keep = cform == "基本形"
                elif pos in ("動詞", "形容詞"):
                    keep = cform in ("基本形", "連用形") and len(reading) >= 2
                if keep:
                    lex.add(reading)
                    try:
                        c = int(row[3])
                    except ValueError:
                        c = 99999
                    if reading not in cost or c < cost[reading]:
                        cost[reading] = c
    return lex, cost


def hira_to_kata(s: str) -> str:
    return "".join(chr(ord(c) + 0x60) if "ぁ" <= c <= "ゖ" else c for c in (s or ""))


def load_materials():
    """文字数で切らず、読みがカナで表せる全素材を返す（下限は2文字）。"""
    members = json.loads((REPO / "data" / "members.json").read_text(encoding="utf-8"))
    songs = json.loads((REPO / "data" / "songs.json").read_text(encoding="utf-8"))
    mem, son = [], []
    for m in members:
        kata = hira_to_kata(m.get("reading", ""))
        if len(kata) >= 2 and KANA_RE.match(kata):
            mem.append({"name": m["name"], "group": m.get("group", ""), "kata": kata})
    for s in songs:
        if s.get("group") == "その他":
            continue
        kata = hira_to_kata(s.get("yomi", ""))
        if len(kata) >= 2 and KANA_RE.match(kata):
            son.append({"title": s["title"], "group": s.get("group", ""),
                        "year": s.get("year"), "kata": kata})
    return mem, son


class CoverFinder:
    """短い素材用: 部分マルチセット列挙＋厳密被覆 DFS（従来方式）。"""

    def __init__(self, lex: set):
        self.sig_index = defaultdict(list)
        for w in lex:
            self.sig_index["".join(sorted(w))].append(w)

    def _pieces(self, word: str):
        letters = Counter(word)
        items = sorted(letters.items())
        pieces = {}

        def rec(i, cur):
            if i == len(items):
                if cur:
                    sig = "".join(cur)
                    for w in self.sig_index.get(sig, ()):
                        pieces[w] = sig
                return
            ch, cnt = items[i]
            for k in range(cnt + 1):
                rec(i + 1, cur + [ch] * k)

        rec(0, [])
        return pieces

    def covers(self, word: str):
        """word の文字をちょうど使い切る単語列を列挙し、
        文字列 -> 最良（最少単語数）の分割 を返す。"""
        pieces = self._pieces(word)
        ordered = sorted(pieces.items(), key=lambda kv: -len(kv[0]))
        piece_counts = [(w, Counter(sig)) for w, sig in ordered]
        results = {}
        nodes = [0]
        dead = set()

        def dfs(rem: Counter, built: str, words: list):
            if nodes[0] > NODE_CAP or len(results) >= RESULT_CAP:
                return
            nodes[0] += 1
            if not rem:
                if built not in results or len(words) < len(results[built]):
                    results[built] = list(words)
                return
            key = "".join(sorted(rem.elements()))
            if key in dead:
                return
            before = len(results)
            for w, need in piece_counts:
                if all(rem[c] >= n for c, n in need.items()):
                    dfs(rem - need, built + w, words + [w])
                    if nodes[0] > NODE_CAP:
                        return
            if len(results) == before:
                dead.add(key)

        dfs(Counter(word), "", [])
        return results, nodes[0] > NODE_CAP


class CoverSearch:
    """長い素材・組み合わせ用: 「最も候補の少ない文字」から伸ばす DFS。

    候補は文字→単語の索引で引き、予算（ノード数・秒数）を超えたら打ち切る。
    rng を渡すと候補順をシャッフルする（再試行で多様な被覆を探す用）。
    """

    def __init__(self, lex: set):
        self.by_letter = defaultdict(list)
        for w in lex:
            c = Counter(w)
            for ch in c:
                self.by_letter[ch].append((w, c))
        for ch in self.by_letter:
            self.by_letter[ch].sort(key=lambda wc: (-len(wc[0]), wc[0]))

    def covers(self, target: str, rng=None, node_budget=150_000,
               result_cap=200, time_budget=10.0):
        t_end = time.time() + time_budget
        results = {}
        nodes = [0]
        dead = set()
        tc = Counter(target)
        cand = {}
        for ch in tc:
            cand[ch] = [(w, c) for (w, c) in self.by_letter.get(ch, ())
                        if all(tc[k] >= v for k, v in c.items())]

        def dfs(rem: Counter, words: list):
            if nodes[0] >= node_budget or len(results) >= result_cap:
                return
            nodes[0] += 1
            if nodes[0] % 4096 == 0 and time.time() > t_end:
                nodes[0] = node_budget
                return
            if not rem:
                results["".join(words)] = list(words)
                return
            key = "".join(sorted(rem.elements()))
            if key in dead:
                return
            best = None
            for ch in list(rem):
                cs = [wc for wc in cand.get(ch, ())
                      if all(rem[k] >= v for k, v in wc[1].items())]
                if not cs:
                    dead.add(key)
                    return
                if best is None or len(cs) < len(best):
                    best = cs
                    if len(best) == 1:
                        break
            order = list(best)
            if rng is not None:
                rng.shuffle(order)
            before = len(results)
            for w, c in order:
                dfs(rem - c, words + [w])
                if nodes[0] >= node_budget:
                    return
            if len(results) == before:
                dead.add(key)

        dfs(tc, [])
        return results, nodes[0] >= node_budget


def find_covers(short_finder: CoverFinder, long_finder: CoverSearch,
                kata: str, rng=None):
    """長さで探索器を使い分け、(被覆 dict, 予算到達か) を返す。"""
    if len(kata) <= 9:
        return short_finder.covers(kata)
    results, capped = long_finder.covers(
        kata, node_budget=250_000, result_cap=600, time_budget=15.0)
    if not results:
        # 決定的な探索で見つからなければ、候補順を変えて再試行する
        r = rng or random.Random(12345)
        for _ in range(2):
            more, capped = long_finder.covers(
                kata, rng=r, node_budget=120_000, result_cap=600, time_budget=8.0)
            results.update(more)
            if results:
                break
    return results, capped


def fixed_pos(a: str, b: str) -> int:
    return sum(1 for x, y in zip(a, b) if x == y)


def rank_key(word: str, text: str, words: list, cost: dict, fx: int):
    one = sum(1 for w in words if len(w) == 1)
    longest = max(len(w) for w in words)
    block = sum(len(w) for w in words if len(w) >= 3 and w in word)
    total_cost = sum(cost.get(w, 99999) for w in words)
    return (len(words), one, block, -longest, total_cost, fx, text)


def quality_ok(n: int, words: list, fx: int) -> bool:
    if fx > n // 3:
        return False
    one = sum(1 for w in words if len(w) == 1)
    longest = max(len(w) for w in words)
    if len(words) > max(2, math.ceil(n / 2)) or one > 1:
        return False
    if n >= 5 and longest < 3:
        return False
    return True


def select_shuffles(word: str, results: dict, cost: dict):
    n = len(word)
    cands = []
    for text, words in results.items():
        if text == word or text == word[::-1]:
            continue
        fx = fixed_pos(text, word)
        if quality_ok(n, words, fx):
            cands.append((rank_key(word, text, words, cost, fx), text, words))
    cands.sort(key=lambda x: x[0])
    return [{"t": text, "w": words} for _, text, words in cands[:KEEP]]


def select_combo_shuffles(katas: list, results: dict, cost: dict):
    total = "".join(katas)
    n = len(total)
    orders = {"".join(p) for p in itertools.permutations(katas)}
    cands = []
    for text, words in results.items():
        if text in orders or text == total[::-1]:
            continue
        fx = min(fixed_pos(text, o) for o in orders)
        if quality_ok(n, words, fx):
            cands.append((rank_key(total, text, words, cost, fx), text, words))
    cands.sort(key=lambda x: x[0])
    return [{"t": text, "w": words} for _, text, words in cands[:KEEP_COMBO]]


def band_of(n: int) -> str:
    if n <= 3:
        return "2-3"
    if n <= 9:
        return "4-9"
    if n <= 13:
        return "10-13"
    return "14+"


def main() -> int:
    dic = ensure_dictionary()
    t0 = time.time()
    lex, cost = build_lexicon(dic)
    print(f"辞書語彙: {len(lex)} 語")
    short_finder = CoverFinder(lex)
    long_finder = CoverSearch(lex)
    mem, son = load_materials()
    print(f"素材（辞書判定前）: メンバー {len(mem)} / 楽曲 {len(son)}")

    out = {"generated": time.strftime("%Y-%m-%d"),
           "dict": "IPADIC (mecab-ipadic 2.7.0-20070801)",
           "members": [], "songs": [], "combos": []}

    # ---- 単体 ----
    for key, mats in (("members", mem), ("songs", son)):
        kept = dropped = capped = 0
        drop_no_cover = drop_quality = 0
        bands = defaultdict(lambda: [0, 0])  # band -> [候補, 採用]
        for mat in mats:
            results, hit_cap = find_covers(short_finder, long_finder, mat["kata"])
            if hit_cap:
                capped += 1
            shuffles = select_shuffles(mat["kata"], results, cost)
            bands[band_of(len(mat["kata"]))][0] += 1
            if not shuffles:
                dropped += 1
                if results:
                    drop_quality += 1
                else:
                    drop_no_cover += 1
                continue
            kept += 1
            bands[band_of(len(mat["kata"]))][1] += 1
            entry = {k: v for k, v in mat.items()}
            entry["shuffles"] = shuffles
            out[key].append(entry)
        print(f"{key}: 採用 {kept} / 除外 {dropped}"
              f"（被覆なし {drop_no_cover}・品質条件で不採用 {drop_quality}・"
              f"探索上限到達 {capped}）")
        for b in ("2-3", "4-9", "10-13", "14+"):
            if bands[b][0]:
                print(f"    長さ {b}: 候補 {bands[b][0]} → 採用 {bands[b][1]}")

    # ---- 組み合わせ（複数個バージョン） ----
    rng = random.Random(COMBO_SEED)
    mem_pool = out["members"]
    son_pool = out["songs"]

    def ref_m(e):
        return {"k": "m", "name": e["name"], "group": e["group"], "kata": e["kata"]}

    def ref_s(e):
        return {"k": "s", "title": e["title"], "group": e["group"],
                "year": e["year"], "kata": e["kata"]}

    buckets = []
    for cnt in (2, 3):
        buckets.append((f"memberx{cnt}", cnt,
                        lambda n=cnt: [ref_m(e) for e in rng.sample(mem_pool, n)]))
        buckets.append((f"songx{cnt}", cnt,
                        lambda n=cnt: [ref_s(e) for e in rng.sample(son_pool, n)]))
        buckets.append((f"mixx{cnt}", cnt, None))

    def mix_sampler(cnt):
        nm = rng.randint(1, cnt - 1)
        return ([ref_m(e) for e in rng.sample(mem_pool, nm)]
                + [ref_s(e) for e in rng.sample(son_pool, cnt - nm)])

    combo_stats = {}
    seen_sets = set()
    seen_sigs = set()
    for label, cnt, sampler in buckets:
        if sampler is None:
            sampler = (lambda n=cnt: mix_sampler(n))
        kept = attempts = over_len = 0
        while kept < COMBO_TARGET and attempts < COMBO_MAX_ATTEMPTS:
            attempts += 1
            items = sampler()
            set_key = tuple(sorted((it["k"], it["kata"],
                                    it.get("name") or it.get("title")) for it in items))
            if set_key in seen_sets:
                continue
            seen_sets.add(set_key)
            total = "".join(it["kata"] for it in items)
            if len(total) > COMBO_MAX_LEN:
                over_len += 1
                continue
            if "".join(sorted(total)) in seen_sigs:
                continue
            katas = [it["kata"] for it in items]
            if len(total) <= 9:
                results, _cap = short_finder.covers(total)
            else:
                results, _cap = long_finder.covers(
                    total, node_budget=90_000, result_cap=600, time_budget=10.0)
            shuffles = select_combo_shuffles(katas, results, cost)
            if not shuffles:
                results2, _ = long_finder.covers(
                    total, rng=rng, node_budget=90_000, result_cap=600,
                    time_budget=5.0)
                shuffles = select_combo_shuffles(katas, results2, cost)
            if not shuffles:
                continue
            seen_sigs.add("".join(sorted(total)))
            out["combos"].append({"items": items, "kata": total,
                                  "shuffles": shuffles})
            kept += 1
        combo_stats[label] = (kept, attempts, over_len)
        print(f"組み合わせ {label}: 採用 {kept}（試行 {attempts}・"
              f"長さ上限で見送り {over_len}）")

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"書き出し: {OUT} ({OUT.stat().st_size/1024:.0f} KB, {time.time()-t0:.1f}s)")

    # 検証例: 賀喜遥香 かきはるか → ハキカカル（履きかかる）が有効か
    for e in out["members"]:
        if e["name"] == "賀喜遥香":
            texts = [s["t"] for s in e["shuffles"]]
            allres, _ = find_covers(short_finder, long_finder, e["kata"])
            print(f"検証 賀喜遥香({e['kata']}): 採用シャッフル {texts} / "
                  f"ハキカカル: 有効候補として生成 {'済み' if 'ハキカカル' in allres else 'されず'}、"
                  f"採用 {'内' if 'ハキカカル' in texts else '外'}")
    # 生成例サンプル
    print("\n生成例（単体）:")
    shown = 0
    for key in ("members", "songs"):
        for e in out[key]:
            if shown >= 6:
                break
            s = e["shuffles"][0]
            label = e.get("name") or e.get("title")
            print(f"  {label}（{e['kata']}）→ {s['t']} ［{'＋'.join(s['w'])}］")
            shown += 1
    print("\n生成例（組み合わせ）:")
    for c in out["combos"][:5]:
        names = "＋".join(it.get("name") or it.get("title") for it in c["items"])
        s = c["shuffles"][0]
        print(f"  {names}（{c['kata']}）→ {s['t']} ［{'＋'.join(s['w'])}］")
    return 0


if __name__ == "__main__":
    sys.exit(main())
