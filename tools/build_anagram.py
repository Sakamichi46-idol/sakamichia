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

語彙の採用範囲（IPADIC の読みフィールドがカナのみのもの）:
  名詞・副詞・連体詞・接続詞・感動詞・フィラー : 読み2文字以上
      （ただし表層1文字の名詞は読み1文字でも採用。例: 蚊=カ、春=ハル は2文字）
  助詞                                       : すべて（1文字助詞を含む）
  助動詞                                     : 基本形のみ
  動詞・形容詞                               : 基本形と連用形、読み2文字以上

候補の探索は順列の列挙ではなく、素材の文字マルチセットに対する
単語の厳密被覆 DFS（部分集合は辞書のシグネチャ索引で引く）。
選定基準（良い順）: 単語数が少ない → 1文字ピースが少ない
→ 元の文字列の連続部分文字列（3文字以上）をそのまま含むピースが少ない
（元の語の塊が残っていると「並べ替えた」感が薄いため）
→ 最長単語が長い → ピースの IPADIC コスト合計が小さい（ありふれた単語の
連なりほど自然に読める）→ 元の位置のままの文字が少ない。
各素材につき最大3個を残す。

採用条件（これを満たす候補が1つも無い素材はプールから外れる）:
  - 元の文字列と異なる
  - 元の位置のままの文字数 <= floor(文字数 / 3)
  - 単語数 <= max(2, ceil(文字数 / 2))、1文字ピースは1個まで
  - 5文字以上の素材では最長単語が3文字以上

辞書が無い場合は Debian の pool から mecab-ipadic の原 tarball を取得して
~/workspace/sakamichia-import/anagram-dic/ に展開する（リポジトリには入れない）。

出力: data/anagram.json
使い方: python3 tools/build_anagram.py
"""
import csv
import io
import json
import math
import re
import subprocess
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
KEEP = 3


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
    members = json.loads((REPO / "data" / "members.json").read_text(encoding="utf-8"))
    songs = json.loads((REPO / "data" / "songs.json").read_text(encoding="utf-8"))
    mem, son = [], []
    for m in members:
        kata = hira_to_kata(m.get("reading", ""))
        if 4 <= len(kata) <= 8 and KANA_RE.match(kata):
            mem.append({"name": m["name"], "group": m.get("group", ""), "kata": kata})
    for s in songs:
        if s.get("group") == "その他":
            continue
        kata = hira_to_kata(s.get("yomi", ""))
        if 4 <= len(kata) <= 9 and KANA_RE.match(kata):
            son.append({"title": s["title"], "group": s.get("group", ""),
                        "year": s.get("year"), "kata": kata})
    return mem, son


class CoverFinder:
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


def fixed_pos(a: str, b: str) -> int:
    return sum(1 for x, y in zip(a, b) if x == y)


def select_shuffles(word: str, results: dict, cost: dict):
    n = len(word)
    max_fixed = n // 3
    max_words = max(2, math.ceil(n / 2))
    cands = []
    for text, words in results.items():
        if text == word:
            continue
        fx = fixed_pos(text, word)
        if fx > max_fixed:
            continue
        one = sum(1 for w in words if len(w) == 1)
        longest = max(len(w) for w in words)
        if len(words) > max_words or one > 1:
            continue
        if n >= 5 and longest < 3:
            continue
        block = sum(len(w) for w in words if len(w) >= 3 and w in word)
        total_cost = sum(cost.get(w, 99999) for w in words)
        cands.append(((len(words), one, block, -longest, total_cost, fx, text), text, words))
    cands.sort(key=lambda x: x[0])
    return [{"t": text, "w": words} for _, text, words in cands[:KEEP]]


def main() -> int:
    dic = ensure_dictionary()
    t0 = time.time()
    lex, cost = build_lexicon(dic)
    print(f"辞書語彙: {len(lex)} 語")
    finder = CoverFinder(lex)
    mem, son = load_materials()
    print(f"素材（辞書判定前）: メンバー {len(mem)} / 楽曲 {len(son)}")

    out = {"generated": time.strftime("%Y-%m-%d"),
           "dict": "IPADIC (mecab-ipadic 2.7.0-20070801)",
           "members": [], "songs": []}
    stats = {}
    for key, mats in (("members", mem), ("songs", son)):
        kept = dropped = capped = 0
        for mat in mats:
            results, hit_cap = finder.covers(mat["kata"])
            if hit_cap:
                capped += 1
            shuffles = select_shuffles(mat["kata"], results, cost)
            if not shuffles:
                dropped += 1
                continue
            kept += 1
            entry = {k: v for k, v in mat.items()}
            entry["shuffles"] = shuffles
            out[key].append(entry)
        stats[key] = (kept, dropped, capped)
        print(f"{key}: 採用 {kept} / 除外 {dropped}（探索上限到達 {capped}）")

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"書き出し: {OUT} ({OUT.stat().st_size/1024:.0f} KB, {time.time()-t0:.1f}s)")

    # 検証例: 賀喜遥香 かきはるか → ハキカカル（履きかかる）が有効か
    for e in out["members"]:
        if e["name"] == "賀喜遥香":
            texts = [s["t"] for s in e["shuffles"]]
            allres, _ = finder.covers(e["kata"])
            print(f"検証 賀喜遥香({e['kata']}): 採用シャッフル {texts} / "
                  f"ハキカカル: 有効候補として生成 {'済み' if 'ハキカカル' in allres else 'されず'}、"
                  f"採用 {'内' if 'ハキカカル' in texts else '外'}")
    # 生成例サンプル
    print("\n生成例:")
    shown = 0
    for key in ("members", "songs"):
        for e in out[key]:
            if shown >= 10:
                break
            s = e["shuffles"][0]
            label = e.get("name") or e.get("title")
            print(f"  {label}（{e['kata']}）→ {s['t']} ［{'＋'.join(s['w'])}］")
            shown += 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
