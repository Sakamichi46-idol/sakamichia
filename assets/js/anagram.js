// アナグラム：カタカナのタイルを並べ替えてメンバー名・楽曲タイトルを当てるクイズ
// 出題とシャッフルは data/anagram.json の検証済みデータを使う。シャッフルは
// ビルド時（tools/build_anagram.py）に「IPADIC の語彙だけで全分割できる」ことを
// 検証した並びだけが収録されている（ランダムな順列は出題しない）。
// 個数を2・3にすると、複数の素材の読みを混ぜた長い問題になる（組み合わせも
// ビルド時に検証済み）。判定は、構成素材を何らかの順番で連結したもの、または
// 同じ個数の別の素材の組み合わせに分割できる並びを正解とする。
const AG_TOTAL = 10;
const AG_HINT_COST = 20;
const AG_MODES = [
  { id: "member", label: "メンバー名" },
  { id: "song", label: "楽曲タイトル" },
  { id: "mix", label: "ミックス" },
];
let AG = { members: [], songs: [], combos: [] };
let AG_DICT = new Map(); // 読み（カタカナ）-> [{kind, label}]（別解判定用）
let AG_KATAS = []; // 全素材の読み一覧（組み合わせ判定の分割用）
let AG_GRAD = new Map(); // メンバー名 -> 卒業生かどうか（members.json 由来）
let selMode = "member";
let gameTotal = AG_TOTAL; // そのゲームの出題数（プールが10件未満なら min(10, プール数)）
// 絞り込み設定：グループは複数選択（空 = すべて、OR条件）。status はメンバー素材にのみ効く
// （"all" = 両方 / "active" = 現役のみ / "grad" = 卒業生のみ、既定は "all"）。
// count は1問に混ぜる素材の個数（1 = 通常 / 2 / 3、既定は 1）
const AG_GROUP_ORDER = ["乃木坂46", "櫻坂46", "日向坂46", "欅坂46", "けやき坂46"];
let AG_GROUPS = []; // プールに実在するグループ（表示順に整列済み）
let agSettings = { groups: [], status: "all", count: 1 };
function agLoadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("sakamichia-anagram-settings") || "null");
    if (s) agSettings = {
      groups: Array.isArray(s.groups) ? s.groups.filter(g => AG_GROUPS.includes(g)) : [],
      status: s.status === "active" || s.status === "grad" ? s.status : "all",
      count: s.count === 2 || s.count === 3 ? s.count : 1,
    };
  } catch (e) {}
}
function agSaveSettings() { try { localStorage.setItem("sakamichia-anagram-settings", JSON.stringify(agSettings)); } catch (e) {} }
function agBestKey() { return agSettings.count === 1 ? "anagram" : "anagram" + agSettings.count; }
// 設定で1素材が出題対象になるか（グループは両モード共通、現役・卒業はメンバー素材のみ）。
// e は単体エントリ（graduated 付与済み）でも組み合わせの構成素材 {k, name/title, group} でもよい
function agEntryOk(e, kind) {
  if (agSettings.groups.length && !agSettings.groups.includes(e.group)) return false;
  if (kind === "member" && agSettings.status !== "all") {
    const grad = e.graduated !== undefined ? e.graduated : (AG_GRAD.get(e.name) || false);
    if (agSettings.status === "active" && grad) return false;
    if (agSettings.status === "grad" && !grad) return false;
  }
  return true;
}
// モード＋現在の設定で出題対象になる単体素材一覧（{e, kind}）
function agFilteredSources(mode) {
  let src = [];
  if (mode === "member" || mode === "mix") src = src.concat(AG.members.filter(e => agEntryOk(e, "member")).map(e => ({ e, kind: "member" })));
  if (mode === "song" || mode === "mix") src = src.concat(AG.songs.filter(e => agEntryOk(e, "song")).map(e => ({ e, kind: "song" })));
  return src;
}
// 組み合わせの構成素材（data 側の参照）を統一形 {kind, label, group, year, kata} にする
function agComboItem(it) {
  return it.k === "m"
    ? { kind: "member", label: it.name, group: it.group, year: null, kata: it.kata, name: it.name }
    : { kind: "song", label: it.title, group: it.group, year: it.year, kata: it.kata };
}
// 設定で出題対象になる組み合わせ一覧（全構成素材が条件を満たすものだけ）
function agFilteredCombos(mode, count) {
  return AG.combos.filter(c => {
    if (c.items.length !== count) return false;
    const kinds = c.items.map(it => it.k);
    if (mode === "member" && !kinds.every(k => k === "m")) return false;
    if (mode === "song" && !kinds.every(k => k === "s")) return false;
    return c.items.every(it => agEntryOk(it, it.k === "m" ? "member" : "song"));
  });
}
// 出題できる数（個数1は同じ読みを1問までとするため読みの種類数、組み合わせは組み合わせ数）
function agPoolCount(mode) {
  if (agSettings.count === 1) return new Set(agFilteredSources(mode).map(it => it.e.kata)).size;
  return agFilteredCombos(mode, agSettings.count).length;
}
let questions = [], qIdx = 0, score = 0, results = [];
let cur = null; // {q, kata, base, tiles:Map(id->ch), slots:[id|null], pool:[id], initialPool:[id], locked:Set(slotIdx), hints, judged, built}

function agShuffle(a, rng) { const r = rng || Math.random; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function agLabel(e, kind) { return kind === "member" ? e.name : e.title; }
function agClue(e, kind) { return kind === "member" ? `所属：${e.group}` : `${e.group} ・ ${e.year}年発売`; }

// 単体素材1つ分の出題素材（統一形）
function agSingleItem(e, kind) {
  return { kind, label: agLabel(e, kind), group: e.group, year: kind === "song" ? e.year : null, kata: e.kata };
}
// 質問の見出し（手がかり）。組み合わせは個数と内訳を、素材ごとに「文字数・グループ（年）」の組で明示する
function agQuestionClue(q) {
  if (q.items.length === 1) {
    const it = q.items[0];
    return `${it.kind === "member" ? "メンバー名" : "楽曲タイトル"}（${it.kata.length}文字）・ ${it.kind === "member" ? `所属：${it.group}` : `${it.group} ・ ${it.year}年発売`}`;
  }
  const allM = q.items.every(it => it.kind === "member");
  const allS = q.items.every(it => it.kind === "song");
  const head = allM ? `メンバー名 ${q.items.length}人分` : allS ? `楽曲タイトル ${q.items.length}曲分` : `ミックス ${q.items.length}個分`;
  const parts = q.items.map(it => {
    if (it.kind === "member") return allM ? `${it.kata.length}文字・${it.group}` : `${it.kata.length}文字・メンバー ${it.group}`;
    return allS ? `${it.kata.length}文字・${it.group}（${it.year}年）` : `${it.kata.length}文字・楽曲 ${it.group}（${it.year}年）`;
  });
  return `${head}：${parts.join("／")}`;
}
window.agQuestionClue = agQuestionClue;

// 1問分の出題を作る（テストから検証できるよう公開する）
// entry.shuffles から rng で1つ選ぶ。戻り値 {kata, text, parts}
function buildAnagramQuestion(entry, rng) {
  const r = rng || Math.random;
  const s = entry.shuffles[Math.floor(r() * entry.shuffles.length)];
  return { kata: entry.kata, text: s.t, parts: [...s.w] };
}
window.buildAnagramQuestion = buildAnagramQuestion;

// 並べた文字列の判定（単体）：対象そのものなら正解、別の実在素材の読みと完全一致すれば別解で正解
function anagramJudge(kata, built) {
  if (built === kata) return { ok: true, alt: null };
  const alts = AG_DICT.get(built);
  if (alts && alts.length) return { ok: true, alt: alts[0] };
  return { ok: false, alt: null };
}
window.anagramJudge = anagramJudge;

// built を count 個の素材の読みに分割する（できればその読みの配列、無理なら null）
function agSegment(built, count) {
  const memo = new Map();
  function dfs(pos, left) {
    if (pos === built.length) return left === 0 ? [] : null;
    if (left === 0) return null;
    const key = pos + "/" + left;
    if (memo.has(key)) return memo.get(key);
    let out = null;
    for (const k of AG_KATAS) {
      if (k.length <= built.length - pos && built.startsWith(k, pos)) {
        const rest = dfs(pos + k.length, left - 1);
        if (rest) { out = [k, ...rest]; break; }
      }
    }
    memo.set(key, out);
    return out;
  }
  return dfs(0, count);
}
window.agSegment = agSegment;

// 並べた文字列の判定（組み合わせ）：count 個の素材に分割できれば正解。
// 分割が構成素材そのもの（順番違い含む）なら通常の正解、それ以外なら別解として正解
function anagramJudgeCombo(built, count, ownKatas) {
  const seg = agSegment(built, count);
  if (!seg) return { ok: false, alt: null, seg: null };
  const own = [...ownKatas].sort().join(" ");
  if ([...seg].sort().join(" ") === own) return { ok: true, alt: null, seg };
  const labels = seg.map(k => { const a = AG_DICT.get(k); return a && a.length ? a[0].label : k; });
  return { ok: true, alt: labels, seg };
}
window.anagramJudgeCombo = anagramJudgeCombo;

// この問題の現時点での最高点（ヒント使用分を差し引く）
function agCurMax() {
  return Math.max(10, cur.base - AG_HINT_COST * cur.hints);
}

function agPools() {
  return {
    member: AG.members.length, song: AG.songs.length,
    combos: AG.combos.length, dict: AG_DICT.size,
  };
}
window.__agPools = agPools;
// テスト用：絞り込み設定の操作とプール数の確認
window.__agFilters = {
  poolCount: agPoolCount,
  groups: () => [...AG_GROUPS],
  set(groups, status, count) {
    agSettings = {
      groups: [...(groups || [])],
      status: status || "all",
      count: count === 2 || count === 3 ? count : 1,
    };
    agSaveSettings();
  },
  get() { return { groups: [...agSettings.groups], status: agSettings.status, count: agSettings.count }; },
};

function __agState() {
  return {
    mode: selMode, total: gameTotal, pool: agPoolCount(selMode),
    settings: { groups: [...agSettings.groups], status: agSettings.status, count: agSettings.count },
    idx: qIdx, score,
    questions: questions.map(q => ({
      kata: q.kata, kind: q.kind, text: q.text, parts: q.parts ? [...q.parts] : [],
      items: q.items.map(it => ({ label: it.label, kata: it.kata, kind: it.kind })),
    })),
    pool: cur ? cur.pool.map(id => cur.tiles.get(id)).join("") : "",
    initialPool: cur ? cur.initialPool.map(id => cur.tiles.get(id)).join("") : "",
    built: cur ? cur.slots.map(id => (id == null ? "" : cur.tiles.get(id))).join("") : "",
    judged: !!(cur && cur.judged), hints: cur ? cur.hints : 0,
    maxPts: cur ? agCurMax() : 0,
    results: results.map(r => ({ ...r })),
  };
}
window.__agState = __agState;

function pickQuestions(mode) {
  if (agSettings.count === 1) {
    const src = agFilteredSources(mode);
    agShuffle(src);
    const seen = new Set(), out = [];
    for (const it of src) {
      if (seen.has(it.e.kata)) continue; // 同じ読みは1ゲームに1問まで
      seen.add(it.e.kata);
      const q = buildAnagramQuestion(it.e);
      out.push({ items: [agSingleItem(it.e, it.kind)], kind: it.kind, kata: it.e.kata, text: q.text, parts: q.parts });
      if (out.length >= AG_TOTAL) break;
    }
    return out;
  }
  const count = agSettings.count;
  const combos = agFilteredCombos(mode, count);
  agShuffle(combos);
  const usedKatas = new Set(), picked = [], rest = [];
  for (const c of combos) {
    const itemKatas = c.items.map(it => it.kata);
    if (itemKatas.some(k => usedKatas.has(k))) { rest.push(c); continue; }
    itemKatas.forEach(k => usedKatas.add(k));
    picked.push(c);
    if (picked.length >= AG_TOTAL) break;
  }
  // 同じ素材の再利用を避けると目標数に届かない場合は、残りから補充する
  for (const c of rest) {
    if (picked.length >= Math.min(AG_TOTAL, combos.length)) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked.map(c => {
    const s = c.shuffles[Math.floor(Math.random() * c.shuffles.length)];
    const items = c.items.map(agComboItem);
    const allM = items.every(it => it.kind === "member");
    const allS = items.every(it => it.kind === "song");
    return { items, kind: allM ? "member" : allS ? "song" : "mix", kata: c.kata, text: s.t, parts: [...s.w] };
  });
}

function startQuestion() {
  const q = questions[qIdx];
  const tiles = new Map();
  const pool = [];
  q.text.split("").forEach((ch, i) => { const id = "t" + i; tiles.set(id, ch); pool.push(id); });
  // タイルの初期表示順はランダムにする。検証済み文字列（q.text）は辞書の単語を
  // 連結した並びなので、そのまま並べると単語の塊が読めてしまうため、表示順だけを
  // 並べ替える（q.text 自体はデータとして保持する）。この初期順序は問題ごとに
  // 保持し、タイルを戻したとき・リセットしたときの復元先になる
  agShuffle(pool);
  cur = {
    q, kata: q.kata, base: 100 * q.items.length, tiles, pool,
    initialPool: [...pool],
    slots: new Array(q.kata.length).fill(null),
    locked: new Set(), hints: 0, judged: false, built: "",
  };
  renderQuestion("");
}

function slotStr() { return cur.slots.map(id => (id == null ? "" : cur.tiles.get(id))).join(""); }

// タイルの一辺（px）：n 個が1行に収まるよう、文字数と画面幅から決める。
// 最大44px、間隔6px、コンテナ幅は最大430px（画面幅から余白24pxを引いた値）として計算する
function agTileSize(n, vw) {
  const avail = Math.min(430, (vw || 430) - 24);
  return Math.max(24, Math.min(44, Math.floor((avail - 6 * (n - 1)) / n)));
}
window.agTileSize = agTileSize;

function renderQuestion(msg) {
  const main = document.getElementById("agMain");
  const q = cur.q;
  const full = cur.pool.length === 0;
  // 解答欄に動かせるタイル（ヒント固定以外）があるか。「1文字消す」の有効判定に使う
  const hasRemovable = cur.slots.some((id, i) => id != null && !cur.locked.has(i));
  // タイルサイズは合計文字数基準で決める：合計が10文字以下なら1行に収まる大きさ、
  // それより長い場合は1行に10個が収まる大きさにして均等に折り返す。解答欄と
  // タイル置き場で同じサイズを使う
  const tw = agTileSize(Math.min(10, q.kata.length), window.innerWidth);
  // 解答欄は素材ごとの区切りを持たず、全体で1本のスロット列にする。区切りの
  // 情報は手がかりの内訳表示で伝え、プレイヤーが解いた順番と表示がずれないようにする
  const slotsHtml = cur.slots.map((id, i) => {
    if (id == null) return `<span class="ag-tile ag-slot" data-slot="${i}"></span>`;
    const cls = ["ag-tile", "placed"];
    if (cur.locked.has(i)) cls.push("locked");
    // ヒントで固定されたタイルは押せない
    const dis = cur.judged || cur.locked.has(i);
    return `<button type="button" class="${cls.join(" ")}" data-slot="${i}" ${dis ? "disabled" : ""}>${esc(cur.tiles.get(id))}</button>`;
  }).join("");
  main.innerHTML = `<div class="ag-head"><span>第${qIdx + 1}問／${gameTotal}問</span><span>スコア ${score}点</span></div>
  <p class="ag-clue">${esc(agQuestionClue(q))}</p>
  <p class="ag-rowlabel">解答欄（タップで戻す）</p>
  <div class="ag-answer" id="agAnswer" style="--agtw:${tw}px">${slotsHtml}</div>
  <p class="ag-rowlabel">タイル（タップで解答欄へ）</p>
  <div class="ag-pool" id="agPool" style="--agtw:${tw}px">${cur.pool.map(id => `<button type="button" class="ag-tile" data-tile="${id}" ${cur.judged ? "disabled" : ""}>${esc(cur.tiles.get(id))}</button>`).join("")}</div>
  <div class="ag-btns">
    <button type="button" class="btn sub" id="agHint" ${cur.judged ? "disabled" : ""}>ヒント（−${AG_HINT_COST}点）</button>
    <button type="button" class="btn sub" id="agReset" ${cur.judged ? "disabled" : ""}>リセット</button>
    <button type="button" class="btn sub" id="agErase" ${cur.judged || !hasRemovable ? "disabled" : ""}>1文字消す</button>
    <button type="button" class="primary" id="agCheck" ${cur.judged || !full ? "disabled" : ""}>答え合わせ</button>
  </div>
  <p class="ag-msg" id="agMsg">${esc(msg || "")}</p>
  <div class="ag-verdict" id="agVerdict"></div>`;
  main.querySelectorAll("#agPool .ag-tile").forEach(el => el.addEventListener("click", () => placeTile(el.dataset.tile)));
  main.querySelectorAll("#agAnswer .ag-tile.placed").forEach(el => el.addEventListener("click", () => unplaceTile(+el.dataset.slot)));
  const hintBtn = document.getElementById("agHint");
  if (hintBtn) hintBtn.addEventListener("click", useHint);
  const resetBtn = document.getElementById("agReset");
  if (resetBtn) resetBtn.addEventListener("click", resetTiles);
  const eraseBtn = document.getElementById("agErase");
  if (eraseBtn) eraseBtn.addEventListener("click", eraseOne);
  const checkBtn = document.getElementById("agCheck");
  if (checkBtn) checkBtn.addEventListener("click", judge);
}

function placeTile(id) {
  if (!cur || cur.judged) return;
  const i = cur.slots.indexOf(null);
  if (i < 0) return;
  cur.pool = cur.pool.filter(x => x !== id);
  cur.slots[i] = id;
  renderQuestion("");
}

// タイルをプールに戻す。戻す先は末尾ではなく、出題時の初期順序
// （cur.initialPool）どおりの位置。プールの並びは常に初期順序を保つ
function agPoolReturn(id) {
  const order = cur.initialPool;
  const pos = order.indexOf(id);
  let at = cur.pool.length;
  for (let i = 0; i < cur.pool.length; i++) {
    if (order.indexOf(cur.pool[i]) > pos) { at = i; break; }
  }
  cur.pool.splice(at, 0, id);
}

function unplaceTile(slot) {
  if (!cur || cur.judged || cur.locked.has(slot)) return;
  const id = cur.slots[slot];
  if (id == null) return;
  cur.slots[slot] = null;
  agPoolReturn(id);
  renderQuestion("");
}

// 1文字消す：並びの末尾側にある動かせるタイルを1つだけプールに戻す。
// ヒントで固定されたタイルは飛ばす
function eraseOne() {
  if (!cur || cur.judged) return;
  for (let i = cur.slots.length - 1; i >= 0; i--) {
    if (cur.slots[i] != null && !cur.locked.has(i)) { unplaceTile(i); return; }
  }
}

function resetTiles() {
  if (!cur || cur.judged) return;
  // 出題直後の最初の状態に完全に戻す：全タイルを初期順序でプールに戻し、
  // ヒントで固定されたタイルも含めて解答欄を空にする。ただしヒント使用による
  // 減点（hints）は戻さない（リセットで上限点が回復してしまわないように）
  cur.pool = [...cur.initialPool];
  cur.slots = new Array(cur.kata.length).fill(null);
  cur.locked.clear();
  renderQuestion("");
}

function useHint() {
  if (!cur || cur.judged) return;
  const target = cur.kata;
  let i = 0;
  while (i < target.length) {
    const id = cur.slots[i];
    if (id != null && cur.tiles.get(id) === target[i]) { i++; continue; }
    break;
  }
  if (i >= target.length) return; // すでに正しい並び
  const need = target[i];
  // スロット i にあるタイル（不正解のもの）はプールへ戻す（初期順序どおりの位置へ）
  if (cur.slots[i] != null) { agPoolReturn(cur.slots[i]); cur.slots[i] = null; }
  // 必要な文字をプールから探す。無ければ「間違ったスロット」から持ってくる
  let srcId = cur.pool.find(id => cur.tiles.get(id) === need);
  if (srcId == null) {
    for (let j = 0; j < cur.slots.length; j++) {
      const id = cur.slots[j];
      if (id != null && !cur.locked.has(j) && cur.tiles.get(id) === need && cur.tiles.get(id) !== target[j]) { srcId = id; cur.slots[j] = null; break; }
    }
  }
  if (srcId == null) return; // 理論上は到達しない
  cur.pool = cur.pool.filter(x => x !== srcId);
  cur.slots[i] = srcId;
  cur.locked.add(i);
  cur.hints++;
  renderQuestion(`ヒント：${i + 1}文字目を確定しました（この問題は最大 ${agCurMax()} 点）`);
}

function judge() {
  if (!cur || cur.judged || cur.pool.length > 0) return;
  const built = slotStr();
  cur.built = built;
  const q = cur.q;
  const ownLabels = q.items.map(it => `${it.label}（${it.kata}）`).join("／");
  let res;
  if (q.items.length === 1) {
    const r = anagramJudge(cur.kata, built);
    res = { ok: r.ok, altLabel: r.alt ? r.alt.label : null };
  } else {
    const r = anagramJudgeCombo(built, q.items.length, q.items.map(it => it.kata));
    res = { ok: r.ok, altLabel: r.alt ? r.alt.join("／") : null };
  }
  const pts = res.ok ? agCurMax() : 0;
  cur.judged = true;
  score += pts;
  results.push({ mine: built, label: ownLabels, kata: cur.kata, ok: res.ok, pts, alt: res.altLabel });
  renderQuestion("");
  const v = document.getElementById("agVerdict");
  const last = qIdx >= gameTotal - 1;
  let html;
  if (res.ok) {
    html = `<p class="ok">⭕ 正解！ ${pts}点</p>
    <p>${esc(ownLabels)}${res.altLabel ? `<br>※並べた「${esc(built)}」は ${esc(res.altLabel)} の読みとしても成立するので正解です` : ""}</p>`;
  } else {
    html = `<p class="ng">❌ 不正解</p><p>正解は ${esc(ownLabels)} でした</p>`;
  }
  html += `<p><button type="button" class="primary" id="agNext">${last ? "結果を見る" : "次の問題へ"}</button></p>`;
  v.innerHTML = html;
  document.getElementById("agNext").addEventListener("click", () => { if (last) finish(); else { qIdx++; startQuestion(); } });
}

function finish() {
  const total = score;
  const count = agSettings.count;
  const maxTotal = gameTotal * 100 * count;
  const isNew = quizBestSave(agBestKey(), total);
  const best = quizBest(agBestKey());
  const main = document.getElementById("agMain");
  main.innerHTML = `<div class="card"><h3>結果：${total}点 ／ ${maxTotal}点</h3>
  ${best ? `<p style="color:var(--muted)">${isNew ? "🎉 自己ベスト更新！" : `自己ベスト：${best}点`}</p>` : ""}
  <div class="ag-lines">${results.map((r, i) => `<p style="margin:4px 0">${i + 1}問目 ${esc(r.mine)}：${r.ok ? r.pts + "点" : `不正解（正解は${esc(r.label)}）`}</p>`).join("")}</div>
  <p><button type="button" class="btn" id="agRetry">もう一度遊ぶ</button> <button type="button" class="btn" id="agSettings">条件を変える</button> <button type="button" class="btn sub" id="agShare">結果を共有する</button></p></div>`;
  document.getElementById("agRetry").addEventListener("click", startGame);
  document.getElementById("agSettings").addEventListener("click", startPanel);
  document.getElementById("agShare").addEventListener("click", e => shareScoreImage({
    game: "アナグラム", score: `${total}点／${maxTotal}点`,
    lines: results.map((r, i) => `${i + 1}問目 ${r.mine}：${r.ok ? r.pts + "点" : "不正解（正解は" + r.label + "）"}`),
  }, e.target));
}

function startGame() {
  questions = pickQuestions(selMode);
  if (!questions.length) { document.getElementById("agMain").innerHTML = `<p style="color:var(--muted)">選んだ条件では出題できる対象がありません。条件を変えてください。</p>`; return; }
  gameTotal = questions.length; // min(10, プール数)
  qIdx = 0; score = 0; results = [];
  startQuestion();
}

function startPanel() {
  const main = document.getElementById("agMain");
  const lite = document.documentElement.dataset.lite === "1";
  main.innerHTML = `<div class="card"><h3>遊び方</h3>
  <p style="color:var(--muted)">${lite
    ? `カタカナのタイルを並べ替えて、メンバー名か曲名を当てるクイズです。全<span id="agHowN">${AG_TOTAL}</span>問。ヒントは1回−${AG_HINT_COST}点です。出題するグループや現役・卒業、個数は下で選べます。`
    : `並んでいるカタカナのタイルは、あるメンバー名（または楽曲タイトル）の読みをバラバラにしたものです。タイルをタップして解答欄に並べ、正しい読みを作ってください。解答欄のタイルをタップすると戻せます。全<span id="agHowN">${AG_TOTAL}</span>問・1問100点（混ぜる個数を増やすと1問200点・300点）。ヒントを使うと、その文字が正しい位置に固定される代わりに1回−${AG_HINT_COST}点（最低10点）になります。並べた結果が別のメンバー名・曲名の読みと一致した場合も正解になります。出題するグループ（複数選択可）と、メンバーの現役・卒業、混ぜる個数は下で選べます。`}</p>
  <p style="margin:10px 0 6px"><b>出題モード</b></p>
  <div class="ychips" id="agModes">${AG_MODES.map(m => `<button type="button" class="ychip" data-m="${m.id}">${m.label}</button>`).join("")}</div>
  <p style="margin:10px 0 6px"><b>混ぜる個数</b></p>
  <div class="ychips" id="agCounts"><button type="button" class="ychip" data-c="1">1つ（通常）</button><button type="button" class="ychip" data-c="2">2つ</button><button type="button" class="ychip" data-c="3">3つ</button></div>
  <p style="margin:10px 0 6px"><b>グループ</b>（複数選択可）</p>
  <div class="ychips" id="agGroups"><button type="button" class="ychip" data-g="">すべて</button>${AG_GROUPS.map(g => `<button type="button" class="ychip" data-g="${esc(g)}">${esc(g)}</button>`).join("")}</div>
  <div id="agStatusWrap">
  <p style="margin:10px 0 6px"><b>現役・卒業</b>（メンバー名のみ）</p>
  <div class="ychips" id="agStatus"><button type="button" class="ychip" data-s="all">両方</button><button type="button" class="ychip" data-s="active">現役のみ</button><button type="button" class="ychip" data-s="grad">卒業生のみ</button></div>
  </div>
  <p style="color:var(--muted);font-size:13px" id="agPoolNote"></p>
  <p style="color:var(--muted)" id="agBestLine"></p>
  <p><button type="button" class="primary" id="agStart">スタート</button></p></div>`;
  const paint = () => {
    document.querySelectorAll("#agModes .ychip").forEach(ch => ch.classList.toggle("on", ch.dataset.m === selMode));
    document.querySelectorAll("#agCounts .ychip").forEach(ch => ch.classList.toggle("on", +ch.dataset.c === agSettings.count));
    document.querySelectorAll("#agGroups .ychip").forEach(ch => {
      const g = ch.dataset.g;
      ch.classList.toggle("on", g === "" ? agSettings.groups.length === 0 : agSettings.groups.includes(g));
    });
    document.querySelectorAll("#agStatus .ychip").forEach(ch => ch.classList.toggle("on", ch.dataset.s === agSettings.status));
    // 現役・卒業の選択はメンバー素材にのみ効くので、楽曲モードでは隠す
    document.getElementById("agStatusWrap").style.display = selMode === "song" ? "none" : "";
    const pool = agPoolCount(selMode);
    const n = Math.min(AG_TOTAL, pool);
    document.getElementById("agHowN").textContent = String(n);
    document.getElementById("agPoolNote").textContent = pool === 0
      ? "選んだ条件では出題できる対象が0件です。条件を変えてください。"
      : `対象は${pool}件です。全${n}問が出題されます。`;
    document.getElementById("agStart").disabled = pool === 0;
    const b = quizBest(agBestKey());
    document.getElementById("agBestLine").textContent = b > 0 ? `自己ベスト：${b}点` : "";
  };
  document.querySelectorAll("#agModes .ychip").forEach(ch => ch.addEventListener("click", () => { selMode = ch.dataset.m; paint(); }));
  document.querySelectorAll("#agCounts .ychip").forEach(ch => ch.addEventListener("click", () => {
    agSettings.count = +ch.dataset.c;
    agSaveSettings();
    paint();
  }));
  document.querySelectorAll("#agGroups .ychip").forEach(ch => ch.addEventListener("click", () => {
    const g = ch.dataset.g;
    if (g === "") agSettings.groups = [];
    else if (agSettings.groups.includes(g)) agSettings.groups = agSettings.groups.filter(x => x !== g);
    else agSettings.groups = [...agSettings.groups, g];
    agSaveSettings();
    paint();
  }));
  document.querySelectorAll("#agStatus .ychip").forEach(ch => ch.addEventListener("click", () => {
    agSettings.status = ch.dataset.s;
    agSaveSettings();
    paint();
  }));
  paint();
  document.getElementById("agStart").addEventListener("click", startGame);
}

async function init() {
  const d = await loadJSON("anagram.json");
  if (!d || !Array.isArray(d.members) || !Array.isArray(d.songs)) {
    document.getElementById("agMain").innerHTML = `<p style="color:var(--muted)">データを読み込めませんでした。</p>`;
    return;
  }
  AG = { members: d.members, songs: d.songs, combos: Array.isArray(d.combos) ? d.combos : [] };
  // 卒業生かどうかは members.json（名前は一意で、グループも最終所属で一致）を突き合わせて付ける。
  // data/anagram.json は再生成せず、検証済みシャッフルには一切触れない
  const memberMaster = await loadJSON("members.json");
  const gradByName = new Map((Array.isArray(memberMaster) ? memberMaster : []).map(m => [m.name, !!m.graduated]));
  AG_GRAD = gradByName;
  AG.members.forEach(e => { e.graduated = gradByName.get(e.name) || false; });
  AG_GROUPS = AG_GROUP_ORDER.filter(g => AG.members.some(e => e.group === g) || AG.songs.some(e => e.group === g));
  agLoadSettings();
  AG.members.forEach(e => { if (!AG_DICT.has(e.kata)) AG_DICT.set(e.kata, []); AG_DICT.get(e.kata).push({ kind: "member", label: e.name }); });
  AG.songs.forEach(e => { if (!AG_DICT.has(e.kata)) AG_DICT.set(e.kata, []); AG_DICT.get(e.kata).push({ kind: "song", label: e.title }); });
  AG_KATAS = [...AG_DICT.keys()];
  startPanel();
}
init();
