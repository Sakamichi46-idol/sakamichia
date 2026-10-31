// メンバーソート：2人から好きな方を選んで自分のランキングを作る（エンジンは sorter-core.js）
const Core = window.SakamichiSorterCore;
const area = document.getElementById("sorterArea");
let MEMBERS = [], PHOTOS = {};
const LINEAGES = ["乃木坂46", "櫻坂46", "日向坂46"];
// groups / gens は複数選択（Set）。gens は系統ごとの「選んだ期」の Set で、空ならその系統は全期が対象。
// grad=false: 現役のみ
let scope = {groups: new Set(LINEAGES), grad: false,
  gens: {"乃木坂46": new Set(), "櫻坂46": new Set(), "日向坂46": new Set()}};
let pool = [], sorter = null, inBattle = false;
let shareBlob = null;
// カスタム選択（メンバー個別選択）：customSel は選択中メンバー名の Set で、条件チップとは独立に保持する。
// 条件を変更すると破棄される（変更前に確認する）。選択は localStorage に保存し、再訪時に復元する。
const CUSTOM_KEY = "sakamichia-sorter-custom";
let customMode = false, customSel = null, customOpen = false, customRestored = false;
let customView = {lin: "all", q: ""};

function shuffle(a){ a = [...a]; for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function photoURL(m){ const f = PHOTOS[m.name]; return f ? BASE + "assets/member-photos/" + f : null; }
function genLabel(m){ if(m.name === "松井玲奈") return "交換留学生"; return m.gen ? m.gen + "期生" : ""; }
// その系統に実在する期の値（昇順、期なし=0 は最後）
function gensOf(lin){
  const set = new Set();
  MEMBERS.forEach(m => { if(Core.memberLineage(m) === lin) set.add(m.gen || 0); });
  return [...set].sort((a, b) => (a === 0 ? 99 : a) - (b === 0 ? 99 : b));
}
// 期なし（gen=0）の呼び名は系統で異なる：乃木坂46＝交換留学生（松井玲奈）、日向坂46＝ポカ
function genZeroLabel(lin){ return lin === "乃木坂46" ? "交換留学生" : lin === "日向坂46" ? "ポカ" : "期なし"; }
function genChipLabel(lin, g){ return g === 0 ? genZeroLabel(lin) : g + "期生"; }
function scopePool(){
  return MEMBERS.filter(m => {
    const lin = Core.memberLineage(m);
    if(!scope.groups.has(lin)) return false;
    if(!scope.grad && m.graduated) return false;
    const gs = scope.gens[lin];
    if(gs && gs.size && !gs.has(m.gen || 0)) return false;
    return true;
  });
}
// 実際に対象になるメンバー一覧：カスタム選択中はそちらを優先する
function currentPool(){
  if(customMode && customSel) return MEMBERS.filter(m => customSel.has(m.name));
  return scopePool();
}
function saveCustom(){
  try{
    if(customMode && customSel && customSel.size) localStorage.setItem(CUSTOM_KEY, JSON.stringify([...customSel]));
    else localStorage.removeItem(CUSTOM_KEY);
  }catch(e){ /* 保存できなくても動作は続ける */ }
}
function restoreCustom(){
  try{
    const raw = localStorage.getItem(CUSTOM_KEY);
    if(!raw) return;
    const names = JSON.parse(raw);
    if(!Array.isArray(names)) return;
    const valid = new Set(MEMBERS.map(m => m.name));
    const sel = new Set(names.filter(n => typeof n === "string" && valid.has(n)));
    if(sel.size){ customMode = true; customSel = sel; customRestored = true; }
  }catch(e){ /* 壊れた保存データは無視する */ }
}
function enterCustom(){
  // 開いた時点の条件で絞り込まれた全員を選択済みにして開始する
  customSel = new Set(scopePool().map(m => m.name));
  customMode = true; customOpen = true; customRestored = false;
  saveCustom();
  renderCustomArea();
  updateInfo();
}
function exitCustom(){
  customMode = false; customSel = null; customOpen = false; customRestored = false;
  saveCustom();
  renderCustomArea();
  updateInfo();
}
// カスタム選択中に条件チップを変更しようとしたら確認する。true のときだけ変更を続行する（カスタムは破棄）。
function confirmConditionChange(){
  if(!customMode) return true;
  if(window.confirm("条件を変更すると、個別に選んだカスタム選択が破棄されます。よろしいですか？")){
    customMode = false; customSel = null; customOpen = false; customRestored = false;
    saveCustom();
    return true;
  }
  return false;
}
function kataToHira(s){ return String(s || "").replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)); }
function memberMatches(m, q){
  if(!q) return true;
  if(m.name.includes(q)) return true;
  const r = m.reading || "";
  return r.includes(q) || kataToHira(r).includes(kataToHira(q));
}
// グリッド表示順：系統→期→五十音（サイト共通の並び）。期なし（ポカ・松井玲奈）は系統内の最後。
function customSortedMembers(){
  const ord = {"乃木坂46": 0, "櫻坂46": 1, "日向坂46": 2};
  return [...MEMBERS].sort((a, b) => {
    const la = ord[Core.memberLineage(a)] ?? 9, lb = ord[Core.memberLineage(b)] ?? 9;
    if(la !== lb) return la - lb;
    const ga = a.gen == null ? 99 : a.gen, gb = b.gen == null ? 99 : b.gen;
    if(ga !== gb) return ga - gb;
    return String(a.reading || a.name).localeCompare(String(b.reading || b.name), "ja");
  });
}
// 表示だけの絞り込み（系統・検索）。選択そのものは変えない。
function visibleCustomMembers(){
  return customSortedMembers().filter(m => {
    if(customView.lin !== "all" && Core.memberLineage(m) !== customView.lin) return false;
    return memberMatches(m, customView.q.trim());
  });
}
function renderCustomArea(){
  const box = document.getElementById("sortCustomBox");
  if(!box) return;
  if(!customMode){
    box.innerHTML = `<p style="margin:12px 0 0"><button type="button" class="sub" id="sortCustomEnter">メンバーを個別に選ぶ（カスタム）</button></p>`;
    document.getElementById("sortCustomEnter").addEventListener("click", enterCustom);
    return;
  }
  box.innerHTML = `
    <p style="margin:12px 0 0"><button type="button" id="sortCustomToggle">カスタム選択中：${customSel ? customSel.size : 0}人${customRestored ? "（前回の選択を復元）" : ""}（${customOpen ? "閉じる" : "開く"}）</button></p>
    ${customOpen ? `
    <div class="sort-custom-panel">
      <p style="margin:0 0 8px;color:var(--muted);font-size:12.5px">写真をタップして選択／解除できます。上の条件（グループ・期・対象）を変更すると、カスタム選択は破棄されます（変更前に確認が出ます）。</p>
      <div class="sort-custom-tools">
        <input type="search" id="sortCustomSearch" placeholder="名前・よみで検索" value="${esc(customView.q)}">
      </div>
      <div class="tabs sort-tabs" id="sortCustomLins">
        ${[["all", "すべて"], ...LINEAGES.map(l => [l, l])].map(([v, l]) =>
          `<button type="button" data-lin="${esc(v)}" class="${customView.lin === v ? "on" : ""}">${esc(l)}</button>`).join("")}
        <span style="align-self:center;color:var(--muted);font-size:12px">↑表示の絞り込み（選択は保持されます）</span>
      </div>
      <p style="margin:6px 0">
        <button type="button" class="sub" id="sortCustomAll">表示中を全選択</button>
        <button type="button" class="sub" id="sortCustomNone">表示中を全解除</button>
        <span id="sortCustomCount" style="margin-left:8px;color:var(--muted);font-size:13px"></span>
      </p>
      <div class="sort-custom-grid" id="sortCustomGrid"></div>
      <p style="margin:10px 0 0"><button type="button" class="sub" id="sortCustomExit">カスタムをやめて条件に戻す</button></p>
    </div>` : ""}`;
  document.getElementById("sortCustomToggle").addEventListener("click", () => { customOpen = !customOpen; renderCustomArea(); });
  if(!customOpen) return;
  document.getElementById("sortCustomSearch").addEventListener("input", e => { customView.q = e.target.value; renderCustomGrid(); });
  document.getElementById("sortCustomLins").querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    customView.lin = b.dataset.lin;
    document.getElementById("sortCustomLins").querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    renderCustomGrid();
  }));
  document.getElementById("sortCustomAll").addEventListener("click", () => bulkCustom(true));
  document.getElementById("sortCustomNone").addEventListener("click", () => bulkCustom(false));
  document.getElementById("sortCustomExit").addEventListener("click", exitCustom);
  renderCustomGrid();
}
function renderCustomGrid(){
  const grid = document.getElementById("sortCustomGrid");
  if(!grid || !customSel) return;
  const vis = visibleCustomMembers();
  grid.innerHTML = vis.map(m => {
    const url = photoURL(m);
    const on = customSel.has(m.name);
    const gen = genLabel(m);
    return `<button type="button" class="sort-pick ${on ? "on" : "off"}" data-name="${esc(m.name)}" aria-pressed="${on}">
      ${url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()">` : `<span class="sort-pick-no">${esc(m.name.slice(0, 1))}</span>`}
      <span class="nm">${esc(m.name)}</span>
      <span class="meta">${esc(m.group)}${gen ? "・" + esc(gen) : ""}${m.graduated ? "・卒業" : ""}</span>
    </button>`;
  }).join("") || `<p style="color:var(--muted);font-size:13px;margin:6px 0">表示できるメンバーがいません。</p>`;
  grid.querySelectorAll(".sort-pick").forEach(b => b.addEventListener("click", () => togglePick(b)));
  updateCustomCount(vis.length);
}
function updateCustomCount(visN){
  const el = document.getElementById("sortCustomCount");
  if(el) el.textContent = `選択中 ${customSel ? customSel.size : 0}人 ／ 表示中 ${visN}人`;
  const t = document.getElementById("sortCustomToggle");
  if(t && customMode) t.textContent = `カスタム選択中：${customSel ? customSel.size : 0}人${customRestored ? "（前回の選択を復元）" : ""}（${customOpen ? "閉じる" : "開く"}）`;
}
function togglePick(btn){
  const name = btn.dataset.name;
  if(customSel.has(name)) customSel.delete(name); else customSel.add(name);
  const on = customSel.has(name);
  btn.classList.toggle("on", on);
  btn.classList.toggle("off", !on);
  btn.setAttribute("aria-pressed", String(on));
  customRestored = false;
  saveCustom();
  updateCustomCount(visibleCustomMembers().length);
  updateInfo();
}
function bulkCustom(onOff){
  visibleCustomMembers().forEach(m => { if(onOff) customSel.add(m.name); else customSel.delete(m.name); });
  customRestored = false;
  saveCustom();
  renderCustomGrid();
  updateInfo();
}
function lineageLabel(lin){
  const gs = scope.gens[lin];
  if(!gs || !gs.size) return lin;
  const labels = [...gs].sort((a, b) => (a === 0 ? 99 : a) - (b === 0 ? 99 : b))
    .map(g => g === 0 ? genZeroLabel(lin) : g + "期");
  return `${lin}（${labels.join("・")}）`;
}
function scopeLabel(){
  if(customMode) return `カスタム選択（${pool.length}人）`;
  const sel = LINEAGES.filter(l => scope.groups.has(l));
  const allPlain = sel.length === LINEAGES.length && LINEAGES.every(l => !scope.gens[l].size);
  const gl = allPlain ? "全グループ" : (sel.map(lineageLabel).join("・") || "未選択");
  return `${gl} ・ ${scope.grad ? "卒業生も含む" : "現役のみ"}（${pool.length}人）`;
}

async function init(){
  [MEMBERS, PHOTOS] = await Promise.all([loadJSON("members.json"), loadJSON("member-photos.json")]);
  if(!MEMBERS.length){ area.innerHTML = `<p style="color:var(--muted)">メンバーデータを読み込めませんでした。</p>`; return; }
  restoreCustom();
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
  area.innerHTML = `
  ${marqueeHTML()}
  <div class="card" style="margin-bottom:40px">
    <h3 style="margin-top:0">範囲を選んでスタート</h3>
    <p style="margin:4px 0 2px;color:var(--muted);font-size:13px">グループ（複数選択できます）</p>
    <div class="tabs sort-tabs" id="sortGroups"></div>
    <div id="sortGens"></div>
    <p style="margin:8px 0 2px;color:var(--muted);font-size:13px">対象</p>
    <div class="tabs sort-tabs" id="sortGrad"></div>
    <div id="sortCustomBox"></div>
    <p id="sortInfo" style="margin:12px 0 4px"></p>
    <p id="sortWarn" style="margin:0 0 8px;color:var(--muted);font-size:13px"></p>
    <p style="margin:10px 0 0"><button type="button" id="sortStart">スタート</button></p>
    <p style="margin:10px 0 0;color:var(--muted);font-size:12.5px">櫻坂46には欅坂46時代のメンバー、日向坂46にはけやき坂46時代のメンバーも含まれます。期を選ばないグループは全期が対象です。乃木坂46の「交換留学生」は松井玲奈、日向坂46の「ポカ」は公式マスコットのポカです。対戦数が多い範囲は時間がかかります。</p>
  </div>`;
  refreshSelection();
  document.getElementById("sortStart").addEventListener("click", startBattle);
}
// 選択チップ（グループ・期・対象）を現在の scope で描き直し、件数表示を更新する
function refreshSelection(){
  const allOn = scope.groups.size === LINEAGES.length;
  const gEl = document.getElementById("sortGroups");
  gEl.innerHTML =
    `<button type="button" data-g="all" class="${allOn ? "on" : ""}">すべて</button>` +
    LINEAGES.map(l => `<button type="button" data-g="${esc(l)}" class="${scope.groups.has(l) ? "on" : ""}">${esc(l)}</button>`).join("");
  gEl.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    if(!confirmConditionChange()){ refreshSelection(); return; }
    if(b.dataset.g === "all") scope.groups = allOn ? new Set() : new Set(LINEAGES);
    else if(scope.groups.has(b.dataset.g)) scope.groups.delete(b.dataset.g);
    else scope.groups.add(b.dataset.g);
    refreshSelection();
  }));
  const genEl = document.getElementById("sortGens");
  genEl.innerHTML = LINEAGES.filter(l => scope.groups.has(l)).map(lin => `
    <p style="margin:8px 0 2px;color:var(--muted);font-size:13px">${esc(lin)}の期（複数選択可・選ばなければ全期）</p>
    <div class="tabs sort-tabs">${gensOf(lin).map(g =>
      `<button type="button" data-lin="${esc(lin)}" data-gen="${g}" class="${scope.gens[lin].has(g) ? "on" : ""}">${esc(genChipLabel(lin, g))}</button>`).join("")}</div>`).join("");
  genEl.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    if(!confirmConditionChange()){ refreshSelection(); return; }
    const set = scope.gens[b.dataset.lin], g = Number(b.dataset.gen);
    if(set.has(g)) set.delete(g); else set.add(g);
    refreshSelection();
  }));
  const tEl = document.getElementById("sortGrad");
  tEl.innerHTML = [["0", "現役のみ"], ["1", "卒業生も含む"]]
    .map(([v, l]) => `<button type="button" data-t="${v}" class="${(scope.grad ? "1" : "0") === v ? "on" : ""}">${l}</button>`).join("");
  tEl.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    if(!confirmConditionChange()){ refreshSelection(); return; }
    scope.grad = b.dataset.t === "1"; refreshSelection();
  }));
  updateInfo();
  renderCustomArea();
}
function updateInfo(){
  const list = currentPool();
  const est = Core.estimate(list.length);
  document.getElementById("sortInfo").innerHTML =
    `対象：<b>${list.length}人</b> ／ 目安：約<b>${est}対戦</b>${customMode ? "（カスタム選択）" : ""}`;
  document.getElementById("sortWarn").textContent =
    est > 400 ? (customMode ? "対戦数がとても多い範囲です。個別選択で人数を絞ると進めやすくなります。" : "対戦数がとても多い範囲です。グループ別や「現役のみ」だと進めやすくなります。") : "";
  document.getElementById("sortStart").disabled = list.length < 2;
}

// ---------- 対戦画面 ----------
function startBattle(){
  pool = shuffle(currentPool());
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
