// ワードサーチ：メンバーの名前（カタカナ読み）を10×10の盤面から探すパズル（プレビュー版）
const WS_SIZE = 10, WS_WORDS = 6;
const WS_GROUP_ORDER = ["乃木坂46", "櫻坂46", "日向坂46", "欅坂46", "けやき坂46"];
let MEMBERS = []; // {name（漢字）, kana（カタカナ読み）, group, graduated}
let GROUPS = []; // データに実在するグループ（表示順に整列済み）
let settings = { groups: [], grad: false }; // groups が空 = すべて
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("sakamichia-wordsearch-settings") || "null");
    if (s) settings = { groups: Array.isArray(s.groups) ? s.groups.filter(g => GROUPS.includes(g)) : [], grad: !!s.grad };
  } catch (e) {}
}
function saveSettings() { try { localStorage.setItem("sakamichia-wordsearch-settings", JSON.stringify(settings)); } catch (e) {} }
let puzzle = null, foundKana = new Set(), startAt = 0, timer = null, playing = false;
let downCell = null, curCell = null, anchorCell = null;

function toKata(s) { return String(s || "").replace(/[ぁ-ん]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function shuffleR(a, rand) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function fmtTime(sec) { return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
// ベストタイム（秒・小さい方が記録）。quizBest 系は大きい方が記録の仕様なので、このゲーム専用に持つ
function wsBest() { try { return +localStorage.getItem("sakamichia-best-wordsearch") || 0; } catch (e) { return 0; } }
function wsBestSave(sec) { try { const b = wsBest(); if (!b || sec < b) { localStorage.setItem("sakamichia-best-wordsearch", String(sec)); return true; } } catch (e) {} return false; }

// 出題プール：グループ（空 = すべて、OR条件）と卒業生の有無で絞り、読み4〜8文字・読み重複なし
function buildPool(members, groups, includeGrad) {
  const seen = new Set();
  return (members || []).filter(m => (!groups || !groups.length || groups.includes(m.group)) && (includeGrad || !m.graduated))
    .filter(p => p.kana.length >= 4 && p.kana.length <= 8 && !seen.has(p.kana) && seen.add(p.kana));
}
// 条件どおりのプールが WS_WORDS 人に満たない場合は段階的に範囲を広げる（widened: 0=そのまま, 1=選択グループ内で卒業生も含めた, 2=全グループ＋卒業生）
function effectivePoolFor(members, groups, includeGrad) {
  let pool = buildPool(members, groups, includeGrad);
  if (pool.length >= WS_WORDS) return { pool, widened: 0 };
  pool = buildPool(members, groups, true);
  if (pool.length >= WS_WORDS) return { pool, widened: 1 };
  return { pool: buildPool(members, [], true), widened: 2 };
}
function effectivePool() { return effectivePoolFor(MEMBERS, settings.groups, settings.grad); }

// 純粋関数：pool から盤面を生成する。単語は横（左→右）/縦（上→下）配置、一致する交差は可。
// 配置できない場合は引き直す。戻り値 {grid: string[10][10], words: [{name, kana, dir, cells:[[r,c],...]}]}、失敗時 null
function buildPuzzle(pool, rng) {
  const rand = rng || Math.random;
  const alpha = [...new Set(pool.flatMap(p => [...p.kana]))];
  if (pool.length < WS_WORDS || !alpha.length) return null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const picks = shuffleR([...pool], rand).slice(0, WS_WORDS);
    const grid = Array.from({ length: WS_SIZE }, () => Array(WS_SIZE).fill(""));
    const placed = [];
    let ok = true;
    for (const p of picks) {
      const w = p.kana;
      let done = false;
      for (let t = 0; t < 300 && !done; t++) {
        const dir = rand() < 0.5 ? "h" : "v";
        const dr = dir === "v" ? 1 : 0, dc = dir === "h" ? 1 : 0;
        const r = Math.floor(rand() * WS_SIZE), c = Math.floor(rand() * WS_SIZE);
        if (r + dr * (w.length - 1) >= WS_SIZE || c + dc * (w.length - 1) >= WS_SIZE) continue;
        const cells = [];
        let fits = true;
        for (let i = 0; i < w.length; i++) {
          const rr = r + dr * i, cc = c + dc * i;
          if (grid[rr][cc] && grid[rr][cc] !== w[i]) { fits = false; break; }
          cells.push([rr, cc]);
        }
        if (!fits) continue;
        cells.forEach(([rr, cc], i) => { grid[rr][cc] = w[i]; });
        placed.push({ name: p.name, kana: w, dir, cells });
        done = true;
      }
      if (!done) { ok = false; break; }
    }
    if (!ok) continue;
    for (let r = 0; r < WS_SIZE; r++) for (let c = 0; c < WS_SIZE; c++)
      if (!grid[r][c]) grid[r][c] = alpha[Math.floor(rand() * alpha.length)];
    return { grid, words: placed };
  }
  return null;
}

// 始点a→終点bの直線（行または列方向にスナップ）マス列を返す
function lineCells(a, b) {
  const dr = b.r - a.r, dc = b.c - a.c;
  const cells = [];
  if (Math.abs(dr) >= Math.abs(dc)) {
    const step = dr >= 0 ? 1 : -1;
    for (let r = a.r; ; r += step) { cells.push([r, a.c]); if (r === b.r) break; }
  } else {
    const step = dc >= 0 ? 1 : -1;
    for (let c = a.c; ; c += step) { cells.push([a.r, c]); if (c === b.c) break; }
  }
  return cells;
}
function cellEl(r, c) { return document.querySelector(`.ws-cell[data-r="${r}"][data-c="${c}"]`); }
function paintSel(cells) {
  document.querySelectorAll(".ws-cell.sel").forEach(el => el.classList.remove("sel"));
  (cells || []).forEach(([r, c]) => { const el = cellEl(r, c); if (el) el.classList.add("sel"); });
}
function setMsg(t) { const m = document.getElementById("wsMsg"); if (m) m.textContent = t; }

function judge(cells) {
  if (!puzzle || !cells.length) return;
  const str = cells.map(([r, c]) => puzzle.grid[r][c]).join("");
  const rev = [...str].reverse().join("");
  const hit = puzzle.words.find(w => !foundKana.has(w.kana) && (w.kana === str || w.kana === rev));
  paintSel(null);
  if (!hit) { setMsg("ちがうみたい…もう一度探してみてください"); return; }
  foundKana.add(hit.kana);
  hit.cells.forEach(([r, c]) => { const el = cellEl(r, c); if (el) el.classList.add("found"); });
  const li = document.querySelector(`.ws-list li[data-kana="${hit.kana}"]`);
  if (li) li.classList.add("done");
  const lab = document.getElementById("wsFound");
  if (lab) lab.textContent = `見つけた ${foundKana.size}／${WS_WORDS}`;
  if (foundKana.size >= puzzle.words.length) { finish(); return; }
  setMsg(`「${hit.name}」を見つけた！ あと${puzzle.words.length - foundKana.size}人`);
}

function cellFromPoint(x, y) {
  const t = document.elementFromPoint(x, y);
  const el = t && t.closest ? t.closest(".ws-cell") : null;
  if (!el) return null;
  return { r: +el.dataset.r, c: +el.dataset.c };
}
function bindGrid(grid) {
  grid.addEventListener("pointerdown", e => {
    if (!playing) return;
    const cell = cellFromPoint(e.clientX, e.clientY) || (e.target.closest && e.target.closest(".ws-cell") ? { r: +e.target.closest(".ws-cell").dataset.r, c: +e.target.closest(".ws-cell").dataset.c } : null);
    if (!cell) return;
    e.preventDefault();
    downCell = cell; curCell = cell;
    paintSel(lineCells(cell, cell));
  });
  grid.addEventListener("pointermove", e => {
    if (!playing || !downCell) return;
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;
    if (cell.r !== curCell.r || cell.c !== curCell.c) { curCell = cell; paintSel(lineCells(downCell, cell)); }
  });
  window.addEventListener("pointerup", e => {
    if (!playing || !downCell) return;
    const up = cellFromPoint(e.clientX, e.clientY) || curCell || downCell;
    const wasDrag = up && (up.r !== downCell.r || up.c !== downCell.c);
    const from = downCell;
    downCell = null; curCell = null;
    if (wasDrag) {
      anchorCell = null;
      document.querySelectorAll(".ws-cell.anchor").forEach(el => el.classList.remove("anchor"));
      judge(lineCells(from, up));
    } else {
      // タップ：1回目で始点、2回目で終点として確定
      paintSel(null);
      if (!anchorCell) {
        anchorCell = from;
        const el = cellEl(from.r, from.c);
        if (el) el.classList.add("anchor");
        setMsg("始点を選んだよ。終点をタップしてください");
      } else {
        const a = anchorCell;
        anchorCell = null;
        document.querySelectorAll(".ws-cell.anchor").forEach(el => el.classList.remove("anchor"));
        if (a.r === from.r && a.c === from.c) { setMsg("名前をドラッグ、または始点→終点のタップで選んでください"); return; }
        judge(lineCells(a, from));
      }
    }
  });
}

function start() {
  const eff = effectivePool();
  puzzle = buildPuzzle(eff.pool);
  const main = document.getElementById("wsMain");
  if (!puzzle) { main.innerHTML = `<p style="color:var(--muted)">盤面を作れませんでした。もう一度お試しください。</p>`; return; }
  foundKana = new Set(); downCell = null; curCell = null; anchorCell = null;
  const listWords = shuffle([...puzzle.words]);
  main.innerHTML = `<div class="ws-head"><span id="wsFound">見つけた 0／${WS_WORDS}</span><span>経過時間 <span id="wsTime">0:00</span></span></div>
    <div class="ws-grid" id="wsGrid">${puzzle.grid.map((row, r) => row.map((ch, c) => `<button type="button" class="ws-cell" data-r="${r}" data-c="${c}">${esc(ch)}</button>`).join("")).join("")}</div>
    <p class="ws-msg" id="wsMsg">名前をドラッグ、または始点→終点のタップで選んでください</p>
    <ul class="ws-list" id="wsList">${listWords.map(w => `<li data-kana="${esc(w.kana)}">${esc(w.name)}</li>`).join("")}</ul>`;
  bindGrid(document.getElementById("wsGrid"));
  if (eff.widened > 0) setMsg("選んだ条件だけでは人数が足りなかったため、範囲を広げて出題しています。名前をドラッグ、または始点→終点のタップで選んでください");
  playing = true;
  startAt = Date.now();
  clearInterval(timer);
  timer = setInterval(() => {
    const el = document.getElementById("wsTime");
    if (el) el.textContent = fmtTime(Math.floor((Date.now() - startAt) / 1000));
  }, 1000);
}

function finish() {
  playing = false;
  clearInterval(timer);
  const sec = Math.floor((Date.now() - startAt) / 1000);
  const isNew = wsBestSave(sec);
  const best = wsBest();
  const main = document.getElementById("wsMain");
  main.innerHTML = `<div class="card"><h3>🎉 クリア！</h3>
    <p>タイム：<b>${fmtTime(sec)}</b></p>
    ${best > 0 ? `<p style="color:var(--muted)">${isNew ? "🎉 ベストタイム更新！" : `ベストタイム：${fmtTime(best)}`}</p>` : ""}
    <p style="color:var(--muted)">${puzzle.words.map(w => esc(w.name)).join("・")}</p>
    <p><button type="button" class="btn" id="wsRetry">もう一度遊ぶ</button> <button type="button" class="btn" id="wsSettings">条件を変える</button></p></div>`;
  document.getElementById("wsRetry").addEventListener("click", start);
  document.getElementById("wsSettings").addEventListener("click", startPanel);
}

function startPanel() {
  const main = document.getElementById("wsMain");
  const best = wsBest();
  main.innerHTML = `<div class="card"><h3>遊び方</h3>
  <p style="color:var(--muted)">${document.documentElement.dataset.lite === "1" ? `盤面に隠れたメンバー${WS_WORDS}人の名前（カタカナ）を全部探すゲームです。出題するグループや卒業生の有無は下で選べます。` : `10×10のカタカナの盤面に、メンバー${WS_WORDS}人の名前（読み）が横（左→右）か縦（上→下）に隠れています。名前の最初から最後までをドラッグでなぞるか、始点と終点をタップして選んでください。全部見つけるまでのタイムが記録になります。出題するグループ（複数選択可）と卒業生の有無は下で選べます。`}</p>
  <p style="margin:10px 0 6px"><b>グループ</b>（複数選択可）</p>
  <div class="ychips" id="wsGroups"><button type="button" class="ychip" data-g="">すべて</button>${GROUPS.map(g => `<button type="button" class="ychip" data-g="${esc(g)}">${esc(g)}</button>`).join("")}</div>
  <p style="margin:10px 0 0"><label style="cursor:pointer"><input type="checkbox" id="wsGrad"> 卒業生も含める</label></p>
  <p style="color:var(--muted);font-size:13px" id="wsPoolNote"></p>
  ${best > 0 ? `<p style="color:var(--muted)">ベストタイム：${fmtTime(best)}</p>` : ""}
  <p><button type="button" class="primary" id="wsStart">スタート</button></p></div>`;
  const gradBox = document.getElementById("wsGrad");
  gradBox.checked = settings.grad;
  const paintSettings = () => {
    document.querySelectorAll("#wsGroups .ychip").forEach(ch => {
      const g = ch.dataset.g;
      ch.classList.toggle("on", g === "" ? settings.groups.length === 0 : settings.groups.includes(g));
    });
    gradBox.checked = settings.grad;
    const n = buildPool(MEMBERS, settings.groups, settings.grad).length;
    document.getElementById("wsPoolNote").textContent = `対象は${n}人です。この中から${WS_WORDS}人が出題されます。` + (n < WS_WORDS ? "人数が足りないため、自動で範囲を広げて出題します。" : "");
  };
  document.querySelectorAll("#wsGroups .ychip").forEach(ch => ch.addEventListener("click", () => {
    const g = ch.dataset.g;
    if (g === "") settings.groups = [];
    else if (settings.groups.includes(g)) settings.groups = settings.groups.filter(x => x !== g);
    else settings.groups = [...settings.groups, g];
    saveSettings();
    paintSettings();
  }));
  gradBox.addEventListener("change", () => { settings.grad = gradBox.checked; saveSettings(); paintSettings(); });
  paintSettings();
  document.getElementById("wsStart").addEventListener("click", start);
}

async function init() {
  const members = await loadJSON("members.json");
  MEMBERS = (members || []).map(m => ({ name: m.name, kana: toKata(m.reading), group: m.group, graduated: !!m.graduated }));
  GROUPS = WS_GROUP_ORDER.filter(g => MEMBERS.some(m => m.group === g));
  loadSettings();
  if (buildPool(MEMBERS, [], true).length < WS_WORDS) { document.getElementById("wsMain").innerHTML = `<p style="color:var(--muted)">メンバーデータが足りません。</p>`; return; }
  startPanel();
}
init();
