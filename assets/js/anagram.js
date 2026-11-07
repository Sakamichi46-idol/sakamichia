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
function agCondText() {
  const parts = ["モード：" + ((AG_MODES.find(m => m.id === selMode) || {}).label || "")];
  const n = (typeof questions !== "undefined" && questions[0]) ? questions[0].items.length : agSettings.count;
  if (n >= 2) parts.push(n + (selMode === "member" ? "人分" : selMode === "song" ? "曲分" : "個分"));
  parts.push(agSettings.groups.length ? agSettings.groups.join("・") + "のみ" : "全グループ");
  if (selMode !== "song") {
    parts.push(agSettings.status === "active" ? "卒業生なし" : "卒業生あり");
  }
  return parts.join("・");
}

let AG = { members: [], songs: [], combos: [] };
let AG_DICT = new Map(); // 読み（カタカナ）-> [{kind, label}]（別解判定用）
let AG_KATAS = []; // 全素材の読み一覧（組み合わせ判定の分割用）
let AG_GRAD = new Map(); // メンバー名 -> 卒業生かどうか（members.json 由来）
let selMode = "member";
let gameTotal = AG_TOTAL; // そのゲームの出題数（プールが1件以上なら常に10問。不足分は同じ対象を繰り返し出題する）
// 絞り込み設定：グループは複数選択（空 = すべて、OR条件）。status はメンバー素材にのみ効く
// （"all" = 卒業生あり / "active" = 卒業生なし（現役のみ）、既定は "all"。
// 卒業生のみの選択肢は2026-11-07に廃止。旧設定の "grad" は "all" として読み替える）。
// count は1問に混ぜる素材の個数（1 = 通常 / 2 / 3、既定は 1）
const AG_GROUP_ORDER = ["乃木坂46", "櫻坂46", "日向坂46", "欅坂46", "けやき坂46"];
let AG_GROUPS = []; // プールに実在するグループ（表示順に整列済み）
let agSettings = { groups: [], status: "all", count: 1 };
function agLoadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("sakamichia-anagram-settings") || "null");
    if (s) agSettings = {
      groups: Array.isArray(s.groups) ? s.groups.filter(g => AG_GROUPS.includes(g)) : [],
      status: s.status === "active" ? "active" : "all",
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
  if (kind === "member" && agSettings.status === "active") {
    const grad = e.graduated !== undefined ? e.graduated : (AG_GRAD.get(e.name) || false);
    if (grad) return false;
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
let cur = null; // {q, kata, base, tiles:Map(id->ch), rows:[[id]...](素材ごとの行), pool:[id], initialPool:[id], locked:Set(tileId), hints, judged, built, clueStages, clueUsed, activeRow}

function agShuffle(a, rng) { const r = rng || Math.random; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function agLabel(e, kind) { return kind === "member" ? e.name : e.title; }
function agClue(e, kind) { return kind === "member" ? `所属：${e.group}` : `${e.group} ・ ${e.year}年発売`; }

// 単体素材1つ分の出題素材（統一形）。birth はメンバーの生まれ年（手がかり用、member-meta 由来）
function agSingleItem(e, kind) {
  return { kind, label: agLabel(e, kind), group: e.group, year: kind === "song" ? e.year : null, kata: e.kata, birth: kind === "member" ? (e.birthYear || null) : null };
}
// 質問の見出し（手がかり）。最初は種別と個数だけを出し、内訳（素材ごとの文字数・グループ・年）は
// 独立した段階ヒントとして1段階ずつ表示する（2026-11-04ユーザー指定）：
//   第1段階＝グループ（グループを1つだけ選んで解く設定のときは無し。既に分かっているため）
//   第2段階＝それぞれの文字数（複数個のときだけ。単体はマス数で分かるため）
//   第3段階＝楽曲はリリース年（メンバーだけの問題では無し）
//   単体では文字数の代わりに、楽曲＝リリース年／メンバー＝生まれ年 が段階になる（2026-11-07）
// 1段階ごとに −20点で、文字を置くヒント（hints）とは別の勘定（clueUsed）にする
const AG_CLUE_STAGE_DEFS = [
  { key: "group", name: "グループ" },
  { key: "length", name: "文字数" },
  { key: "year", name: "リリース年" },
  { key: "birth", name: "生まれ年" }
];
// この問題で使える手がかりの段階（key の配列、出す順）
// 単体（個数1）では文字数は解答欄のマス数で分かってしまうため文字数の段階は出さない。
// 代わりに、楽曲ならリリース年、メンバーなら生まれ年を手がかりにする（2026-11-07ユーザー提案）
function agClueStagesFor(q, singleGroup) {
  const keys = [];
  if (!singleGroup) keys.push("group");
  if (q.items.length > 1) {
    keys.push("length");
    if (q.items.some(it => it.kind === "song")) keys.push("year");
  } else if (q.items[0].kind === "song") {
    keys.push("year");
  } else if (q.items[0].birth) {
    keys.push("birth");
  }
  return keys;
}
// 素材1つ分の内訳文字列（組み合わせ用）。show = {g, l, y} の表示状態で組を組み立てる
function agItemPart(it, show, allM, allS) {
  let s;
  if (!allM && !allS) {
    // ミックスは種別を付けた組にする
    s = (show.l ? `${it.kata.length}文字・` : "") + (it.kind === "member" ? "メンバー" : "楽曲") + (show.g ? ` ${it.group}` : "");
  } else {
    s = [show.l ? `${it.kata.length}文字` : "", show.g ? it.group : ""].filter(Boolean).join("・");
    if (!s) s = it.kind === "member" ? "メンバー" : "楽曲";
  }
  if (it.kind === "song" && show.y) s += `（${it.year}年）`;
  return s;
}
// 表示状態 show での手がかり全文
function agClueText(q, show) {
  if (q.items.length === 1) {
    const it = q.items[0];
    let s = it.kind === "member" ? "メンバー名" : "楽曲タイトル";
    if (it.kind === "member") {
      if (show.l) s += `（${it.kata.length}文字）`;
      if (show.g) s += show.l ? `・ 所属：${it.group}` : ` ・ 所属：${it.group}`;
      if (show.b && it.birth) s += ` ・ ${it.birth}年生まれ`;
    } else {
      if (show.l) s += `（${it.kata.length}文字）`;
      if (show.g) s += show.l ? `・ ${it.group}` : ` ・ ${it.group}`;
      if (show.y) s += ` ・ ${it.year}年発売`;
    }
    return s;
  }
  const allM = q.items.every(it => it.kind === "member");
  const allS = q.items.every(it => it.kind === "song");
  const head = allM ? `メンバー名 ${q.items.length}人分` : allS ? `楽曲タイトル ${q.items.length}曲分` : `ミックス ${q.items.length}個分`;
  if (!show.g && !show.l && !show.y) return head;
  return `${head}：${q.items.map(it => agItemPart(it, show, allM, allS)).join("／")}`;
}
function agQuestionClue(q) { return agClueText(q, { g: true, l: true, y: true, b: true }); }
window.agQuestionClue = agQuestionClue;
window.agClueStagesFor = agClueStagesFor;
window.agClueText = agClueText;

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
  // 文字を置くヒント（hints）と手がかりの段階（clueUsed）は別の勘定だが、どちらも1回 −20点
  return Math.max(10, cur.base - AG_HINT_COST * (cur.hints + cur.clueUsed));
}
// 現在の手がかり表示状態（開いた段階までの要素を表示する）
function agClueShow() {
  const open = new Set(cur.clueStages.slice(0, cur.clueUsed));
  return { g: open.has("group"), l: open.has("length"), y: open.has("year"), b: open.has("birth") };
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
      status: status === "active" ? "active" : "all",
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
    built: cur ? slotStr() : "",
    judged: !!(cur && cur.judged), hints: cur ? cur.hints : 0,
    clueUsed: cur ? cur.clueUsed : 0, clueStages: cur ? [...cur.clueStages] : [],
    activeRow: cur ? cur.activeRow : 0, rowMode: rowsFixed(),
    rows: cur ? cur.rows.map(r => r.length) : [],
    maxPts: cur ? agCurMax() : 0,
    results: results.map(r => ({ ...r })),
  };
}
window.__agState = __agState;

function pickQuestions(mode) {
  if (agSettings.count === 1) {
    // 同じ読みは1ゲームに1問まで（素材を読みで一意化してから、出題済みを避けて引く）
    const byKata = new Map();
    for (const it of agShuffle(agFilteredSources(mode))) if (!byKata.has(it.e.kata)) byKata.set(it.e.kata, it);
    const picks = quizPick("anagram", [...byKata.values()], Math.min(AG_TOTAL, byKata.size), it => "1:" + it.e.kata);
    // プールが10件未満でも10問出す（2026-11-07ユーザー要望：グループ縛りでも10問）。
    // 不足分はプールをシャッフルし直しながら繰り返し引く（同じ素材が連続しないようにする）
    const uniq = [...byKata.values()];
    while (picks.length < AG_TOTAL && uniq.length) {
      for (const it of agShuffle([...uniq])) {
        if (picks.length >= AG_TOTAL) break;
        if (uniq.length > 1 && picks[picks.length - 1] === it) continue;
        picks.push(it);
      }
    }
    return picks.map(it => {
      const q = buildAnagramQuestion(it.e);
      return { items: [agSingleItem(it.e, it.kind)], kind: it.kind, kata: it.e.kata, text: q.text, parts: q.parts };
    });
  }
  const count = agSettings.count;
  const combos = agFilteredCombos(mode, count);
  // 出題済みの組み合わせを避ける：未出題の組み合わせを先に並べ、
  // 出題済みしか残らない場合は最も昔に出たものから並べる
  const cKey = c => count + ":" + c.items.map(it => it.kata).sort().join("+");
  const seenArr = quizSeenGet("anagram"), seenSet = new Set(seenArr);
  const ordered = [...agShuffle(combos.filter(c => !seenSet.has(cKey(c)))),
    ...combos.filter(c => seenSet.has(cKey(c))).sort((a, b) => seenArr.indexOf(cKey(a)) - seenArr.indexOf(cKey(b)))];
  const usedKatas = new Set(), picked = [], rest = [];
  for (const c of ordered) {
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
  // それでも10問に届かない（プール自体が10件未満）場合は、組み合わせを繰り返し使って10問出す。
  // 繰り返しのたびにシャッフルは選び直されるので、並びは毎回変わりうる
  while (picked.length < AG_TOTAL && combos.length) {
    for (const c of agShuffle([...combos])) {
      if (picked.length >= AG_TOTAL) break;
      if (combos.length > 1 && picked[picked.length - 1] === c) continue;
      picked.push(c);
    }
  }
  quizSeenTouch("anagram", picked.map(cKey));
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
    rows: q.items.map(() => []),
    locked: new Set(), hints: 0, judged: false, built: "",
    clueStages: agClueStagesFor(q, agSettings.groups.length === 1), clueUsed: 0, activeRow: 0,
  };
  renderQuestion("");
}

function slotStr() { return cur.rows.flat().map(id => cur.tiles.get(id)).join(""); }

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
  const show = agClueShow();
  const multi = q.items.length > 1;
  // 行のマス数が分かる状態か：単体は最初から（従来どおり全マス表示）、複数個は
  // 「文字数」の段階を開いてから。それまでは各行に何文字でも入れられ、マス数は不明
  const fixed = !multi || show.l;
  // 解答欄に動かせるタイル（ヒント固定以外）があるか。「1文字消す」の有効判定に使う。
  // 複数個では選択中の行だけを見る
  const actRow = multi ? cur.activeRow : 0;
  const hasRemovable = cur.rows[actRow].some(id => !cur.locked.has(id));
  // タイルサイズは合計文字数基準で決める：合計が10文字以下なら1行に収まる大きさ、
  // それより長い場合は1行に10個が収まる大きさにして均等に折り返す。解答欄と
  // タイル置き場で同じサイズを使う。マス数が分かった後は最長の行が1行に収まる大きさ
  const tw = fixed && multi
    ? agTileSize(Math.min(10, Math.max(...q.items.map(it => it.kata.length))), window.innerWidth)
    : agTileSize(Math.min(10, q.kata.length), window.innerWidth);
  const tileBtn = (id, r, p, flat) => {
    const cls = ["ag-tile", "placed"];
    if (cur.locked.has(id)) cls.push("locked");
    // ヒントで固定されたタイルは押せない
    const dis = cur.judged || cur.locked.has(id);
    return `<button type="button" class="${cls.join(" ")}" data-row="${r}" data-pos="${p}" data-slot="${flat}" ${dis ? "disabled" : ""}>${esc(cur.tiles.get(id))}</button>`;
  };
  let answerHtml;
  if (!multi) {
    const pad = Array.from({ length: q.kata.length - cur.rows[0].length }, (_, k) => `<span class="ag-tile ag-slot" data-slot="${cur.rows[0].length + k}"></span>`).join("");
    answerHtml = `<div class="ag-answer" id="agAnswer" style="--agtw:${tw}px">${cur.rows[0].map((id, p) => tileBtn(id, 0, p, p)).join("")}${pad}</div>`;
  } else {
    let flatBase = 0;
    answerHtml = `<div class="ag-rows" id="agAnswer" style="--agtw:${tw}px">${cur.rows.map((rowIds, r) => {
      let cells = rowIds.map((id, p) => tileBtn(id, r, p, flatBase + p)).join("");
      flatBase += rowIds.length;
      if (fixed) { for (let k = rowIds.length; k < q.items[r].kata.length; k++) cells += `<span class="ag-tile ag-slot" data-slot="${flatBase + k - rowIds.length}"></span>`; }
      else if (!cur.judged && cur.pool.length > 0) cells += `<span class="ag-tile ag-slot"></span>`;
      return `<div class="ag-row${r === cur.activeRow && !cur.judged ? " on" : ""}" data-row="${r}"><span class="ag-rownum">${r + 1}</span>${cells}</div>`;
    }).join("")}</div>`;
  }
  const stageDef = cur.clueUsed < cur.clueStages.length ? AG_CLUE_STAGE_DEFS.find(d => d.key === cur.clueStages[cur.clueUsed]) : null;
  main.innerHTML = `<div class="ag-head"><span>第${qIdx + 1}問／${gameTotal}問</span><span>スコア ${score}点</span></div>
  <p class="ag-clue">${esc(agClueText(q, show))}</p>
  ${stageDef && !cur.judged ? `<p style="margin:2px 0 10px"><button type="button" class="btn sub" id="agClueBtn">手がかり${cur.clueUsed + 1}：${stageDef.name}を見る（−${AG_HINT_COST}点）</button></p>` : ""}
  <p class="ag-rowlabel">${multi ? "解答欄（行をタップで選択・タイルは選択中の行へ）" : "解答欄（タップで戻す）"}</p>
  ${answerHtml}
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
  main.querySelectorAll("#agAnswer .ag-tile.placed").forEach(el => el.addEventListener("click", () => unplaceTile(+el.dataset.row, +el.dataset.pos)));
  main.querySelectorAll("#agAnswer .ag-row").forEach(el => el.addEventListener("click", () => selectRow(+el.dataset.row)));
  const clueBtn = document.getElementById("agClueBtn");
  if (clueBtn) clueBtn.addEventListener("click", openClue);
  const hintBtn = document.getElementById("agHint");
  if (hintBtn) hintBtn.addEventListener("click", useHint);
  const resetBtn = document.getElementById("agReset");
  if (resetBtn) resetBtn.addEventListener("click", resetTiles);
  const eraseBtn = document.getElementById("agErase");
  if (eraseBtn) eraseBtn.addEventListener("click", eraseOne);
  const checkBtn = document.getElementById("agCheck");
  if (checkBtn) checkBtn.addEventListener("click", judge);
}

// 行のマス数が分かる状態か（複数個で「文字数」の段階を表示済み。単体は常時）
function rowsFixed() {
  return !!cur && (cur.q.items.length <= 1 || agClueShow().l);
}
function selectRow(r) {
  if (!cur || cur.judged) return;
  cur.activeRow = r;
  renderQuestion("");
}
// マス数が分かる状態でアクティブな行が満杯になったら、空きのある次の行へ自動で移る
function advanceActiveRow() {
  if (!cur || cur.q.items.length <= 1 || !rowsFixed()) return;
  const n = cur.q.items.length;
  for (let step = 0; step < n; step++) {
    const r = (cur.activeRow + step) % n;
    if (cur.rows[r].length < cur.q.items[r].kata.length) { cur.activeRow = r; return; }
  }
}

function placeTile(id) {
  if (!cur || cur.judged) return;
  const r = cur.q.items.length > 1 ? cur.activeRow : 0;
  // マス数が分かる状態では、その行のマス数までしか入れられない
  if (rowsFixed() && cur.rows[r].length >= cur.q.items[r].kata.length) {
    renderQuestion(`${r + 1}行目は満杯です。別の行をタップしてください`);
    return;
  }
  cur.pool = cur.pool.filter(x => x !== id);
  cur.rows[r].push(id);
  advanceActiveRow();
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

function unplaceTile(r, p) {
  if (!cur || cur.judged) return;
  const id = cur.rows[r] && cur.rows[r][p];
  if (id == null || cur.locked.has(id)) return;
  cur.rows[r].splice(p, 1);
  agPoolReturn(id);
  // 複数個では、戻したタイルの行を選択中にする（その行を直している最中のはずなので）
  if (cur.q.items.length > 1) cur.activeRow = r;
  renderQuestion("");
}

// 1文字消す：末尾側にある動かせるタイルを1つだけプールに戻す。
// ヒントで固定されたタイルは飛ばす。複数個では選択中の行だけが対象
function eraseOne() {
  if (!cur || cur.judged) return;
  const r = cur.q.items.length > 1 ? cur.activeRow : 0;
  for (let p = cur.rows[r].length - 1; p >= 0; p--) {
    if (!cur.locked.has(cur.rows[r][p])) { unplaceTile(r, p); return; }
  }
}

function resetTiles() {
  if (!cur || cur.judged) return;
  // 出題直後の最初の状態に完全に戻す：全タイルを初期順序でプールに戻し、
  // ヒントで固定されたタイルも含めて解答欄を空にする。ただしヒント・手がかりの
  // 減点（hints・clueUsed）と開いた手がかりは戻さない（リセットで上限点が
  // 回復したり、手がかりを二重に課金したりしないように）
  cur.pool = [...cur.initialPool];
  cur.rows = cur.q.items.map(() => []);
  cur.locked.clear();
  cur.activeRow = 0;
  renderQuestion("");
}

// 手がかりは、文字を置くヒントとは独立した段階ヒント：1段階ごとに −20点（clueUsed で勘定）。
// 一度開いた段階はリセットしても開いたままにし、二重に課金しない
function openClue() {
  if (!cur || cur.judged || cur.clueUsed >= cur.clueStages.length) return;
  const def = AG_CLUE_STAGE_DEFS.find(d => d.key === cur.clueStages[cur.clueUsed]);
  cur.clueUsed++;
  renderQuestion(`手がかり（${def.name}）を表示しました（この問題は最大 ${agCurMax()} 点）`);
}

// 行をまたいだフラット位置（全行を連結したときの位置）⇔ 行・行内位置の変換。
// 文字を置くヒントは、行の割り当てに関係なく連結全体の位置で考える
function flatPosToRow(i, insert) {
  let acc = 0;
  for (let r = 0; r < cur.rows.length; r++) {
    const len = cur.rows[r].length;
    // 挿入は行の境界では手前の行の末尾として扱う（空の行にも先頭へ入れられる）。
    // 除去は実在するタイルの位置なので、厳密にその行の範囲内で探す
    if (insert ? i <= acc + len : i < acc + len) return [r, i - acc];
    acc += len;
  }
  return [cur.rows.length - 1, cur.rows[cur.rows.length - 1].length];
}
function removeFlat(i) {
  const [r, p] = flatPosToRow(i, false);
  const id = cur.rows[r][p];
  cur.rows[r].splice(p, 1);
  agPoolReturn(id);
  return id;
}
function insertFlat(i, id) {
  const [r, p] = flatPosToRow(i, true);
  cur.rows[r].splice(p, 0, id);
}

function useHint() {
  if (!cur || cur.judged) return;
  const multi = cur.q.items.length > 1;
  const r = multi ? cur.activeRow : 0;
  const items = cur.q.items;
  const rowStr = rr => cur.rows[rr].map(id => cur.tiles.get(id)).join("");
  // すでに完成している行は、その素材を「占有」したものとして扱う（判定が並び順フリーなのに合わせる）
  if (multi && items.some(it => it.kata === rowStr(r))) {
    renderQuestion(`${r + 1}行目は完成しています。別の行を選んでください`);
    return;
  }
  const claimed = new Set();
  if (multi) {
    cur.rows.forEach((_, r2) => {
      if (r2 === r) return;
      const idx = items.findIndex((it, ii) => it.kata === rowStr(r2) && !claimed.has(ii));
      if (idx >= 0) claimed.add(idx);
    });
  }
  // この行の目標：占有されていない素材のうち、今置いてあるタイルと矛盾しないもの。
  // 行に割り当てられた素材が候補に残っていればそれを優先し、無ければ候補の先頭を使う
  const rowTilesStr = cur.rows[r].map(id => cur.tiles.get(id));
  const consistent = ii => rowTilesStr.every((ch, p) => items[ii].kata[p] === ch);
  const free = items.map((_, ii) => ii).filter(ii => !claimed.has(ii));
  let targetIdx = free.includes(r) && consistent(r) ? r
    : (free.find(ii => consistent(ii)) ?? (free.includes(r) ? r : free[0]));
  if (targetIdx == null) targetIdx = r;
  const targetRow = items[targetIdx].kata;
  const row = cur.rows[r];
  // 選択中の行の中で、目標に対してまだ正しくない最初の位置を探す
  let p = 0;
  while (p < targetRow.length) {
    const id = row[p];
    if (id != null && cur.tiles.get(id) === targetRow[p]) { p++; continue; }
    break;
  }
  if (p >= targetRow.length) {
    renderQuestion(multi ? `${r + 1}行目は完成しています。別の行を選んでください` : "すでに正しい並びです");
    return;
  }
  const need = targetRow[p];
  // 位置 p にあるタイル（不正解のもの）はプールへ戻す
  if (row[p] != null) { const out = row[p]; row.splice(p, 1); agPoolReturn(out); }
  // 必要な文字をプールから探す。無ければ「間違った位置」にあるタイルから持ってくる
  let srcId = cur.pool.find(id => cur.tiles.get(id) === need);
  if (srcId == null) {
    outer:
    for (let r2 = 0; r2 < cur.rows.length; r2++) {
      for (let q = 0; q < cur.rows[r2].length; q++) {
        const id = cur.rows[r2][q];
        if (id == null || cur.locked.has(id)) continue;
        if (cur.tiles.get(id) !== need) continue;
        if (cur.tiles.get(id) === cur.q.items[r2].kata[q]) continue; // その位置で正しいものは動かさない
        cur.rows[r2].splice(q, 1); agPoolReturn(id);
        srcId = id;
        break outer;
      }
    }
  }
  if (srcId == null) return; // 理論上は到達しない
  cur.pool = cur.pool.filter(x => x !== srcId);
  row.splice(p, 0, srcId);
  cur.locked.add(srcId);
  cur.hints++;
  renderQuestion(multi
    ? `ヒント：${r + 1}行目の${p + 1}文字目を確定しました（この問題は最大 ${agCurMax()} 点）`
    : `ヒント：${p + 1}文字目を確定しました（この問題は最大 ${agCurMax()} 点）`);
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
    html = `<p class="ok">正解！ ${pts}点</p>
    <p>${esc(ownLabels)}${res.altLabel ? `<br>※並べた「${esc(built)}」は ${esc(res.altLabel)} の読みとしても成立するので正解です` : ""}</p>`;
  } else {
    html = `<p class="ng">不正解</p><p>正解は ${esc(ownLabels)} でした</p>`;
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
  ${best ? `<p style="color:var(--muted)">${isNew ? "自己ベスト更新！" : `自己ベスト：${best}点`}</p>` : ""}
  <div class="ag-lines">${results.map((r, i) => `<p style="margin:4px 0">${i + 1}問目 ${esc(r.mine)}：${r.ok ? r.pts + "点" : `不正解（正解は${esc(r.label)}）`}</p>`).join("")}</div>
  <p><button type="button" class="btn" id="agRetry">もう一度遊ぶ</button> <button type="button" class="btn" id="agSettings">条件を変える</button> <button type="button" class="btn sub" id="agShare">結果を共有する</button></p></div>`;
  document.getElementById("agRetry").addEventListener("click", startGame);
  document.getElementById("agSettings").addEventListener("click", startPanel);
  document.getElementById("agShare").addEventListener("click", e => shareScoreImage({
    game: "アナグラム", score: `${total}点／${maxTotal}点`, cond: agCondText(),
    lines: results.map((r, i) => `${i + 1}問目 ${r.mine}：${r.ok ? r.pts + "点" : "不正解（正解は" + r.label + "）"}`),
  }, e.target));
}

function startGame() {
  questions = pickQuestions(selMode);
  if (!questions.length) { document.getElementById("agMain").innerHTML = `<p style="color:var(--muted)">選んだ条件では出題できる対象がありません。条件を変えてください。</p>`; return; }
  gameTotal = questions.length; // プールが1件以上なら10問（不足分は繰り返し出題）
  qIdx = 0; score = 0; results = [];
  startQuestion();
}

function startPanel() {
  const main = document.getElementById("agMain");
  const lite = document.documentElement.dataset.lite === "1";
  const howHtml = lite
    ? `<p style="color:var(--muted)">カタカナのタイルを並べ替えて、メンバー名か曲名を当てるクイズです。全<span id="agHowN">${AG_TOTAL}</span>問。ヒントと手がかりは1回（1段階）−${AG_HINT_COST}点です。出題するグループや卒業生あり／なし、混ぜる個数は下で選べます。</p>`
    : `<p style="color:var(--muted)">カタカナのタイルは、メンバー名（または楽曲タイトル）の読みをバラバラにしたものです。タイルをタップして解答欄に並べ、正しい読みを作ってください。解答欄のタイルをタップすると戻せます。</p>
  <p style="color:var(--muted)"><b>点数</b>：全<span id="agHowN">${AG_TOTAL}</span>問・1問100点（混ぜる個数を増やすと1問200点・300点）</p>
  <p style="color:var(--muted)"><b>ヒント</b>：使うと、その文字が正しい位置に固定されます（1回−${AG_HINT_COST}点、最低10点まで）</p>
  <p style="color:var(--muted)"><b>手がかり</b>：最初は種別と個数だけが表示され、ボタンで段階的に開けます（1段階−${AG_HINT_COST}点で、ヒントとは別の勘定です）<br>・複数個の問題：グループ → 文字数 → リリース年の順<br>・1つだけの問題：文字数は解答欄のマスの数で分かるので、代わりに楽曲はリリース年、メンバーは生まれ年が出ます</p>
  <p style="color:var(--muted)"><b>複数個の問題</b>：解答欄が素材ごとの行に分かれます。行をタップして選んで入力できます（各行は文字数自由で、文字数の手がかりを表示すると各行のマスの数が分かります）</p>
  <p style="color:var(--muted)">並べた結果が別のメンバー名・曲名の読みと一致した場合も正解になります。</p>
  <p style="color:var(--muted)">出題するグループ（複数選択可）と、メンバーの卒業生あり／なし、混ぜる個数は下で選べます。</p>`;
  main.innerHTML = `<div class="card"><h3>遊び方</h3>
  ${howHtml}
  <p style="margin:10px 0 6px"><b>出題モード</b></p>
  <div class="ychips" id="agModes">${AG_MODES.map(m => `<button type="button" class="ychip" data-m="${m.id}">${m.label}</button>`).join("")}</div>
  <p style="margin:10px 0 6px"><b>混ぜる個数</b></p>
  <div class="ychips" id="agCounts"><button type="button" class="ychip" data-c="1">1つ（通常）</button><button type="button" class="ychip" data-c="2">2つ</button><button type="button" class="ychip" data-c="3">3つ</button></div>
  <p style="margin:10px 0 6px"><b>グループ</b>（複数選択可）</p>
  <div class="ychips" id="agGroups"><button type="button" class="ychip" data-g="">すべて</button>${AG_GROUPS.map(g => `<button type="button" class="ychip" data-g="${esc(g)}">${esc(g)}</button>`).join("")}</div>
  <div id="agStatusWrap">
  <p style="margin:10px 0 6px"><b>卒業生</b>（メンバー名のみ）</p>
  <div class="ychips" id="agStatus"><button type="button" class="ychip" data-s="all">卒業生あり</button><button type="button" class="ychip" data-s="active">卒業生なし</button></div>
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
    const n = pool === 0 ? 0 : AG_TOTAL;
    document.getElementById("agHowN").textContent = String(n);
    document.getElementById("agPoolNote").textContent = pool === 0
      ? "選んだ条件では出題できる対象が0件です。条件を変えてください。"
      : pool < AG_TOTAL
        ? `対象は${pool}件です。10問に届かない分は、同じ対象が繰り返し出題されます。全${n}問が出題されます。`
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
  // 生まれ年も member-meta.json（{"b":[年,月,日]}）から付ける。手がかり「生まれ年」用
  const memberMeta = await loadJSON("member-meta.json");
  const birthByName = new Map(Object.entries(memberMeta && typeof memberMeta === "object" ? memberMeta : {})
    .map(([n, v]) => [n, v && Array.isArray(v.b) ? v.b[0] : null]));
  AG.members.forEach(e => { e.birthYear = birthByName.get(e.name) || null; });
  AG_GROUPS = AG_GROUP_ORDER.filter(g => AG.members.some(e => e.group === g) || AG.songs.some(e => e.group === g));
  agLoadSettings();
  AG.members.forEach(e => { if (!AG_DICT.has(e.kata)) AG_DICT.set(e.kata, []); AG_DICT.get(e.kata).push({ kind: "member", label: e.name }); });
  AG.songs.forEach(e => { if (!AG_DICT.has(e.kata)) AG_DICT.set(e.kata, []); AG_DICT.get(e.kata).push({ kind: "song", label: e.title }); });
  AG_KATAS = [...AG_DICT.keys()];
  startPanel();
}
init();
