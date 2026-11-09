// アナグラムその場生成ワーカー。辞書データを読み込み、依頼された組み合わせの
// 問題（シャッフル）を裏で1件ずつ作って返す。UI スレッドは止めない。
importScripts("anagram-gen-core.js");

let IDX = null;

self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.type === "init") {
    try {
      const res = await fetch(m.dictUrl);
      if (!res.ok) throw new Error("dict fetch " + res.status);
      const data = await res.json();
      IDX = AnagramGen.buildIndex(data.pieces);
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "init-error", message: String(err && err.message || err) });
    }
    return;
  }
  if (m.type === "gen") {
    let out = null;
    try {
      if (IDX) out = AnagramGen.generateCombo(IDX, m.katas, { sentMs: m.sentMs, plainMs: m.plainMs });
    } catch (err) {
      out = null;
    }
    self.postMessage({ type: "result", id: m.id, game: m.game, out });
  }
};
