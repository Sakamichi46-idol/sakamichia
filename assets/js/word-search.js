// ワードサーチ：メンバーの名前（カタカナ読み）を10×10の盤面から探すパズル
const WS_SIZE = 10;
// 出題人数は5〜10人から選べる（既定は6人）
const WS_COUNTS = [5, 6, 7, 8, 9, 10], WS_DEFAULT_COUNT = 6;
const WS_GROUP_ORDER = ["乃木坂46", "櫻坂46", "日向坂46", "欅坂46", "けやき坂46"];
let MEMBERS = []; // {name（漢字）, kana（カタカナ読み）, group, graduated}
let GROUPS = []; // データに実在するグループ（表示順に整列済み）
let settings = { groups: [], grad: false, mode: "normal", count: WS_DEFAULT_COUNT }; // groups が空 = すべて / mode: "normal"（名前リスト表示）| "challenge"（名前リストを隠す）/ count: 出題人数
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("sakamichia-wordsearch-settings") || "null");
    if (s) settings = { groups: Array.isArray(s.groups) ? s.groups.filter(g => GROUPS.includes(g)) : [], grad: !!s.grad, mode: s.mode === "challenge" ? "challenge" : "normal", count: WS_COUNTS.includes(+s.count) ? +s.count : WS_DEFAULT_COUNT };
  } catch (e) {}
}
function saveSettings() { try { localStorage.setItem("sakamichia-wordsearch-settings", JSON.stringify(settings)); } catch (e) {} }
let puzzle = null, foundKana = new Set(), startAt = 0, timer = null, playing = false;
let gameMode = "normal", gameCount = WS_DEFAULT_COUNT, hintCount = 0, hintedKana = new Set();
let downCell = null, curCell = null, anchorCell = null;

function toKata(s) { return String(s || "").replace(/[ぁ-ん]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function shuffleR(a, rand) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function fmtTime(sec) { return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
// ベストタイム（秒・小さい方が記録）。quizBest 系は大きい方が記録の仕様なので、このゲーム専用に持つ
// ベストタイムはモード別×人数別に保存する。6人は従来から使っているキー（通常＝sakamichia-best-wordsearch、
// チャレンジ＝…-challenge）をそのまま使うので、旧記録は6人のベストとして自然に引き継がれる。
// 6人以外は末尾に -<人数> を付けたキーを使う
function wsBestKey(mode, count) {
  const base = mode === "challenge" ? "sakamichia-best-wordsearch-challenge" : "sakamichia-best-wordsearch";
  return count === WS_DEFAULT_COUNT ? base : `${base}-${count}`;
}
function wsBest(mode, count) { try { return +localStorage.getItem(wsBestKey(mode, count)) || 0; } catch (e) { return 0; } }
function wsBestSave(mode, count, sec) { try { const b = wsBest(mode, count); if (!b || sec < b) { localStorage.setItem(wsBestKey(mode, count), String(sec)); return true; } } catch (e) {} return false; }

// 出題プールから除外するメンバー（ユーザー指定）：松井玲奈はSKE48からの交換留学生という特殊扱いのため、
// 卒業生オンの場合も含めてワードサーチの対象外とする
const WS_EXCLUDED_NAMES = new Set(["松井玲奈"]);
// 出題プール：グループ（空 = すべて、OR条件）と卒業生の有無で絞り、読み4〜8文字・読み重複なし
function buildPool(members, groups, includeGrad) {
  const seen = new Set();
  return (members || []).filter(m => !WS_EXCLUDED_NAMES.has(m.name) && (!groups || !groups.length || groups.includes(m.group)) && (includeGrad || !m.graduated))
    .filter(p => p.kana.length >= 4 && p.kana.length <= 8 && !seen.has(p.kana) && seen.add(p.kana));
}
// 条件どおりのプールが選択中の出題人数（need、省略時は既定の6人）に満たない場合は段階的に範囲を広げる
// （widened: 0=そのまま, 1=選択グループ内で卒業生も含めた, 2=全グループ＋卒業生）
function effectivePoolFor(members, groups, includeGrad, need) {
  const n = need || WS_DEFAULT_COUNT;
  let pool = buildPool(members, groups, includeGrad);
  if (pool.length >= n) return { pool, widened: 0 };
  pool = buildPool(members, groups, true);
  if (pool.length >= n) return { pool, widened: 1 };
  return { pool: buildPool(members, [], true), widened: 2 };
}
function effectivePool() { return effectivePoolFor(MEMBERS, settings.groups, settings.grad, settings.count); }

// 発見ハイライトの色：出題メンバーごとに単語のインデックスで割り当てる10色（最大10人ぶん）
// 色味はサイト全体の方針に合わせ、淡い面＋濃い文字の10色（色相は従来の割り当てを維持）
// fg はその背景でカナが読める文字色（明るい背景には濃い文字色）
const WS_COLORS = [
  { bg: "#e3d7f5", fg: "#452a7d" }, // 紫（乃木坂46）
  { bg: "#fadbe6", fg: "#8f2c4f" }, // ピンク（櫻坂46）
  { bg: "#d8edf8", fg: "#175a7d" }, // 空色（日向坂46）
  { bg: "#dcf2d9", fg: "#256b1e" }, // 緑（欅坂46）
  { bg: "#fdeeda", fg: "#8a5410" }, // オレンジ
  { bg: "#dde6f2", fg: "#2c4a73" }, // 藍
  { bg: "#f9e0d6", fg: "#84371e" }, // テラコッタ
  { bg: "#d7f0ec", fg: "#14584e" }, // ティール
  { bg: "#faf3cd", fg: "#6b5903" }, // 黄
  { bg: "#e3e8ec", fg: "#3c4753" }  // スレートグレー
];
function wordColor(idx) { return WS_COLORS[((idx % WS_COLORS.length) + WS_COLORS.length) % WS_COLORS.length]; }

// 配置方向：全8方向（→ ← ↓ ↑ ↘ ↙ ↗ ↖）。逆向きに読む名前も盤面に現れる
const WS_DIRS = [
  { k: "h", dr: 0, dc: 1 }, { k: "H", dr: 0, dc: -1 },
  { k: "v", dr: 1, dc: 0 }, { k: "V", dr: -1, dc: 0 },
  { k: "d", dr: 1, dc: 1 }, { k: "D", dr: 1, dc: -1 },
  { k: "u", dr: -1, dc: 1 }, { k: "U", dr: -1, dc: -1 }
];
// 純粋関数：pool から盤面を生成する。2語目以降は、既配置の単語と文字が一致するマスで
// 交差する配置を優先的に試し、無理なら通常のランダム配置にフォールバックする。
// 配置できない場合はメンバーを引き直して再挑戦する（上限付き）。count は出題人数（省略時は6人）
// prefer は優先して出題するメンバー名の集合（出題の重複回避用。省略時は従来どおり全員から引く）
// 戻り値 {grid: string[10][10], words: [{name, kana, dir, cells:[[r,c],...]}]}、失敗時 null
function buildPuzzle(pool, rng, count, prefer) {
  const rand = rng || Math.random;
  const n = count || WS_DEFAULT_COUNT;
  const alpha = [...new Set(pool.flatMap(p => [...p.kana]))];
  if (pool.length < n || !alpha.length) return null;
  // (r,c,dir) に単語 w が置けるか判定し、置ける場合は cells、置けない場合は null
  const tryFit = (grid, w, r, c, dr, dc) => {
    const er = r + dr * (w.length - 1), ec = c + dc * (w.length - 1);
    if (r < 0 || c < 0 || er < 0 || ec < 0 || r >= WS_SIZE || c >= WS_SIZE || er >= WS_SIZE || ec >= WS_SIZE) return null;
    const cells = [];
    for (let i = 0; i < w.length; i++) {
      const rr = r + dr * i, cc = c + dc * i;
      if (grid[rr][cc] && grid[rr][cc] !== w[i]) return null;
      cells.push([rr, cc]);
    }
    return cells;
  };
  for (let attempt = 0; attempt < 100; attempt++) {
    // 引き直すたびにメンバーも選び直す。配置は長い名前から行うと、後半の詰まりが減って安定する
    // prefer があれば未出題メンバーから優先的に選び、足りない分だけ出題済みから補う
    const freshP = prefer ? pool.filter(p => prefer.has(p.name)) : pool;
    const picks = (freshP.length >= n
      ? shuffleR([...freshP], rand).slice(0, n)
      : [...freshP, ...shuffleR(pool.filter(p => !freshP.includes(p)), rand).slice(0, n - freshP.length)]
    ).sort((a, b) => b.kana.length - a.kana.length);
    const grid = Array.from({ length: WS_SIZE }, () => Array(WS_SIZE).fill(""));
    const placed = [];
    let ok = true;
    for (const p of picks) {
      const w = p.kana;
      let done = false;
      // 交差優先：既配置単語の各マスと文字が一致する位置で交差する配置候補を先に試す
      if (placed.length) {
        const cands = [];
        for (const pw of placed) pw.cells.forEach(([pr, pc], pi) => {
          for (let i = 0; i < w.length; i++) {
            if (w[i] !== pw.kana[pi]) continue;
            for (const d of WS_DIRS) cands.push({ r: pr - d.dr * i, c: pc - d.dc * i, d });
          }
        });
        for (const cand of shuffleR(cands, rand)) {
          const cells = tryFit(grid, w, cand.r, cand.c, cand.d.dr, cand.d.dc);
          if (!cells) continue;
          cells.forEach(([rr, cc], i) => { grid[rr][cc] = w[i]; });
          placed.push({ name: p.name, kana: w, dir: cand.d.k, cells });
          done = true;
          break;
        }
      }
      // フォールバック：通常のランダム配置
      for (let t = 0; t < 300 && !done; t++) {
        const d = WS_DIRS[Math.floor(rand() * WS_DIRS.length)];
        const r = Math.floor(rand() * WS_SIZE), c = Math.floor(rand() * WS_SIZE);
        const cells = tryFit(grid, w, r, c, d.dr, d.dc);
        if (!cells) continue;
        cells.forEach(([rr, cc], i) => { grid[rr][cc] = w[i]; });
        placed.push({ name: p.name, kana: w, dir: d.k, cells });
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

// 始点a→終点bの直線マス列を返す。方向は横・縦・斜め（45°単位）のうち最も近いものにスナップする
function lineCells(a, b) {
  const dr = b.r - a.r, dc = b.c - a.c;
  const adr = Math.abs(dr), adc = Math.abs(dc);
  let sr = 0, sc = 0, len = 0;
  if (adr === 0 && adc === 0) return [[a.r, a.c]];
  if (adc >= adr * 2) { sc = dc > 0 ? 1 : -1; len = adc; }        // 横
  else if (adr >= adc * 2) { sr = dr > 0 ? 1 : -1; len = adr; }   // 縦
  else { sr = dr > 0 ? 1 : -1; sc = dc > 0 ? 1 : -1; len = Math.max(adr, adc); } // 斜め
  // 盤面の外に出ないよう長さを丸める
  while (len > 0) {
    const er = a.r + sr * len, ec = a.c + sc * len;
    if (er >= 0 && er < WS_SIZE && ec >= 0 && ec < WS_SIZE) break;
    len--;
  }
  const cells = [];
  for (let i = 0; i <= len; i++) cells.push([a.r + sr * i, a.c + sc * i]);
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
  // ハイライトは単語ごとに割り当てた色で塗る（交差マスは後に見つけた単語の色で上書きされる）
  const col = wordColor(puzzle.words.indexOf(hit));
  hit.cells.forEach(([r, c]) => {
    const el = cellEl(r, c);
    if (el) { el.classList.add("found"); el.style.background = col.bg; el.style.borderColor = col.bg; el.style.color = col.fg; }
  });
  // 通常モードでは li が最初から並んでいる。チャレンジではヒント表示済みの li があれば流用し、無ければ発見時に追加する
  let li = document.querySelector(`.ws-list li[data-kana="${hit.kana}"]`);
  if (!li) {
    li = document.createElement("li");
    li.dataset.kana = hit.kana;
    li.textContent = hit.name;
    const ul = document.getElementById("wsList");
    if (ul) ul.appendChild(li);
  }
  li.classList.remove("hint");
  li.classList.add("done");
  li.style.setProperty("--wc", col.fg); // 名前リスト側の発見表示にも、その単語の色のドットを付ける
  const lab = document.getElementById("wsFound");
  if (lab) lab.textContent = `見つけた ${foundKana.size}／${puzzle.words.length}`;
  const rem = document.getElementById("wsRemain");
  if (rem) rem.textContent = `あと${puzzle.words.length - foundKana.size}人`;
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

// チャレンジモードのヒント：未発見かつヒント未表示の名前からランダムに1人をリストに表示する（発見扱いにはしない）
function useHint() {
  if (!playing || gameMode !== "challenge" || !puzzle) return;
  const rest = puzzle.words.filter(w => !foundKana.has(w.kana) && !hintedKana.has(w.kana));
  if (!rest.length) { setMsg("ヒントで出せる名前はもうありません"); return; }
  const pick = rest[Math.floor(Math.random() * rest.length)];
  hintedKana.add(pick.kana);
  hintCount++;
  const li = document.createElement("li");
  li.dataset.kana = pick.kana;
  li.className = "hint";
  li.textContent = pick.name;
  const ul = document.getElementById("wsList");
  if (ul) ul.appendChild(li);
  const hc = document.getElementById("wsHintCount");
  if (hc) hc.textContent = `ヒント ${hintCount}回`;
  setMsg(`ヒント：「${pick.name}」が隠れています`);
}

function start() {
  const eff = effectivePool();
  // 直近に出題したメンバーは避け、未出題のメンバーを優先する（端末に記録）
  const seenNames = new Set(quizSeenGet("wordsearch"));
  const prefer = new Set(eff.pool.filter(p => !seenNames.has(p.name)).map(p => p.name));
  puzzle = buildPuzzle(eff.pool, undefined, settings.count, prefer);
  const main = document.getElementById("wsMain");
  if (!puzzle) { main.innerHTML = `<p style="color:var(--muted)">盤面を作れませんでした。もう一度お試しください。</p>`; return; }
  quizSeenTouch("wordsearch", puzzle.words.map(w => w.name));
  foundKana = new Set(); downCell = null; curCell = null; anchorCell = null;
  gameMode = settings.mode;
  gameCount = puzzle.words.length;
  hintCount = 0; hintedKana = new Set();
  const listHtml = gameMode === "challenge"
    ? `<p class="ws-remain" id="wsRemain">あと${gameCount}人</p><ul class="ws-list" id="wsList"></ul>
    <p class="ws-hintrow"><button type="button" class="btn" id="wsHint">ヒント（名前を1人表示）</button> <span id="wsHintCount">ヒント 0回</span></p>`
    : `<ul class="ws-list" id="wsList">${shuffle([...puzzle.words]).map(w => `<li data-kana="${esc(w.kana)}">${esc(w.name)}</li>`).join("")}</ul>`;
  main.innerHTML = `<div class="ws-head"><span id="wsFound">見つけた 0／${gameCount}</span><span>経過時間 <span id="wsTime">0:00</span></span></div>
    <div class="ws-grid" id="wsGrid">${puzzle.grid.map((row, r) => row.map((ch, c) => `<button type="button" class="ws-cell" data-r="${r}" data-c="${c}">${esc(ch)}</button>`).join("")).join("")}</div>
    <p class="ws-msg" id="wsMsg">名前をドラッグ、または始点→終点のタップで選んでください</p>
    ${listHtml}`;
  bindGrid(document.getElementById("wsGrid"));
  const hintBtn = document.getElementById("wsHint");
  if (hintBtn) hintBtn.addEventListener("click", useHint);
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
  const isNew = wsBestSave(gameMode, gameCount, sec);
  const best = wsBest(gameMode, gameCount);
  const main = document.getElementById("wsMain");
  main.innerHTML = `<div class="card"><h3>クリア！</h3>
    <p>タイム：<b>${fmtTime(sec)}</b></p>
    ${gameMode === "challenge" ? `<p>ヒント使用：${hintCount}回</p>` : ""}
    ${best > 0 ? `<p style="color:var(--muted)">${isNew ? "ベストタイム更新！" : `ベストタイム：${fmtTime(best)}`}</p>` : ""}
    <p style="color:var(--muted)">${puzzle.words.map(w => esc(w.name)).join("・")}</p>
    <p><button type="button" class="btn" id="wsRetry">もう一度遊ぶ</button> <button type="button" class="btn" id="wsSettings">条件を変える</button></p></div>`;
  document.getElementById("wsRetry").addEventListener("click", start);
  document.getElementById("wsSettings").addEventListener("click", startPanel);
}

function startPanel() {
  const main = document.getElementById("wsMain");
  main.innerHTML = `<div class="card"><h3>遊び方</h3>
  <p style="color:var(--muted)">${document.documentElement.dataset.lite === "1" ? `盤面に隠れたメンバーの名前（カタカナ）を全部探すゲームです。名前は縦・横・斜め＋逆向きの8方向に隠れています。出題するグループや卒業生の有無、人数、名前の表示は下で選べます。` : `10×10のカタカナの盤面に、メンバーの名前（読み）が隠れています。名前が並ぶ向きは、縦・横・斜めに逆向き（右から左、下から上など）を加えた全8方向のどれかです。名前の最初から最後までをドラッグでなぞるか、始点と終点をタップして選んでください。全部見つけるまでのタイムが記録になります（ベストタイムは人数ごとに別々に残ります）。出題するグループ（複数選択可）と卒業生の有無、出題人数、名前の表示方法は下で選べます。チャレンジモードでは探す名前のリストが表示されません（ヒントボタンで1人ずつ表示できます）。`}</p>
  <p style="margin:10px 0 6px"><b>グループ</b>（複数選択可）</p>
  <div class="ychips" id="wsGroups"><button type="button" class="ychip" data-g="">すべて</button>${GROUPS.map(g => `<button type="button" class="ychip" data-g="${esc(g)}">${esc(g)}</button>`).join("")}</div>
  <p style="margin:10px 0 0"><label style="cursor:pointer"><input type="checkbox" id="wsGrad"> 卒業生も含める</label></p>
  <p style="margin:10px 0 6px"><b>名前の表示</b></p>
  <div class="ychips" id="wsMode"><button type="button" class="ychip" data-m="normal">通常（名前リストを表示）</button><button type="button" class="ychip" data-m="challenge">チャレンジ（名前リストを隠す）</button></div>
  <p style="margin:10px 0 6px"><b>人数</b></p>
  <div class="ychips" id="wsCount">${WS_COUNTS.map(n => `<button type="button" class="ychip" data-n="${n}">${n}人</button>`).join("")}</div>
  <p style="color:var(--muted);font-size:13px" id="wsPoolNote"></p>
  <p style="color:var(--muted)" id="wsBestLine"></p>
  <p><button type="button" class="primary" id="wsStart">スタート</button></p></div>`;
  const gradBox = document.getElementById("wsGrad");
  gradBox.checked = settings.grad;
  const paintSettings = () => {
    document.querySelectorAll("#wsGroups .ychip").forEach(ch => {
      const g = ch.dataset.g;
      ch.classList.toggle("on", g === "" ? settings.groups.length === 0 : settings.groups.includes(g));
    });
    gradBox.checked = settings.grad;
    document.querySelectorAll("#wsMode .ychip").forEach(ch => ch.classList.toggle("on", ch.dataset.m === settings.mode));
    document.querySelectorAll("#wsCount .ychip").forEach(ch => ch.classList.toggle("on", +ch.dataset.n === settings.count));
    const n = buildPool(MEMBERS, settings.groups, settings.grad).length;
    document.getElementById("wsPoolNote").textContent = `対象は${n}人です。この中から${settings.count}人が出題されます。` + (n < settings.count ? "人数が足りないため、自動で範囲を広げて出題します。" : "");
    const b = wsBest(settings.mode, settings.count);
    document.getElementById("wsBestLine").textContent = b > 0 ? `${settings.mode === "challenge" ? "チャレンジモードのベストタイム" : "ベストタイム"}（${settings.count}人）：${fmtTime(b)}` : "";
  };
  document.querySelectorAll("#wsMode .ychip").forEach(ch => ch.addEventListener("click", () => {
    settings.mode = ch.dataset.m === "challenge" ? "challenge" : "normal";
    saveSettings();
    paintSettings();
  }));
  document.querySelectorAll("#wsCount .ychip").forEach(ch => ch.addEventListener("click", () => {
    settings.count = WS_COUNTS.includes(+ch.dataset.n) ? +ch.dataset.n : WS_DEFAULT_COUNT;
    saveSettings();
    paintSettings();
  }));
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
  if (buildPool(MEMBERS, [], true).length < WS_DEFAULT_COUNT) { document.getElementById("wsMain").innerHTML = `<p style="color:var(--muted)">メンバーデータが足りません。</p>`; return; }
  startPanel();
}
init();
