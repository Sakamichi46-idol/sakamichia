"use strict";
/* フォーメーションクイズ: 公式発表で確定しているフォーメーションだけを出題し、
   配置図の1枠を空欄にして「ここは誰？」を4択で当てる。10問制・1問100点・回答1回のみ。
   出題条件（ユーザーの指定）:
   - 乃木坂46: 公式に確定しているフォーメーションのみ
   - 櫻坂46・日向坂46: 公式サイトに掲載されているフォーメーションのみ
   データ側の判定には data/formations.json の official フラグを使う。これは楽曲図鑑で
   「公式発表に基づく」と表示しているものと同一の基準で、自動更新でも保持される
   公式発表分のこと。それ以外（参考データ）は出題しない。
   配置人数が3人未満の曲は図として成立しないため除外し、プールが10曲未満の
   グループはモードに出さず、全グループモードにも含めない。
   データ: data/formations.json / data/songs.json / data/members.json / data/member-photos.json */
const FQ_MAX = 10, FQ_MIN_POOL = 10, FQ_MIN_MEMBERS = 3, FQ_POINTS = 100;
const FQ_LINEAGES = ["乃木坂46", "櫻坂46", "日向坂46"];
const FQ_GCOL = { "乃木坂46": "#7e57c2", "櫻坂46": "#e77a9b", "日向坂46": "#5aa9d6", "欅坂46": "#5eba53", "けやき坂46": "#a4c639" };
let FQ = null;

function fqShuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function fqLineage(g) { return g === "欅坂46" ? "櫻坂46" : g === "けやき坂46" ? "日向坂46" : g; }
function fqPhoto(name) { const f = FQ.photos[name]; return f ? BASE + "assets/member-photos/" + f : null; }

function fqBuildPool(forms, songs) {
  const songMap = {};
  for (const s of songs) songMap[s.group + "|" + s.title] = s;
  const pool = [];
  for (const key of Object.keys(forms || {})) {
    const f = forms[key];
    if (!f || f.official !== true || !Array.isArray(f.rows) || !f.rows.length) continue;
    const idx = key.indexOf("|");
    const group = key.slice(0, idx), title = key.slice(idx + 1);
    const lin = fqLineage(group);
    if (!FQ_LINEAGES.includes(lin)) continue;
    const flat = f.rows.flat();
    if (flat.length < FQ_MIN_MEMBERS) continue;
    const s = songMap[key] || {};
    pool.push({ group, lineage: lin, title, rows: f.rows, center: s.center || "", year: s.year || null, date: s.date || null, type: s.type || "" });
  }
  return pool;
}
function fqModes(pool) {
  // プールが FQ_MIN_POOL 未満の系統はモードに出さず、「すべて」にも含めない
  const counts = {};
  for (const e of pool) counts[e.lineage] = (counts[e.lineage] || 0) + 1;
  const ok = FQ_LINEAGES.filter(l => (counts[l] || 0) >= FQ_MIN_POOL);
  return { counts, ok, all: pool.filter(e => ok.includes(e.lineage)) };
}
// 難易度：1問で答える空欄の数が変わる
const FQ_DIFFS = [
  { key: "easy", label: "易", blanks: 1 },
  { key: "normal", label: "普", blanks: 2 },
  { key: "hard", label: "難", blanks: 3 },
  { key: "oni", label: "鬼", blanks: 5 }
];
function fqMakeQuestion(e) {
  const cells = [];
  e.rows.forEach((row, ri) => row.forEach((name, ci) => cells.push({ ri, ci, name })));
  const n = Math.min(FQ.diff.blanks, cells.length);
  const picks = fqShuffle(cells).slice(0, n).sort((a, b) => a.ri - b.ri || a.ci - b.ci);
  return { ...e, blanks: picks.map(p => ({ ri: p.ri, ci: p.ci, answer: p.name })) };
}
// リリース日にそのグループに在籍していたか（在籍期間データ draft-timeline と同じ判定）。
// 卒業済み・未加入のメンバーを選択肢に入れると消去法で分かってしまうため、優先的に除外する。
const FQ_GCODE = { "乃木坂46": "nogi", "欅坂46": "keyaki", "櫻坂46": "sakura", "けやき坂46": "hiragana", "日向坂46": "hinata" };
const FQ_PERIODS = { keyaki: ["2015-08-21", "2020-10-13"], sakura: ["2020-10-14", null], hiragana: ["2015-11-30", "2019-02-10"], hinata: ["2019-02-11", null], nogi: ["2011-08-21", null] };
function fqEraEligible(name, q) {
  if (!FQ.eraByName || !q.date) return true;  // データが無い場合は従来どおり
  const rec = FQ.eraByName[name];
  if (!rec) return false;
  const code = FQ_GCODE[q.group], range = code && FQ_PERIODS[code];
  if (!code || !range) return true;
  if (!rec.groups.includes(code)) return false;
  if (q.date < range[0] || (range[1] && q.date > range[1])) return false;
  if (!rec.joined || rec.joined > q.date) return false;
  if (rec.uncertainEnd) return false;
  if (rec.left && rec.left < q.date) return false;
  if ((code === "sakura" || code === "hinata") && rec.left && rec.left < range[0]) return false;
  return true;
}
function fqChoicesFor(q, bi, usedDecoys) {
  const answer = q.blanks[bi].answer;
  const inForm = new Set(q.rows.flat());
  const ans = FQ.memberByName[answer];
  const linMembers = FQ.members.filter(m =>
    m.name !== "ポカ" && !inForm.has(m.name) && !usedDecoys.has(m.name) &&
    fqLineage(m.group) === q.lineage);
  const isGen = m => ans && ans.gen > 0 && m.gen === ans.gen;
  const era = linMembers.filter(m => fqEraEligible(m.name, q));
  // 在籍していたメンバー（同期→その他）を優先し、足りない場合だけ在籍外から補う
  const tiers = [era.filter(isGen), era.filter(m => !isGen(m)), linMembers.filter(isGen), linMembers.filter(m => !isGen(m))];
  const used = new Set(), decoys = [];
  for (const tier of tiers) {
    for (const m of fqShuffle(tier)) {
      if (decoys.length >= 3) break;
      if (!used.has(m.name)) { used.add(m.name); decoys.push(m); }
    }
    if (decoys.length >= 3) break;
  }
  decoys.forEach(m => usedDecoys.add(m.name));
  return fqShuffle([answer, ...decoys.map(m => m.name)]);
}
function fqSetupChoices(q) {
  const usedDecoys = new Set();
  return q.blanks.map((b, bi) => fqChoicesFor(q, bi, usedDecoys));
}
function fqPerBlank(q) { return Math.round(FQ_POINTS / q.blanks.length); }
function fqTile(name, opts) {
  const url = fqPhoto(name);
  const ph = url ? `<img loading="lazy" src="${esc(url)}" alt="">` : `<span class="fq-initial" style="background:${FQ_GCOL[FQ.list[FQ.i].group] || "#999"}">${esc(name.slice(0, 1))}</span>`;
  return `<div class="fq-tile${opts.ctr ? " ctr" : ""}${opts.cls ? " " + opts.cls : ""}">${ph}<span class="fq-name">${esc(name)}</span></div>`;
}
function fqRender() {
  const area = document.getElementById("fqArea");
  const q = FQ.list[FQ.i];
  const centers = new Set(q.center ? q.center.split("・").filter(Boolean) : []);
  const maxn = Math.max(...q.rows.map(r => r.length));
  const blankAt = (ri, ci) => q.blanks.findIndex(b => b.ri === ri && b.ci === ci);
  const board = q.rows.map((row, ri) => `<div class="fq-row">${row.map((name, ci) => {
    const bi = blankAt(ri, ci);
    if (bi < 0) return fqTile(name, { ctr: centers.has(name) });
    const b = q.blanks[bi];
    if (FQ.done) {
      const ok = FQ.filled[bi] === b.answer;
      return fqTile(ok ? b.answer : (FQ.filled[bi] || b.answer), { ctr: centers.has(b.answer), cls: ok ? "hit" : "miss" });
    }
    if (FQ.filled[bi]) return `<div class="fq-tile filled" data-bi="${bi}" role="button" tabindex="0">${fqTileInner(FQ.filled[bi])}</div>`;
    return `<div class="fq-tile blank${FQ.active === bi ? " active" : ""}" data-bi="${bi}" role="button" tabindex="0"><span class="fq-qmark">？</span><span class="fq-name">？？？</span></div>`;
  }).join("")}</div>`).join("");
  const remaining = q.blanks.length - Object.keys(FQ.filled).length;
  let html = `<div class="card" style="margin-bottom:40px"><h3>第${FQ.i + 1}問 / ${FQ.list.length}問（現在 ${FQ.score}点）</h3>
  <p style="color:var(--muted);margin:4px 0">${esc(q.lineage)}『${esc(q.title)}』${q.year ? `（${q.year}年）` : ""} のフォーメーションです。空欄は${q.blanks.length}人います。${FQ.done ? "" : "空欄をタップして対象を切り替え、下の4択から選んでください。"}</p>
  <div class="fq-board" style="--maxn:${maxn}">${board}</div>`;
  if (!FQ.done) {
    if (remaining > 0) {
      html += `<p style="margin:6px 0">空欄 ${FQ.active + 1} / ${q.blanks.length}（あと${remaining}人）</p>`;
      if (FQ.style === "input") {
        html += `<div class="fq-inputrow"><input id="fqInput" type="text" placeholder="メンバー名を入力（候補からも選べます）" autocomplete="off" value="${esc(FQ.filled[FQ.active] || "")}"><button type="button" class="btn" id="fqFill">決定</button></div>`;
      } else {
        html += `<div>${FQ.choiceSets[FQ.active].map(c => `<button type="button" class="quiz-opt" data-t="${esc(c)}">${esc(c)}</button>`).join("")}</div>`;
      }
    } else {
      html += `<p><button type="button" id="fqJudge" class="primary">回答する</button></p>`;
    }
  } else {
    const per = fqPerBlank(q);
    const correct = q.blanks.filter((b, bi) => FQ.filled[bi] === b.answer).length;
    html += `<p class="score">${correct === q.blanks.length ? `全員正解！ +${per * correct}点` : `${q.blanks.length}人中 ${correct}人正解（+${per * correct}点）`}</p>
    ${q.blanks.map((b, bi) => `<p style="margin:4px 0">前から${q.rows.length - b.ri}列目：<b>${esc(b.answer)}</b>${FQ.filled[bi] === b.answer ? "（正解）" : `（あなたの回答：${esc(FQ.filled[bi] || "未回答")}）`}</p>`).join("")}
    <p><button type="button" id="fqNext" class="primary">${FQ.i + 1 < FQ.list.length ? "次の問題へ" : "結果を見る"}</button></p>`;
  }
  area.innerHTML = html + "</div>";
  area.querySelectorAll("[data-bi]").forEach(el => el.addEventListener("click", () => {
    if (FQ.done) return;
    FQ.active = +el.dataset.bi;
    fqRender();
  }));
  area.querySelectorAll(".quiz-opt").forEach(b => b.addEventListener("click", () => {
    FQ.filled[FQ.active] = b.dataset.t;
    const nextBlank = q.blanks.findIndex((_, bi) => !(bi in FQ.filled));
    if (nextBlank >= 0) FQ.active = nextBlank;
    fqRender();
  }));
  const fqIn = document.getElementById("fqInput");
  if (fqIn) {
    const inForm = new Set(q.rows.flat());
    const pool = FQ.members.filter(m => m.name !== "ポカ" && !inForm.has(m.name) && fqLineage(m.group) === q.lineage);
    const fillWith = name => {
      const nm = String(name || "").replace(/[\s　]/g, "");
      const hit = pool.find(m => m.name.replace(/[\s　]/g, "") === nm) || FQ.members.find(m => m.name.replace(/[\s　]/g, "") === nm);
      if (!hit) { fqIn.setAttribute("aria-invalid", "true"); fqIn.focus(); return; }
      FQ.filled[FQ.active] = hit.name;
      const nextBlank = q.blanks.findIndex((_, bi) => !(bi in FQ.filled));
      if (nextBlank >= 0) FQ.active = nextBlank;
      fqRender();
    };
    attachSuggest(fqIn, query => {
      const hits = t => kanaNorm(String(t || "").toLowerCase()).includes(kanaNorm(query.toLowerCase()));
      return pool.filter(m => hits(m.name) || hits(m.reading))
        .sort((a, b) => (fqEraEligible(b.name, q) - fqEraEligible(a.name, q)))
        .map(m => ({ kind: "メンバー", cls: "member", label: m.name, sub: m.group }));
    }, it => fillWith(it.label));
    document.getElementById("fqFill").addEventListener("click", () => fillWith(fqIn.value));
    fqIn.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); fillWith(fqIn.value); } });
    fqIn.focus({ preventScroll: true });
  }
  const judge = document.getElementById("fqJudge");
  if (judge) judge.addEventListener("click", () => {
    const per = fqPerBlank(q);
    FQ.score += per * q.blanks.filter((b, bi) => FQ.filled[bi] === b.answer).length;
    FQ.done = true;
    fqRender();
  });
  const next = document.getElementById("fqNext");
  if (next) next.addEventListener("click", () => {
    FQ.i++;
    if (FQ.i >= FQ.list.length) { fqResult(); return; }
    FQ.done = false; FQ.filled = {}; FQ.active = 0;
    FQ.choiceSets = fqSetupChoices(FQ.list[FQ.i]);
    fqRender();
  });
}
function fqTileInner(name) {
  const url = fqPhoto(name);
  const ph = url ? `<img loading="lazy" src="${esc(url)}" alt="">` : `<span class="fq-initial" style="background:${FQ_GCOL[FQ.list[FQ.i].group] || "#999"}">${esc(name.slice(0, 1))}</span>`;
  return `${ph}<span class="fq-name">${esc(name)}</span>`;
}
function fqResult() {
  const area = document.getElementById("fqArea");
  const max = FQ.list.reduce((a, e) => a + fqPerBlank(e) * e.blanks.length, 0);
  const list = FQ.list.map((e, idx) => `<p style="margin:6px 0">${idx + 1}. 『${esc(e.title)}』（${esc(e.lineage)}）の空欄は <b>${e.blanks.map(b => esc(b.answer)).join("、")}</b></p>`).join("");
  area.innerHTML = `<div class="card" style="margin-bottom:40px"><h3>結果</h3>
  <p class="score">${FQ.score} / ${max} 点</p>
  <h4 style="margin:18px 0 6px">出題されたフォーメーション</h4>
  ${list}
  <p>${FQ.score >= max * 0.8 ? "すごい！配置まで完璧に覚えていますね。" : FQ.score >= max * 0.5 ? "なかなかのフォーメーション通です。" : FQ.score >= max * 0.3 ? "前列は覚えていても、後列は意外と難しいですよね。" : "配置を当てるのは至難の業です。楽曲図鑑で眺めるのも楽しいですよ。"}</p>
  <p><button type="button" class="primary" onclick="location.reload()">モード選択に戻る</button> <button type="button" id="fqShare">結果を共有</button></p></div>`;
  const sh = document.getElementById("fqShare");
  if (sh) sh.addEventListener("click", () => shareScoreImage({ game: "フォーメーションクイズ", score: `${FQ.score}点／${max}点`, lines: [`難易度：${FQ.diff.label}（空欄${FQ.diff.blanks}人）／${FQ.style === "input" ? "打ち込み式" : "4択式"}／モード：${FQ.mode === "all" ? "すべて" : FQ.mode}`, ...FQ.list.slice(0, 5).map((e, i) => `${i + 1}. 『${e.title}』 ${e.blanks.map(b => b.answer).join("、")}`)] }, sh));
}
function fqStartPanel(pool) {
  const area = document.getElementById("fqArea");
  const { counts, ok, all } = fqModes(pool);
  if (!all.length) {
    area.innerHTML = `<div class="card"><p>出題できるフォーメーション（公式発表で確定している配置）がまだありません。</p></div>`;
    return;
  }
  let mode = "all";
  const chips = [`<button type="button" class="ychip on" data-m="all">すべて（${all.length}曲）</button>`,
    ...ok.map(g => `<button type="button" class="ychip" data-m="${esc(g)}">${esc(g)}（${counts[g]}曲）</button>`)].join("");
  const diffChips = FQ_DIFFS.map((d, i) => `<button type="button" class="ychip${i === 0 ? " on" : ""}" data-d="${d.key}">${d.label}（空欄${d.blanks}人）</button>`).join("");
  const styleChips = [`<button type="button" class="ychip on" data-s="choice">4択式</button>`, `<button type="button" class="ychip" data-s="input">打ち込み式</button>`].join("");
  const excluded = FQ_LINEAGES.filter(l => !ok.includes(l));
  const note = excluded.length ? `<p style="color:var(--muted)">${excluded.map(l => `${esc(l)}（公式確定分 ${counts[l] || 0}曲）`).join("・")}は、出題に使える公式確定のフォーメーションが${FQ_MIN_POOL}曲未満のため対象外です。</p>` : "";
  area.innerHTML = `<div class="card" style="margin-bottom:40px"><h3>モードを選んでください</h3>
  <p style="color:var(--muted)">出題は公式発表で確定しているフォーメーションのみです（参考データの配置は出題しません）。</p>
  ${note}
  <div class="filters" style="margin:10px 0">${chips}</div>
  <h4 style="margin:14px 0 6px">難易度（1問で答える空欄の数）</h4>
  <div class="filters" style="margin:6px 0 10px">${diffChips}</div>
  <h4 style="margin:14px 0 6px">回答方式</h4>
  <div class="filters" style="margin:6px 0 10px">${styleChips}</div>
  <p><button type="button" class="primary" id="fqStart">スタート</button></p></div>`;
  area.querySelectorAll("[data-m]").forEach(b => b.addEventListener("click", () => {
    mode = b.dataset.m;
    area.querySelectorAll("[data-m]").forEach(x => x.classList.toggle("on", x === b));
  }));
  area.querySelectorAll("[data-d]").forEach(b => b.addEventListener("click", () => {
    FQ.diff = FQ_DIFFS.find(d => d.key === b.dataset.d) || FQ_DIFFS[0];
    area.querySelectorAll("[data-d]").forEach(x => x.classList.toggle("on", x === b));
    // 回答方式を自分で選んでいない場合は、鬼だけ打ち込み式を初期値にする
    if (!FQ.styleTouched) {
      FQ.style = FQ.diff.key === "oni" ? "input" : "choice";
      area.querySelectorAll("[data-s]").forEach(x => x.classList.toggle("on", x.dataset.s === FQ.style));
    }
  }));
  area.querySelectorAll("[data-s]").forEach(b => b.addEventListener("click", () => {
    FQ.style = b.dataset.s;
    FQ.styleTouched = true;
    area.querySelectorAll("[data-s]").forEach(x => x.classList.toggle("on", x === b));
  }));
  document.getElementById("fqStart").addEventListener("click", () => {
    const src = mode === "all" ? all : pool.filter(e => e.lineage === mode);
    FQ.list = fqShuffle(src).slice(0, FQ_MAX).map(fqMakeQuestion);
    FQ.mode = mode; FQ.i = 0; FQ.score = 0; FQ.done = false; FQ.filled = {}; FQ.active = 0;
    FQ.choiceSets = fqSetupChoices(FQ.list[0]);
    fqRender();
  });
}
async function fqInit() {
  const area = document.getElementById("fqArea");
  const [forms, songs, members, photos, draftMembers, timeline] = await Promise.all([
    loadJSON("formations.json"), loadJSON("songs.json"), loadJSON("members.json"), loadJSON("member-photos.json"),
    loadJSON("draft-members.json"), loadJSON("draft-timeline.json")]);
  if (!forms || !Array.isArray(songs) || !Array.isArray(members)) {
    area.innerHTML = `<div class="card"><p>出題データを読み込めませんでした。</p></div>`;
    return;
  }
  FQ = { members, photos: photos || {}, memberByName: {}, eraByName: null, list: [], mode: "all", diff: FQ_DIFFS[0], style: "choice", styleTouched: false, i: 0, score: 0, done: false, filled: {}, active: 0, choiceSets: [] };
  if (Array.isArray(draftMembers) && timeline && timeline.ready && timeline.members) {
    FQ.eraByName = {};
    for (const dm of draftMembers) {
      const t = timeline.members[dm.id];
      if (t) FQ.eraByName[dm.name] = { groups: dm.groups || [dm.group], joined: t.joined, left: t.left, uncertainEnd: !!t.uncertainEnd };
    }
  }
  for (const m of members) FQ.memberByName[m.name] = m;
  fqStartPanel(fqBuildPool(forms, songs));
}
document.addEventListener("DOMContentLoaded", fqInit);
