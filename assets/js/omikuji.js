// 今日の推し運おみくじ：1日1回。結果は日付シードで決まり、その日は同じ結果を表示する
const OM_RANKS = ["大吉", "中吉", "小吉", "吉", "末吉"];
const OM_MSGS = {
  "大吉": ["推しのブログ更新が早そう。通知の見逃しに注意。", "ライブ運も絶好調。チケット運が上がっています。", "推しの笑顔にたくさん出会える一日。"],
  "中吉": ["推しの懐かしい写真との出会いがありそう。写真ガチャがおすすめ。", "楽曲図鑑で新しい発見がありそう。", "推しの誕生日カウントダウンをチェックしてみて。"],
  "小吉": ["まったり推し活日和。ブログアーカイブの旅が吉。", "好きな曲を聴き返すと運気アップ。", "推しのセンター曲を聴くと良いことがありそう。"],
  "吉": ["焦らずマイペースに。推しは逃げません。", "年表を眺めると懐かしい記憶がよみがえりそう。", "今日は情報を集める日。お知らせチェックが吉。"],
  "末吉": ["運気はこれから上昇。モザイククイズで腕試しを。", "見逃しは明日取り戻せます。無理せず休息も大事。", "小さな幸運は夕方から。ブログの新着を待ってみて。"]
};
const OM_KEY = "sakamichia-omikuji";
let MEMBERS = [], PHOTOS = {};
function todayStr() { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; }
function seedOf(str) { let h = 2166136261; for (const c of str) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function loadFavs() { try { const v = JSON.parse(localStorage.getItem("sakamichia-favs") || "[]"); return Array.isArray(v) ? v.filter(x => typeof x === "string") : []; } catch (e) { return []; } }
function draw() {
  const favs = loadFavs();
  let pool = MEMBERS.filter(m => favs.includes(m.name));
  if (!pool.length) pool = MEMBERS.filter(m => !m.graduated);
  const seed = seedOf(todayStr() + "|" + pool.map(m => m.name).join(","));
  const m = pool[seed % pool.length];
  const r = seedOf(todayStr() + "|" + m.name);
  const rank = OM_RANKS[Math.floor((r / 4294967296) * 5) % 5] || "吉";
  const msgs = OM_MSGS[rank] || OM_MSGS["吉"];
  const msg = msgs[r % msgs.length];
  return { date: todayStr(), name: m.name, group: m.group, rank, msg };
}
function render(res, already) {
  const main = document.getElementById("omMain");
  const f = PHOTOS[res.name];
  main.innerHTML = `<div class="om-card">
    ${f ? `<img class="om-photo" src="${BASE}assets/member-photos/${esc(f)}" alt="">` : ""}
    <p class="om-rank">${esc(res.rank)}</p>
    <h3 style="margin:4px 0">${esc(res.name)}${groupChip(res.group)}</h3>
    <p class="om-msg">${esc(res.msg)}</p>
    <div class="gacha-btns" style="justify-content:center">
      <a class="btn" href="../../members/?member=${encodeURIComponent(res.name)}">メンバー詳細を見る</a>
      <button type="button" class="btn sub" id="omShare">結果を共有する</button>
    </div>
    <p style="color:var(--muted);font-size:13px;margin-top:12px">${already ? "今日はもう引いています。明日また引けます。" : "今日のおみくじを引きました。明日また引けます。"}</p></div>`;
  document.getElementById("omShare").addEventListener("click", e => shareScoreImage({ game: "今日の推し運おみくじ", score: res.rank, lines: [res.name, res.msg] }, e.target));
}
async function init() {
  const [members, photos] = await Promise.all([loadJSON("members.json"), loadJSON("member-photos.json")]);
  MEMBERS = members || []; PHOTOS = photos || {};
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(OM_KEY) || "null"); } catch (e) {}
  if (saved && saved.date === todayStr() && saved.name) { render(saved, true); return; }
  const main = document.getElementById("omMain");
  main.innerHTML = `<div class="om-card"><p style="font-size:44px;margin:6px 0">🎴</p><p>今日の運勢を引いてみましょう。</p><p><button type="button" class="btn" id="omDraw">おみくじを引く</button></p></div>`;
  document.getElementById("omDraw").addEventListener("click", () => {
    const res = draw();
    try { localStorage.setItem(OM_KEY, JSON.stringify(res)); } catch (e) {}
    render(res, false);
  });
}
init();
