// マイフォーメーション：メンバーを選んで自由に配置する（旧サイト『坂道日和』の「自由に作る」がモデル）
const KEY = "sakamichia-formation-v1";
const IMPORT_KEY = "sakamichia-formation-import";
const GROUPS = ["乃木坂46", "櫻坂46", "日向坂46", "欅坂46", "けやき坂46"];
const GCOL = { "乃木坂46": "#7e57c2", "櫻坂46": "#e77a9b", "日向坂46": "#5aa9d6", "欅坂46": "#5eba53", "けやき坂46": "#a4c639" };
const MAXROWS = 5, MAXPERROW = 12;
let MEMBERS = [], PHOTOS = {}, BYNAME = {};
let state = { title: "マイ坂道選抜", rows: [5, 6, 7], showCenter: true, positions: Array(18).fill(null) };
let selected = null, undoStack = [];
let fGroup = "all", fGen = "all", fStatus = "all", fQuery = "";
let exportBlob = null;

function total() { return state.rows.reduce((a, b) => a + b, 0); }
function placedCount() { return state.positions.filter(Boolean).length; }
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
function snapshot() { undoStack.push(JSON.stringify(state)); if (undoStack.length > 25) undoStack.shift(); }
function validState(s) {
  return !!s && Array.isArray(s.rows) && s.rows.length >= 1 && s.rows.length <= MAXROWS
    && s.rows.every(n => Number.isInteger(n) && n >= 1 && n <= MAXPERROW)
    && Array.isArray(s.positions) && s.positions.length === s.rows.reduce((a, b) => a + b, 0)
    && s.positions.every(x => x === null || BYNAME[x])
    && new Set(s.positions.filter(Boolean)).size === s.positions.filter(Boolean).length;
}
function load() {
  try {
    const imp = JSON.parse(localStorage.getItem(IMPORT_KEY) || "null");
    if (imp) {
      localStorage.removeItem(IMPORT_KEY);
      if (imp && Array.isArray(imp.positions)) {           // 名簿に無い名前（坂道AKBのAKB側など）は空枠にする
        const seen = new Set();
        imp.positions = imp.positions.map(x => { if (x && BYNAME[x] && !seen.has(x)) { seen.add(x); return x; } return null; });
      }
      if (validState(imp)) { state = imp; save(); return; }
    }
  } catch (e) {}
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (validState(s)) state = s; } catch (e) {}
}
// 列ごとの開始位置（positions は1列目＝最前列から順）
function rowOffsets() { const o = []; let a = 0; state.rows.forEach(n => { o.push(a); a += n; }); return o; }
function centerIndexes(n) { return n % 2 === 1 ? [Math.floor(n / 2)] : [n / 2 - 1, n / 2]; }
function photoURL(name) { const f = PHOTOS[name]; return f ? BASE + "assets/member-photos/" + f : ""; }
function tileInner(name) {
  const m = BYNAME[name];
  const url = photoURL(name);
  const ph = url ? `<img loading="lazy" src="${esc(url)}" alt="">` : `<span class="fm-initial" style="background:${GCOL[m.group] || "#999"}">${esc(name.slice(0, 1))}</span>`;
  return `${ph}<span class="fm-name">${esc(name)}</span>`;
}

function renderSettings() {
  document.getElementById("fmCols").value = String(state.rows.length);
  document.getElementById("fmTotal").textContent = total() + "人";
  document.getElementById("fmCenter").checked = state.showCenter;
  const host = document.getElementById("fmRowCounts");
  host.innerHTML = state.rows.map((n, i) =>
    `<span class="fm-stepper">${i + 1}列目 <button type="button" data-row="${i}" data-d="-1" ${n <= 1 ? "disabled" : ""} aria-label="${i + 1}列目を減らす">−</button><b>${n}人</b><button type="button" data-row="${i}" data-d="1" ${n >= MAXPERROW ? "disabled" : ""} aria-label="${i + 1}列目を増やす">＋</button></span>`).join("");
  host.querySelectorAll("button").forEach(b => b.addEventListener("click", () => changeRow(+b.dataset.row, +b.dataset.d)));
}
function renderBoard() {
  document.getElementById("fmTitle").value = state.title;
  document.getElementById("fmPlaced").textContent = `${placedCount()} / ${total()}人`;
  const offs = rowOffsets();
  const board = document.getElementById("fmBoard");
  board.style.setProperty("--maxn", Math.max(...state.rows));
  let html = "";
  for (let r = state.rows.length - 1; r >= 0; r--) {          // 表示は上が後列
    const n = state.rows[r], off = offs[r];
    const ctr = (state.showCenter && r === 0) ? centerIndexes(n) : [];
    html += `<div class="fm-row" data-row="${r}">`;
    for (let i = 0; i < n; i++) {
      const idx = off + i, name = state.positions[idx];
      const cls = ["fm-tile", name ? "filled" : "empty", selected === idx ? "sel" : "", ctr.includes(i) ? "ctr" : ""].join(" ");
      html += name
        ? `<button type="button" class="${cls}" data-slot="${idx}" draggable="true">${tileInner(name)}${ctr.includes(i) ? '<span class="fm-star">★</span>' : ""}</button>`
        : `<button type="button" class="${cls}" data-slot="${idx}"><span class="fm-pos">${r + 1}列目 ${i + 1}番</span>${ctr.includes(i) ? '<span class="fm-star dim">★</span>' : ""}</button>`;
    }
    html += `</div>`;
  }
  board.innerHTML = html;
  board.querySelectorAll(".fm-tile").forEach(t => {
    t.addEventListener("click", () => onSlot(+t.dataset.slot));
    t.addEventListener("dragstart", e => { const n = state.positions[+t.dataset.slot]; if (n) e.dataTransfer.setData("text/plain", n); });
    t.addEventListener("dragover", e => e.preventDefault());
    t.addEventListener("drop", e => { e.preventDefault(); const n = e.dataTransfer.getData("text/plain"); if (n) placeAt(n, +t.dataset.slot); });
  });
}
function renderCandidates() {
  const placedSet = new Set(state.positions.filter(Boolean));
  const list = MEMBERS.filter(m =>
    !placedSet.has(m.name)
    && (fGroup === "all" || (m.groups || [m.group]).includes(fGroup))
    && (fGen === "all" || m.gen === +fGen)
    && (fStatus === "all" || (fStatus === "active" ? !m.graduated : !!m.graduated))
    && (!fQuery || m.name.includes(fQuery) || (m.reading || "").includes(fQuery)));
  const order = g => GROUPS.indexOf(g);
  list.sort((a, b) => order(a.group) - order(b.group) || a.gen - b.gen || (a.reading || a.name).localeCompare(b.reading || b.name, "ja"));
  document.getElementById("fmCandCount").textContent = `候補 ${list.length}人`;
  const host = document.getElementById("fmCandidates");
  host.innerHTML = list.map(m =>
    `<button type="button" class="fm-cand" data-name="${esc(m.name)}" draggable="true">${tileInner(m.name)}<span class="fm-sub">${esc(m.group)}・${m.gen ? m.gen + "期" : "その他"}${m.graduated ? "・卒業" : ""}</span></button>`).join("")
    || `<p style="color:var(--muted)">条件に合うメンバーがいません。</p>`;
  host.querySelectorAll(".fm-cand").forEach(c => {
    c.addEventListener("click", () => placePicked(c.dataset.name));
    c.addEventListener("dragstart", e => e.dataTransfer.setData("text/plain", c.dataset.name));
  });
}
function render() { renderSettings(); renderBoard(); renderCandidates(); }

function commit(mut, msg) { snapshot(); mut(); selected = null; save(); render(); }
function resetPositions(rows) {
  state = { title: state.title, showCenter: state.showCenter, rows, positions: Array(rows.reduce((a, b) => a + b, 0)).fill(null) };
}
function changeRows(next) {
  if (placedCount() && !confirm("列数や人数を変更すると現在の配置は初期化されます。変更しますか？")) { renderSettings(); return; }
  snapshot(); resetPositions(next); selected = null; save(); render();
}
function changeRow(i, d) {
  const next = [...state.rows];
  next[i] = Math.min(MAXPERROW, Math.max(1, next[i] + d));
  if (next[i] !== state.rows[i]) changeRows(next);
}
function onSlot(idx) {
  if (selected === null) { selected = idx; renderBoard(); return; }
  if (selected === idx) { selected = null; renderBoard(); return; }
  const a = state.positions[selected], b = state.positions[idx];
  if (a && b) { commit(() => { state.positions[selected] = b; state.positions[idx] = a; }); }       // 入れ替え
  else if (a && !b) { commit(() => { state.positions[idx] = a; state.positions[selected] = null; }); } // 移動
  else { selected = idx; renderBoard(); }
}
function placeAt(name, idx) {
  commit(() => {
    const from = state.positions.indexOf(name);
    const dest = state.positions[idx];
    if (from >= 0) state.positions[from] = dest || null;
    state.positions[idx] = name;
  });
}
function placePicked(name) {
  let idx = (selected !== null && !state.positions[selected]) ? selected : state.positions.indexOf(null);
  if (idx < 0) { alert("空いている枠がありません。"); return; }
  placeAt(name, idx);
}

// ===== 画像出力（写真＋名前のみ。列名・サイト名は入れない）=====
async function loadImg(url) {
  return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
}
async function buildExportCanvas() {
  const W = 1200, PAD = 36, GAP = 10;
  const maxn = Math.max(...state.rows);
  const tileW = Math.min(168, (W - PAD * 2 - GAP * (maxn - 1)) / maxn);
  const photoH = tileW * 1.25, nameH = Math.max(30, tileW * 0.30), rowH = photoH + nameH;
  const titleH = 92, rowGap = 16;
  const H = PAD + titleH + state.rows.length * rowH + (state.rows.length - 1) * rowGap + PAD;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#faf9fb"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#2b2430"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "700 40px 'Hiragino Maru Gothic ProN','Hiragino Sans','Noto Sans JP',sans-serif";
  ctx.fillText(state.title || "マイ坂道選抜", W / 2, PAD + 34);
  ctx.font = "20px sans-serif"; ctx.fillStyle = "#7a7080";
  ctx.fillText(`${placedCount()}人編成`, W / 2, PAD + 68);
  const offs = rowOffsets();
  const imgs = {};
  await Promise.all(state.positions.filter(Boolean).map(async n => { imgs[n] = await loadImg(photoURL(n)); }));
  let y = PAD + titleH;
  for (let r = state.rows.length - 1; r >= 0; r--) {
    const n = state.rows[r], off = offs[r];
    const rowW = n * tileW + (n - 1) * GAP;
    let x = (W - rowW) / 2;
    const ctr = (state.showCenter && r === 0) ? centerIndexes(n) : [];
    for (let i = 0; i < n; i++) {
      const name = state.positions[off + i];
      ctx.save();
      ctx.beginPath(); ctx.roundRect(x, y, tileW, rowH, 12); ctx.clip();
      if (name && imgs[name]) {
        const im = imgs[name], scale = Math.max(tileW / im.width, photoH / im.height);
        const dw = im.width * scale, dh = im.height * scale;
        ctx.drawImage(im, x + (tileW - dw) / 2, y + (photoH - dh) / 2, dw, dh);
      } else {
        ctx.fillStyle = name ? (GCOL[BYNAME[name].group] || "#999") : "#e8e2ee";
        ctx.fillRect(x, y, tileW, photoH);
        if (name) { ctx.fillStyle = "#fff"; ctx.font = `700 ${tileW * 0.42}px sans-serif`; ctx.fillText(name.slice(0, 1), x + tileW / 2, y + photoH / 2); }
      }
      const isCtr = !!name && ctr.includes(i);
      ctx.fillStyle = isCtr ? (GCOL[BYNAME[name].group] || "#7e57c2") : "#ffffff";
      ctx.fillRect(x, y + photoH, tileW, nameH);
      if (name) {
        ctx.fillStyle = isCtr ? "#fff" : "#2b2430";
        let fs = 21; ctx.font = `600 ${fs}px 'Hiragino Sans','Noto Sans JP',sans-serif`;
        while (ctx.measureText(name).width > tileW - 10 && fs > 10) { fs -= 1; ctx.font = `600 ${fs}px 'Hiragino Sans','Noto Sans JP',sans-serif`; }
        ctx.fillText((isCtr ? "★" : "") + name, x + tileW / 2, y + photoH + nameH / 2 + 1);
      }
      ctx.restore();
      ctx.strokeStyle = "#eadff0"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x + 1, y + 1, tileW - 2, rowH - 2, 12); ctx.stroke();
      if (isCtr) { ctx.strokeStyle = GCOL[BYNAME[name].group] || "#7e57c2"; ctx.lineWidth = 5; ctx.beginPath(); ctx.roundRect(x + 2, y + 2, tileW - 4, rowH - 4, 11); ctx.stroke(); }
      x += tileW + GAP;
    }
    y += rowH + rowGap;
  }
  return cv;
}
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function openExport() {
  if (!placedCount()) { alert("先にメンバーを配置してください。"); return; }
  const cv = await buildExportCanvas();
  exportBlob = await new Promise(r => cv.toBlob(r, "image/png"));
  document.getElementById("fmDlgBody").innerHTML =
    `<h3 style="margin-top:0">${esc(state.title || "マイ坂道選抜")}</h3><img src="${cv.toDataURL("image/png")}" alt="フォーメーション画像" style="max-width:100%;height:auto;border:1px solid var(--line);border-radius:12px">`;
  document.getElementById("fmDlg").showModal();
}

// ===== 初期化 =====
async function init() {
  MEMBERS = await loadJSON("members.json");
  PHOTOS = await loadJSON("member-photos.json");
  if (!Array.isArray(MEMBERS)) MEMBERS = [];
  if (!PHOTOS || Array.isArray(PHOTOS)) PHOTOS = {};
  BYNAME = Object.fromEntries(MEMBERS.map(m => [m.name, m]));
  load();
  // グループチップ
  const chips = document.getElementById("fmGroups");
  chips.innerHTML = ["all", ...GROUPS].map(g =>
    `<button type="button" class="ychip${fGroup === g ? " on" : ""}" data-g="${g}">${g === "all" ? "すべてのグループ" : g}</button>`).join("");
  chips.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    fGroup = b.dataset.g; fGen = "all"; syncGenOptions();
    chips.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    renderCandidates();
  }));
  syncGenOptions();
  document.getElementById("fmQuery").addEventListener("input", e => { fQuery = e.target.value.trim(); renderCandidates(); });
  document.getElementById("fmStatus").addEventListener("input", e => { fStatus = e.target.value; renderCandidates(); });
  document.getElementById("fmGen").addEventListener("input", e => { fGen = e.target.value; renderCandidates(); });
  document.getElementById("fmCols").addEventListener("input", e => {
    const want = +e.target.value, next = [...state.rows];
    while (next.length < want) next.push(6);
    next.length = want;
    if (next.join() !== state.rows.join()) changeRows(next); else renderSettings();
  });
  document.getElementById("fmCenter").addEventListener("input", e => { snapshot(); state.showCenter = e.target.checked; save(); renderBoard(); });
  document.getElementById("fmTitle").addEventListener("input", e => { state.title = e.target.value; save(); });
  document.getElementById("fmUndo").addEventListener("click", () => {
    const prev = undoStack.pop(); if (!prev) return;
    state = JSON.parse(prev); selected = null; save(); render();
  });
  document.getElementById("fmUnplace").addEventListener("click", () => {
    if (selected === null || !state.positions[selected]) return;
    commit(() => { state.positions[selected] = null; });
  });
  document.getElementById("fmClear").addEventListener("click", () => {
    if (!placedCount() || !confirm("配置を全て外しますか？")) return;
    commit(() => { state.positions = state.positions.map(() => null); });
  });
  document.getElementById("fmReset").addEventListener("click", () => {
    if (!confirm("列数・タイトルも含めて最初から作り直しますか？")) return;
    snapshot();
    state = { title: "マイ坂道選抜", rows: [5, 6, 7], showCenter: true, positions: Array(18).fill(null) };
    selected = null; save(); render();
  });
  document.getElementById("fmExport").addEventListener("click", openExport);
  document.getElementById("fmDownload").addEventListener("click", () => { if (exportBlob) download(exportBlob, "sakamichia-formation.png"); });
  document.getElementById("fmShare").addEventListener("click", async () => {
    if (!exportBlob) return;
    const file = new File([exportBlob], "sakamichia-formation.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch (e) { /* キャンセル時は何もしない */ }
    } else download(exportBlob, "sakamichia-formation.png");
  });
  render();
}
function syncGenOptions() {
  const gens = [...new Set(MEMBERS.filter(m => fGroup === "all" || (m.groups || [m.group]).includes(fGroup)).map(m => m.gen).filter(g => g > 0))].sort((a, b) => a - b);
  const sel = document.getElementById("fmGen");
  sel.innerHTML = `<option value="all">すべての期</option>` + gens.map(g => `<option value="${g}">${g}期生</option>`).join("");
  sel.value = gens.includes(+fGen) ? fGen : "all";
  fGen = sel.value;
}
init();
