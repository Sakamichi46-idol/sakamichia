// アナグラム「その場生成」コア。ブラウザのワーカーと検証用 Node の両方から使う。
// Python 版（tools/build_anagram.py の CoverSearch／選択規則と
// anagram_sentences.py の文生成探索）の移植。品質ゲートは在庫と同じ:
// ・並びは辞書の単語の連結で、素材の並び順そのもの・逆読みは出さない
// ・元の位置のままの文字は全体の 1/3 まで、1文字ピースは1つまで 等
// ・「読める文章」は助詞を途中に含み、用言・体言で終わる分割だけを採用し、
//   分割した単語の表記（漢字など）を d として返す
(function (global) {
  "use strict";

  function cntOf(str) {
    const m = new Map();
    for (const ch of str) m.set(ch, (m.get(ch) || 0) + 1);
    return m;
  }
  function fits(rem, need) {
    for (const [ch, n] of need) if ((rem.get(ch) || 0) < n) return false;
    return true;
  }
  function subCnt(rem, need) {
    const out = new Map(rem);
    for (const [ch, n] of need) {
      const v = out.get(ch) - n;
      if (v <= 0) out.delete(ch); else out.set(ch, v);
    }
    return out;
  }
  function sortedKey(rem) {
    const chars = [...rem.keys()].sort();
    let s = "";
    for (const ch of chars) s += ch.repeat(rem.get(ch));
    return s;
  }
  function fixedPos(a, b) {
    let n = 0;
    const L = Math.min(a.length, b.length);
    for (let i = 0; i < L; i++) if (a[i] === b[i]) n++;
    return n;
  }
  function hira(s) {
    let out = "";
    for (const ch of s) {
      const c = ch.codePointAt(0);
      out += (c >= 0x30a1 && c <= 0x30f6) ? String.fromCodePoint(c - 0x60) : ch;
    }
    return out;
  }
  function permutations(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      for (const p of permutations(rest)) out.push([arr[i]].concat(p));
    }
    return out;
  }

  // pieces: [[読み(カタカナ), 表記, 品詞クラス, コスト], ...]
  function buildIndex(pieces) {
    const ps = pieces.map(([r, surf, cls, cost]) => ({ r, surf, cls, cost, cnt: cntOf(r) }));
    const costOf = new Map();
    const byLetter = new Map(); // 通常シャッフル用: 文字 -> [{w, cnt}]
    for (const p of ps) {
      if (!costOf.has(p.r) || p.cost < costOf.get(p.r)) costOf.set(p.r, p.cost);
    }
    for (const w of costOf.keys()) {
      const cnt = cntOf(w);
      for (const ch of cnt.keys()) {
        if (!byLetter.has(ch)) byLetter.set(ch, []);
        byLetter.get(ch).push({ w, cnt });
      }
    }
    for (const lst of byLetter.values()) lst.sort((a, b) => (b.w.length - a.w.length) || (a.w < b.w ? -1 : 1));
    return { pieces: ps, costOf, byLetter };
  }

  // ---- 通常シャッフル: 「最も候補の少ない文字」から伸ばす被覆探索 ----
  function covers(idx, target, opts) {
    const nodeBudget = opts.nodeBudget || 90000;
    const resultCap = opts.resultCap || 200;
    const tEnd = Date.now() + (opts.timeMs || 10000);
    const rng = opts.rng || null;
    const tc = cntOf(target);
    const cand = new Map();
    for (const ch of tc.keys()) {
      cand.set(ch, (idx.byLetter.get(ch) || []).filter(wc => fits(tc, wc.cnt)));
    }
    const results = new Map();
    const dead = new Set();
    let nodes = 0, capped = false;
    function dfs(rem, words) {
      if (nodes >= nodeBudget || results.size >= resultCap) { capped = nodes >= nodeBudget; return; }
      nodes++;
      if ((nodes & 4095) === 0 && Date.now() > tEnd) { nodes = nodeBudget; capped = true; return; }
      if (rem.size === 0) { results.set(words.join(""), words.slice()); return; }
      const key = sortedKey(rem);
      if (dead.has(key)) return;
      let best = null;
      for (const ch of rem.keys()) {
        const cs = (cand.get(ch) || []).filter(wc => fits(rem, wc.cnt));
        if (!cs.length) { dead.add(key); return; }
        if (best === null || cs.length < best.length) { best = cs; if (best.length === 1) break; }
      }
      const order = best.slice();
      if (rng) { for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } }
      const before = results.size;
      for (const wc of order) {
        dfs(subCnt(rem, wc.cnt), words.concat(wc.w));
        if (nodes >= nodeBudget) { capped = true; return; }
      }
      if (results.size === before) dead.add(key);
    }
    dfs(tc, []);
    return { results, capped };
  }

  function qualityOk(n, words, fx) {
    if (fx > Math.floor(n / 3)) return false;
    let one = 0, longest = 0;
    for (const w of words) { if (w.length === 1) one++; if (w.length > longest) longest = w.length; }
    if (words.length > Math.max(2, Math.ceil(n / 2)) || one > 1) return false;
    if (n >= 5 && longest < 3) return false;
    return true;
  }
  function rankKey(total, text, words, costOf, fx) {
    let one = 0, longest = 0, block = 0, cost = 0;
    for (const w of words) {
      if (w.length === 1) one++;
      if (w.length > longest) longest = w.length;
      if (w.length >= 3 && total.includes(w)) block += w.length;
      cost += costOf.has(w) ? costOf.get(w) : 99999;
    }
    return [words.length, one, block, -longest, cost, fx, text];
  }
  function cmpKey(a, b) {
    for (let i = 0; i < a.length - 1; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a[a.length - 1] < b[b.length - 1] ? -1 : 1;
  }
  // 組み合わせ用シャッフル候補（在庫の select_combo_shuffles と同じゲート）
  function comboCandidates(idx, katas, results) {
    const total = katas.join("");
    const n = total.length;
    const orders = new Set(permutations(katas).map(p => p.join("")));
    const rev = [...total].reverse().join("");
    const cands = [];
    for (const [text, words] of results) {
      if (orders.has(text) || text === rev) continue;
      let fx = Infinity;
      for (const o of orders) fx = Math.min(fx, fixedPos(text, o));
      if (qualityOk(n, words, fx)) cands.push({ key: rankKey(total, text, words, idx.costOf, fx), text, words });
    }
    cands.sort((a, b) => cmpKey(a.key, b.key));
    return cands;
  }

  // ---- 「読める文章」シャッフルの探索（品詞の並びで文らしくする） ----
  const FINAL_OK = new Set(["V", "A", "N", "D"]);
  const PRIO = {
    "": ["N", "O", "V", "A"],
    N: ["P", "V", "A", "D", "Vr", "Ar"],
    P: ["N", "V", "A", "O", "Vr", "Ar"],
    Vr: ["V", "A", "D", "N", "P"],
    Ar: ["V", "A", "D", "N", "P"],
    V: ["D", "P"],
    A: ["D", "P"],
    D: [],
    O: ["N", "V", "A"],
  };
  function searchSentences(idx, kata, opts) {
    const maxPieces = opts.maxPieces || 6;
    const keep = opts.keep || 3;
    const candCap = opts.candCap || 200;
    const nodeCap = opts.nodeCap || 80000;
    const tEnd = Date.now() + (opts.timeMs || 6000);
    const target = cntOf(kata);
    const n = kata.length;
    const rev = [...kata].reverse().join("");
    const fit = idx.pieces.filter(p => fits(target, p.cnt));
    const found = new Map(); // text -> {score, words, disp}
    const dead = new Set();
    let nodes = 0;
    function scoreOf(seq) {
      let s = 0;
      const last = seq[seq.length - 1].cls;
      if (last === "V" || last === "A") s += 30;
      else if (last === "D") s += 15;
      else if (last === "N") s += 10;
      let midP = 0, vr = 0, vm = 0, costSum = 0, oneN = 0;
      seq.forEach((p, i) => {
        if (p.cls === "P" && i > 0 && i < seq.length - 1) midP++;
        costSum += p.cost;
      });
      s += midP * 8;
      for (const p of seq.slice(0, -1)) {
        if (p.cls === "Vr") s += 4;
        if (p.cls === "V") s -= 3;
        if (p.cls === "N" && p.r.length === 1) oneN++;
      }
      s -= oneN * 2;
      if (seq.length >= 4 && seq.length <= 5) s += 5;
      s -= costSum / 2000.0;
      if (seq.some(p => /[一-龯]/.test(p.surf))) s += 4;
      let block = 0, bigBlock = false;
      for (const p of seq) {
        if (p.r.length >= 3 && kata.includes(p.r)) block += p.r.length;
        if (p.r.length >= 4 && kata.includes(p.r)) bigBlock = true;
      }
      s -= block * 2;
      if (bigBlock) s -= 15;
      return s;
    }
    function dfs(rem, seq) {
      if (nodes > nodeCap || found.size >= candCap) return;
      nodes++;
      if ((nodes & 2047) === 0 && Date.now() > tEnd) { nodes = nodeCap + 1; return; }
      if (rem.size === 0) {
        if (seq.length < 3) return;
        if (!FINAL_OK.has(seq[seq.length - 1].cls)) return;
        if (!seq.slice(1, -1).some(p => p.cls === "P")) return;
        if (seq.filter(p => ["N", "V", "A"].includes(p.cls)).length < 2) return;
        const text = seq.map(p => p.r).join("");
        if (text === kata || text === rev) return;
        if (fixedPos(text, kata) > Math.floor(n / 3)) return;
        const sc = scoreOf(seq);
        if (!found.has(text) || sc > found.get(text).score) {
          const disp = seq.map(p => (p.cls === "P" ? hira(p.r) : p.surf)).join("");
          found.set(text, { score: sc, words: seq.map(p => p.r), disp });
        }
        return;
      }
      if (seq.length >= maxPieces) return;
      const prev = seq.length ? seq[seq.length - 1].cls : "";
      const midP = seq.slice(1).some(p => p.cls === "P");
      const key = sortedKey(rem) + "|" + prev + "|" + seq.length + "|" + (midP ? 1 : 0);
      if (dead.has(key)) return;
      const before = found.size;
      const order = PRIO[prev] || [];
      const cands = [];
      for (const p of fit) if (fits(rem, p.cnt)) cands.push(p);
      cands.sort((a, b) => {
        const ia = order.indexOf(a.cls), ib = order.indexOf(b.cls);
        return ((ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib)) || (a.cost - b.cost);
      });
      for (const p of cands) {
        if (!seq.length && p.cls === "P") continue;
        if (prev === "P" && p.cls === "P" && seq.length >= 2 && seq[seq.length - 2].cls === "P") continue;
        if (p.cls === "O" && seq.some(q => q.cls === "O")) continue;
        dfs(subCnt(rem, p.cnt), seq.concat(p));
        if (nodes > nodeCap || found.size >= candCap) return;
      }
      if (found.size === before) dead.add(key);
    }
    dfs(target, []);
    const out = [...found.entries()].map(([t, v]) => ({ t, ...v })).sort((a, b) => b.score - a.score);
    const picked = [], seenSig = new Set();
    for (const e of out) {
      const sig = e.words[0] + " " + e.words[e.words.length - 1];
      if (seenSig.has(sig)) continue;
      seenSig.add(sig);
      picked.push({ t: e.t, w: e.words, d: e.disp });
      if (picked.length >= keep) return picked;
    }
    for (const e of out) {
      if (picked.some(p => p.t === e.t)) continue;
      picked.push({ t: e.t, w: e.words, d: e.disp });
      if (picked.length >= keep) break;
    }
    return picked;
  }

  // 2〜3素材の組み合わせ1問分を生成する。作れなければ null。
  // まず「読める文章」を時間内で探し、無ければ通常シャッフルにする。
  function generateCombo(idx, katas, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const total = katas.join("");
    const n = total.length;
    const orders = new Set(permutations(katas).map(p => p.join("")));
    if (n >= 8) {
      const maxPieces = Math.min(11, Math.max(7, Math.ceil(n / 4) + 3));
      const sents = searchSentences(idx, total, {
        maxPieces, keep: 5, candCap: 120, nodeCap: 200000, timeMs: opts.sentMs || 15000,
      }).filter(s => !orders.has(s.t));
      if (sents.length) {
        const s = sents[Math.floor(rng() * Math.min(3, sents.length))];
        return { text: s.t, parts: s.w.slice(), d: s.d };
      }
    }
    let cands = [];
    const budgets = [
      { nodeBudget: 90000, resultCap: 200, rng: null },
      { nodeBudget: 60000, resultCap: 200, rng },
      { nodeBudget: 150000, resultCap: 600, rng },
    ];
    for (let attempt = 0; attempt < budgets.length && !cands.length; attempt++) {
      const { results } = covers(idx, total, {
        ...budgets[attempt], timeMs: opts.plainMs || 10000,
      });
      cands = comboCandidates(idx, katas, results);
    }
    if (!cands.length) return null;
    const top = cands.slice(0, 20);
    const c = top[Math.floor(rng() * top.length)];
    return { text: c.text, parts: c.words.slice(), d: null };
  }

  const API = { buildIndex, covers, comboCandidates, searchSentences, generateCombo, _internal: { cntOf, fixedPos, qualityOk, permutations } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else global.AnagramGen = API;
})(typeof self !== "undefined" ? self : this);
