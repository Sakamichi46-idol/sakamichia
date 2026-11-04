// アナグラム：カタカナのタイルを並べ替えてメンバー名・楽曲タイトルを当てるクイズ
// 出題とシャッフルは data/anagram.json の検証済みデータを使う。シャッフルは
// ビルド時（tools/build_anagram.py）に「IPADIC の語彙だけで全分割できる」ことを
// 検証した並びだけが収録されている（ランダムな順列は出題しない）。
const AG_TOTAL = 10;
const AG_HINT_COST = 20;
const AG_MODES = [
  { id: "member", label: "メンバー名" },
  { id: "song", label: "楽曲タイトル" },
  { id: "mix", label: "ミックス" },
];
let AG = { members: [], songs: [] };
let AG_DICT = new Map(); // 読み（カタカナ）-> [{kind, label}]（別解判定用）
let selMode = "member";
let questions = [], qIdx = 0, score = 0, results = [];
let cur = null; // {entry, kind, kata, label, tiles:Map(id->ch), slots:[id|null], pool:[id], locked:Set(slotIdx), hints, judged, built}

function agShuffle(a, rng) { const r = rng || Math.random; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function agLabel(e, kind) { return kind === "member" ? e.name : e.title; }
function agClue(e, kind) { return kind === "member" ? `所属：${e.group}` : `${e.group} ・ ${e.year}年発売`; }

// 1問分の出題を作る（テストから検証できるよう公開する）
// entry.shuffles から rng で1つ選ぶ。戻り値 {kata, text, parts}
function buildAnagramQuestion(entry, rng) {
  const r = rng || Math.random;
  const s = entry.shuffles[Math.floor(r() * entry.shuffles.length)];
  return { kata: entry.kata, text: s.t, parts: [...s.w] };
}
window.buildAnagramQuestion = buildAnagramQuestion;

// 並べた文字列の判定：対象そのものなら正解、別の実在素材の読みと完全一致すれば別解で正解
function anagramJudge(kata, built) {
  if (built === kata) return { ok: true, alt: null };
  const alts = AG_DICT.get(built);
  if (alts && alts.length) return { ok: true, alt: alts[0] };
  return { ok: false, alt: null };
}
window.anagramJudge = anagramJudge;

function agPools() {
  return {
    member: AG.members.length, song: AG.songs.length,
    dict: AG_DICT.size,
  };
}
window.__agPools = agPools;

function __agState() {
  return {
    mode: selMode, idx: qIdx, score,
    questions: questions.map(q => ({ kata: q.kata, kind: q.kind, text: q.text })),
    built: cur ? cur.slots.map(id => (id == null ? "" : cur.tiles.get(id))).join("") : "",
    judged: !!(cur && cur.judged), hints: cur ? cur.hints : 0,
    results: results.map(r => ({ ...r })),
  };
}
window.__agState = __agState;

function pickQuestions(mode) {
  let src = [];
  if (mode === "member" || mode === "mix") src = src.concat(AG.members.map(e => ({ e, kind: "member" })));
  if (mode === "song" || mode === "mix") src = src.concat(AG.songs.map(e => ({ e, kind: "song" })));
  agShuffle(src);
  const seen = new Set(), out = [];
  for (const it of src) {
    if (seen.has(it.e.kata)) continue; // 同じ読みは1ゲームに1問まで
    seen.add(it.e.kata);
    const q = buildAnagramQuestion(it.e);
    out.push({ entry: it.e, kind: it.kind, kata: it.e.kata, text: q.text, parts: q.parts });
    if (out.length >= AG_TOTAL) break;
  }
  return out;
}

function startQuestion() {
  const q = questions[qIdx];
  const tiles = new Map();
  const pool = [];
  q.text.split("").forEach((ch, i) => { const id = "t" + i; tiles.set(id, ch); pool.push(id); });
  cur = {
    q, kata: q.kata, tiles, pool,
    slots: new Array(q.kata.length).fill(null),
    locked: new Set(), hints: 0, judged: false, built: "",
  };
  renderQuestion("");
}

function slotStr() { return cur.slots.map(id => (id == null ? "" : cur.tiles.get(id))).join(""); }

function renderQuestion(msg) {
  const main = document.getElementById("agMain");
  const q = cur.q;
  const full = cur.pool.length === 0;
  main.innerHTML = `<div class="ag-head"><span>第${qIdx + 1}問／${AG_TOTAL}問</span><span>スコア ${score}点</span></div>
  <p class="ag-clue">${q.kind === "member" ? "メンバー名" : "楽曲タイトル"}（${q.kata.length}文字）・ ${esc(agClue(q.entry, q.kind))}</p>
  <p class="ag-rowlabel">解答欄（タップで戻す）</p>
  <div class="ag-answer" id="agAnswer">${cur.slots.map((id, i) => id == null
    ? `<span class="ag-tile ag-slot" data-slot="${i}"></span>`
    : `<button type="button" class="ag-tile placed${cur.locked.has(i) ? " locked" : ""}" data-slot="${i}" ${cur.locked.has(i) || cur.judged ? "disabled" : ""}>${esc(cur.tiles.get(id))}</button>`).join("")}</div>
  <p class="ag-rowlabel">タイル（タップで解答欄へ）</p>
  <div class="ag-pool" id="agPool">${cur.pool.map(id => `<button type="button" class="ag-tile" data-tile="${id}" ${cur.judged ? "disabled" : ""}>${esc(cur.tiles.get(id))}</button>`).join("")}</div>
  <div class="ag-btns">
    <button type="button" class="btn sub" id="agHint" ${cur.judged ? "disabled" : ""}>ヒント（−${AG_HINT_COST}点）</button>
    <button type="button" class="btn sub" id="agReset" ${cur.judged ? "disabled" : ""}>リセット</button>
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

function unplaceTile(slot) {
  if (!cur || cur.judged || cur.locked.has(slot)) return;
  const id = cur.slots[slot];
  if (id == null) return;
  cur.slots[slot] = null;
  cur.pool.push(id);
  renderQuestion("");
}

function resetTiles() {
  if (!cur || cur.judged) return;
  cur.slots.forEach((id, i) => {
    if (id != null && !cur.locked.has(i)) { cur.pool.push(id); cur.slots[i] = null; }
  });
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
  // スロット i にあるタイル（不正解のもの）はプールへ戻す
  if (cur.slots[i] != null) { cur.pool.push(cur.slots[i]); cur.slots[i] = null; }
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
  renderQuestion(`ヒント：${i + 1}文字目を確定しました（この問題は最大 ${Math.max(10, 100 - AG_HINT_COST * cur.hints)} 点）`);
}

function judge() {
  if (!cur || cur.judged || cur.pool.length > 0) return;
  const built = slotStr();
  cur.built = built;
  const label = agLabel(cur.q.entry, cur.q.kind);
  const res = anagramJudge(cur.kata, built);
  const pts = res.ok ? Math.max(10, 100 - AG_HINT_COST * cur.hints) : 0;
  cur.judged = true;
  score += pts;
  results.push({ mine: built, label, kata: cur.kata, ok: res.ok, pts, alt: res.alt ? res.alt.label : null });
  renderQuestion("");
  const v = document.getElementById("agVerdict");
  const last = qIdx >= AG_TOTAL - 1;
  let html;
  if (res.ok) {
    html = `<p class="ok">⭕ 正解！ ${pts}点</p>
    <p>${esc(label)}（${esc(cur.kata)}）${res.alt ? `<br>※並べた「${esc(built)}」は ${esc(res.alt.label)} の読みとしても成立するので正解です` : ""}</p>`;
  } else {
    html = `<p class="ng">❌ 不正解</p><p>正解は ${esc(label)}（${esc(cur.kata)}）でした</p>`;
  }
  html += `<p><button type="button" class="primary" id="agNext">${last ? "結果を見る" : "次の問題へ"}</button></p>`;
  v.innerHTML = html;
  document.getElementById("agNext").addEventListener("click", () => { if (last) finish(); else { qIdx++; startQuestion(); } });
}

function finish() {
  const total = score;
  const isNew = quizBestSave("anagram", total);
  const best = quizBest("anagram");
  const main = document.getElementById("agMain");
  main.innerHTML = `<div class="card"><h3>結果：${total}点 ／ ${AG_TOTAL * 100}点</h3>
  ${best ? `<p style="color:var(--muted)">${isNew ? "🎉 自己ベスト更新！" : `自己ベスト：${best}点`}</p>` : ""}
  <div class="ag-lines">${results.map((r, i) => `<p style="margin:4px 0">${i + 1}問目 ${esc(r.mine)}：${r.ok ? r.pts + "点" : `不正解（正解は${esc(r.label)}）`}</p>`).join("")}</div>
  <p><button type="button" class="btn" id="agRetry">もう一度遊ぶ</button> <button type="button" class="btn" id="agSettings">条件を変える</button> <button type="button" class="btn sub" id="agShare">結果を共有する</button></p></div>`;
  document.getElementById("agRetry").addEventListener("click", startGame);
  document.getElementById("agSettings").addEventListener("click", startPanel);
  document.getElementById("agShare").addEventListener("click", e => shareScoreImage({
    game: "アナグラム", score: `${total}点／${AG_TOTAL * 100}点`,
    lines: results.map((r, i) => `${i + 1}問目 ${r.mine}：${r.ok ? r.pts + "点" : "不正解（正解は" + r.label + "）"}`),
  }, e.target));
}

function startGame() {
  questions = pickQuestions(selMode);
  if (questions.length < AG_TOTAL) { document.getElementById("agMain").innerHTML = `<p style="color:var(--muted)">出題データが足りません。</p>`; return; }
  qIdx = 0; score = 0; results = [];
  startQuestion();
}

function startPanel() {
  const main = document.getElementById("agMain");
  const lite = document.documentElement.dataset.lite === "1";
  main.innerHTML = `<div class="card"><h3>遊び方</h3>
  <p style="color:var(--muted)">${lite
    ? `カタカナのタイルを並べ替えて、メンバー名か曲名を当てるクイズです。全${AG_TOTAL}問、1問100点。ヒントは1回−${AG_HINT_COST}点です。`
    : `並んでいるカタカナのタイルは、あるメンバー名（または楽曲タイトル）の読みをバラバラにしたものです。タイルをタップして解答欄に並べ、正しい読みを作ってください。解答欄のタイルをタップすると戻せます。出てくる並びは、実在する日本語の単語に分けられる並びだけです。全${AG_TOTAL}問・1問100点。ヒントを使うと、その文字が正しい位置に固定される代わりに1回−${AG_HINT_COST}点（最低10点）になります。並べた結果が別のメンバー名・曲名の読みと一致した場合も正解になります。`}</p>
  <p style="margin:10px 0 6px"><b>出題モード</b></p>
  <div class="ychips" id="agModes">${AG_MODES.map(m => `<button type="button" class="ychip" data-m="${m.id}">${m.label}</button>`).join("")}</div>
  <p style="color:var(--muted)" id="agBestLine"></p>
  <p><button type="button" class="primary" id="agStart">スタート</button></p></div>`;
  const paint = () => {
    document.querySelectorAll("#agModes .ychip").forEach(ch => ch.classList.toggle("on", ch.dataset.m === selMode));
    const b = quizBest("anagram");
    document.getElementById("agBestLine").textContent = b > 0 ? `自己ベスト：${b}点` : "";
  };
  document.querySelectorAll("#agModes .ychip").forEach(ch => ch.addEventListener("click", () => { selMode = ch.dataset.m; paint(); }));
  paint();
  document.getElementById("agStart").addEventListener("click", startGame);
}

async function init() {
  const d = await loadJSON("anagram.json");
  if (!d || !Array.isArray(d.members) || !Array.isArray(d.songs)) {
    document.getElementById("agMain").innerHTML = `<p style="color:var(--muted)">データを読み込めませんでした。</p>`;
    return;
  }
  AG = { members: d.members, songs: d.songs };
  AG.members.forEach(e => { if (!AG_DICT.has(e.kata)) AG_DICT.set(e.kata, []); AG_DICT.get(e.kata).push({ kind: "member", label: e.name }); });
  AG.songs.forEach(e => { if (!AG_DICT.has(e.kata)) AG_DICT.set(e.kata, []); AG_DICT.get(e.kata).push({ kind: "song", label: e.title }); });
  startPanel();
}
init();
