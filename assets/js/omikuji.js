// 今日の推し運おみくじ：1日1回。抽選ロジックは common.js の共通部品を使い、
// トップページのおみくじと同じ結果になる（保存キーも共通）。
let MEMBERS = [], PHOTOS = {};
function render(res, already) {
  const main = document.getElementById("omMain");
  const f = PHOTOS[res.name];
  main.innerHTML = `<div class="om-card">
    ${f ? `<img class="om-photo" src="${BASE}assets/member-photos/${esc(f)}" alt="">` : ""}
    <p class="om-rank" data-rank="${esc(res.rank)}">${esc(res.rank)}</p>
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
  const saved = omikujiLoad();
  if (saved) { render(saved, true); return; }
  const main = document.getElementById("omMain");
  main.innerHTML = `<div class="om-card"><p>今日の運勢を引いてみましょう。</p><p><button type="button" class="btn" id="omDraw">おみくじを引く</button></p></div>`;
  document.getElementById("omDraw").addEventListener("click", () => {
    const res = omikujiDraw(MEMBERS);
    if (!res) return;
    omikujiSave(res);
    render(res, false);
  });
}
init();
