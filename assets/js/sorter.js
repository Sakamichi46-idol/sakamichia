// メンバーソート：2人から好きな方を選んで自分のランキングを作る（エンジンは sorter-core.js）
const Core = window.SakamichiSorterCore;
const area = document.getElementById("sorterArea");
let MEMBERS = [], PHOTOS = {};
let scope = {group: "all", grad: false}; // grad=false: 現役のみ
let pool = [], sorter = null, inBattle = false;
let shareBlob = null;

function shuffle(a){ a = [...a]; for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function photoURL(m){ const f = PHOTOS[m.name]; return f ? BASE + "assets/member-photos/" + f : null; }
function genLabel(m){ if(m.name === "松井玲奈") return "交換留学生"; return m.gen ? m.gen + "期生" : ""; }
function scopePool(){
  return MEMBERS.filter(m =>
    (scope.group === "all" || Core.memberLineage(m) === scope.group) &&
    (scope.grad || !m.graduated));
}
function scopeLabel(){
  const gl = scope.group === "all" ? "全グループ" : scope.group;
  return `${gl} ・ ${scope.grad ? "卒業生も含む" : "現役のみ"}（${pool.length}人）`;
}

async function init(){
  [MEMBERS, PHOTOS] = await Promise.all([loadJSON("members.json"), loadJSON("member-photos.json")]);
  if(!MEMBERS.length){ area.innerHTML = `<p style="color:var(--muted)">メンバーデータを読み込めませんでした。</p>`; return; }
  renderStart();
}

// ---------- スタート画面 ----------
function marqueeHTML(){
  const actives = shuffle(MEMBERS.filter(m => !m.graduated && PHOTOS[m.name]));
  const rows = [actives.slice(0, 10), actives.slice(10, 20)];
  return `<div class="mq" aria-hidden="true">${rows.map((row, ri) =>
    `<div class="mq-row${ri === 1 ? " rev" : ""}">${[0, 1].map(() =>
      row.map(m => `<img src="${esc(photoURL(m))}" alt="" loading="lazy">`).join("")
    ).join("")}</div>`).join("")}</div>`;
}
function renderStart(){
  inBattle = false; sorter = null; shareBlob = null;
  const gchips = [["all", "すべて"], ["乃木坂46", "乃木坂46"], ["櫻坂46", "櫻坂46"], ["日向坂46", "日向坂46"]]
    .map(([v, l]) => `<button type="button" data-g="${v}" class="${scope.group === v ? "on" : ""}">${l}</button>`).join("");
  const tchips = [["0", "現役のみ"], ["1", "卒業生も含む"]]
    .map(([v, l]) => `<button type="button" data-t="${v}" class="${(scope.grad ? "1" : "0") === v ? "on" : ""}">${l}</button>`).join("");
  area.innerHTML = `
  ${marqueeHTML()}
  <div class="card" style="margin-bottom:40px">
    <h3 style="margin-top:0">範囲を選んでスタート</h3>
    <p style="margin:4px 0 2px;color:var(--muted);font-size:13px">グループ</p>
    <div class="tabs sort-tabs" id="sortGroups">${gchips}</div>
    <p style="margin:8px 0 2px;color:var(--muted);font-size:13px">対象</p>
    <div class="tabs sort-tabs" id="sortGrad">${tchips}</div>
    <p id="sortInfo" style="margin:12px 0 4px"></p>
    <p id="sortWarn" style="margin:0 0 8px;color:var(--muted);font-size:13px"></p>
    <p style="margin:10px 0 0"><button type="button" id="sortStart">スタート</button></p>
    <p style="margin:10px 0 0;color:var(--muted);font-size:12.5px">櫻坂46には欅坂46時代のメンバー、日向坂46にはけやき坂46時代のメンバーも含まれます。対戦数が多い範囲は時間がかかります。</p>
  </div>`;
  document.querySelectorAll("#sortGroups button").forEach(b => b.addEventListener("click", () => { scope.group = b.dataset.g; renderStart(); }));
  document.querySelectorAll("#sortGrad button").forEach(b => b.addEventListener("click", () => { scope.grad = b.dataset.t === "1"; renderStart(); }));
  updateInfo();
  document.getElementById("sortStart").addEventListener("click", startBattle);
}
function updateInfo(){
  const list = scopePool();
  const est = Core.estimate(list.length);
  document.getElementById("sortInfo").innerHTML =
    `対象：<b>${list.length}人</b> ／ 目安：約<b>${est}対戦</b>`;
  document.getElementById("sortWarn").textContent =
    est > 400 ? "対戦数がとても多い範囲です。グループ別や「現役のみ」だと進めやすくなります。" : "";
  document.getElementById("sortStart").disabled = list.length < 2;
}

// ---------- 対戦画面 ----------
function startBattle(){
  pool = shuffle(scopePool());
  if(pool.length < 2) return;
  sorter = Core.createSorter(pool.length);
  inBattle = true;
  renderBattle();
}
function memberCard(m, side, tieSize){
  const url = photoURL(m);
  const gen = genLabel(m);
  return `<button type="button" class="sort-card" data-side="${side}">
    ${url ? `<img src="${esc(url)}" alt="" onerror="this.remove()">` : ""}
    <span class="nm">${esc(m.name)}</span>
    <span>${groupChip(m.group)}${gen ? `<span class="meta">${esc(gen)}</span>` : ""}</span>
    ${tieSize > 1 ? `<span class="meta">他${tieSize - 1}名と同順位で対戦中</span>` : ""}
  </button>`;
}
function renderBattle(){
  const p = sorter.pair();
  if(!p){ renderResult(); return; }
  const a = pool[p.a], b = pool[p.b];
  const pct = sorter.progress();
  area.innerHTML = `
  <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">
    <b>${sorter.battles() + 1}戦目</b>
    <span style="color:var(--muted);font-size:13px">${esc(scopeLabel())} ・ 進捗 約${pct}%</span>
  </div>
  <div class="sort-prog"><i style="width:${pct}%"></i></div>
  <p style="margin:10px 0 0;color:var(--muted);font-size:13.5px">好きな方をタップ（←／→キーでも選べます）</p>
  <div class="sort-vs">
    ${memberCard(a, "left", p.aSize)}
    <span class="sort-mid">VS</span>
    ${memberCard(b, "right", p.bSize)}
  </div>
  <div class="sort-actions">
    <button type="button" class="sub" id="sortDraw">引き分け</button>
    <button type="button" class="sub" id="sortUndo" ${sorter.canUndo() ? "" : "disabled"}>1つ戻る</button>
    <button type="button" class="sub" id="sortQuit">やめる</button>
  </div>`;
  area.querySelector('[data-side="left"]').addEventListener("click", () => answer("left"));
  area.querySelector('[data-side="right"]').addEventListener("click", () => answer("right"));
  document.getElementById("sortDraw").addEventListener("click", () => answer("draw"));
  document.getElementById("sortUndo").addEventListener("click", () => { if(sorter.undo()) renderBattle(); });
  document.getElementById("sortQuit").addEventListener("click", renderStart);
}
function answer(choice){
  if(!inBattle || !sorter) return;
  if(sorter.answer(choice)){
    if(sorter.done()){ inBattle = false; renderResult(); }
    else renderBattle();
  }
}
document.addEventListener("keydown", e => {
  if(!inBattle) return;
  if(e.key === "ArrowLeft") answer("left");
  else if(e.key === "ArrowRight") answer("right");
});

// ---------- 結果画面 ----------
function rankedRows(){
  const groups = sorter.result() || [];
  const rows = [];
  let rank = 1;
  for(const g of groups){
    for(const idx of g) rows.push({rank, m: pool[idx]});
    rank += g.length;
  }
  return rows;
}
function renderResult(){
  inBattle = false;
  const rows = rankedRows();
  area.innerHTML = `
  <div class="card" style="margin-bottom:18px">
    <h3 style="margin-top:0">あなたのメンバーランキング</h3>
    <p style="color:var(--muted);margin:4px 0">${esc(scopeLabel())} ・ ${sorter.battles()}対戦で決定</p>
    <p style="margin:10px 0 0">
      <button type="button" id="sortShareGen">上位10人の画像を作る</button>
      <button type="button" class="sub" id="sortAgain">もう一度（同じ範囲）</button>
      <button type="button" class="sub" id="sortBack">範囲を変える</button>
    </p>
    <div id="sortShareBox"></div>
  </div>
  <div class="sort-rank">${rows.map(r => {
    const url = photoURL(r.m);
    const gen = genLabel(r.m);
    return `<div class="sort-rrow">
      <span class="sort-rnum ${r.rank <= 3 ? "r" + r.rank : ""}">${r.rank}</span>
      ${url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
      <span class="sort-rname">${esc(r.m.name)}</span>
      <span class="sort-rmeta">${esc(r.m.group)}${gen ? " ・ " + esc(gen) : ""}${r.m.graduated ? " ・ 卒業" : ""}</span>
    </div>`;
  }).join("")}</div>`;
  document.getElementById("sortAgain").addEventListener("click", startBattle);
  document.getElementById("sortBack").addEventListener("click", renderStart);
  document.getElementById("sortShareGen").addEventListener("click", () => makeShareImage(rows.slice(0, 10)));
}

// ---------- シェア画像 ----------
function loadImg(url){
  return new Promise(res => {
    if(!url){ res(null); return; }
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}
function roundRectPath(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
async function makeShareImage(top){
  const box = document.getElementById("sortShareBox");
  box.innerHTML = `<p style="color:var(--muted)">画像を作成中…</p>`;
  const W = 960, H = 1280, cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const FONT = `"Hiragino Maru Gothic ProN","Hiragino Sans","Noto Sans JP",sans-serif`;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  // 三色ドット＋見出し
  const cols = ["#7e57c2", "#e77a9b", "#5aa9d6"];
  cols.forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(84 + i * 50, 84, 16, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = "#2b2430";
  ctx.font = `900 54px ${FONT}`;
  ctx.fillText("メンバーソート", 226, 103);
  ctx.fillStyle = "#7a7080";
  ctx.font = `400 28px ${FONT}`;
  ctx.fillText(scopeLabel(), 58, 168);
  ctx.strokeStyle = "#eadff0"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(58, 196); ctx.lineTo(W - 58, 196); ctx.stroke();
  // 上位10人
  const imgs = await Promise.all(top.map(r => loadImg(photoURL(r.m))));
  const rowH = 96, y0 = 216;
  top.forEach((r, i) => {
    const y = y0 + i * rowH;
    ctx.fillStyle = i < 3 ? cols[i] : "#2b2430";
    ctx.font = `900 42px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(String(r.rank), 96, y + 58);
    ctx.textAlign = "left";
    const img = imgs[i];
    if(img){
      ctx.save();
      roundRectPath(ctx, 150, y + 6, 76, 76, 12);
      ctx.clip();
      const sc = Math.max(76 / img.width, 76 / img.height);
      const dw = img.width * sc, dh = img.height * sc;
      ctx.drawImage(img, 150 + (76 - dw) / 2, y + 6 + (76 - dh) / 2, dw, dh);
      ctx.restore();
    } else {
      ctx.fillStyle = "#f2e9fb"; ctx.fillRect(150, y + 6, 76, 76);
      ctx.fillStyle = "#7e57c2"; ctx.font = `900 34px ${FONT}`;
      ctx.textAlign = "center"; ctx.fillText(r.m.name.slice(0, 1), 188, y + 60); ctx.textAlign = "left";
    }
    ctx.fillStyle = "#2b2430";
    ctx.font = `700 39px ${FONT}`;
    ctx.fillText(r.m.name, 248, y + 48);
    ctx.fillStyle = "#7a7080";
    ctx.font = `400 25px ${FONT}`;
    const gen = genLabel(r.m);
    ctx.fillText(`${r.m.group}${gen ? " ・ " + gen : ""}`, 248, y + 82);
  });
  ctx.fillStyle = "#7a7080";
  ctx.font = `400 24px ${FONT}`;
  ctx.fillText("サカミチア ｜ https://sakamichia.pages.dev/games/sorter/", 58, 1236);
  shareBlob = await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("画像を生成できませんでした。")), "image/png"));
  const url = URL.createObjectURL(shareBlob);
  box.innerHTML = `
    <img class="sort-share-img" src="${url}" alt="メンバーソート上位10人の画像">
    <p style="text-align:center;margin:8px 0 0"><button type="button" id="sortShareBtn">共有／保存する</button></p>`;
  document.getElementById("sortShareBtn").addEventListener("click", shareImage);
}
async function shareImage(){
  if(!shareBlob) return;
  try{
    const file = new File([shareBlob], "sakamichia-member-sort.png", {type: "image/png"});
    if(navigator.share && navigator.canShare && navigator.canShare({files: [file]})){
      await navigator.share({files: [file], text: "サカミチアのメンバーソート結果\nhttps://sakamichia.pages.dev/games/sorter/"});
      return;
    }
    const url = URL.createObjectURL(shareBlob), a = document.createElement("a");
    a.href = url; a.download = "sakamichia-member-sort.png"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }catch(e){ /* 共有キャンセル時は何もしない */ }
}

init();
