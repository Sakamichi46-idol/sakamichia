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
    pool.push({ group, lineage: lin, title, rows: f.rows, center: s.center || "", year: s.year || null, type: s.type || "" });
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
function fqMakeQuestion(e) {
  const cells = [];
  e.rows.forEach((row, ri) => row.forEach((name, ci) => cells.push([ri, ci, name])));
  const [ri, ci, answer] = cells[Math.floor(Math.random() * cells.length)];
  return { ...e, blank: [ri, ci], answer, choices: [] };
}
function fqChoices(q) {
  const inForm = new Set(q.rows.flat());
  const ans = FQ.memberByName[q.answer];
  const linMembers = FQ.members.filter(m =>
    m.name !== "ポカ" && !inForm.has(m.name) &&
    fqLineage(m.group) === q.lineage);
  const sameGen = linMembers.filter(m => ans && ans.gen > 0 && m.gen === ans.gen);
  const rest = linMembers.filter(m => !(ans && ans.gen > 0 && m.gen === ans.gen));
  const decoys = fqShuffle(sameGen).slice(0, 3);
  if (decoys.length < 3) decoys.push(...fqShuffle(rest).slice(0, 3 - decoys.length));
  return fqShuffle([q.answer, ...decoys.map(m => m.name)]);
}
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
  const frontRow = q.rows.length - q.blank[0]; // 前から何列目か（データは後列→前列の順）
  const board = q.rows.map((row, ri) => `<div class="fq-row">${row.map((name, ci) => {
    if (ri === q.blank[0] && ci === q.blank[1]) {
      if (FQ.done) return fqTile(name, { ctr: centers.has(name), cls: "hit" });
      return `<div class="fq-tile blank"><span class="fq-qmark">？</span><span class="fq-name">？？？</span></div>`;
    }
    return fqTile(name, { ctr: centers.has(name) });
  }).join("")}</div>`).join("");
  let html = `<div class="card" style="margin-bottom:40px"><h3>第${FQ.i + 1}問 / ${FQ.list.length}問（現在 ${FQ.score}点）</h3>
  <p style="color:var(--muted);margin:4px 0">${esc(q.lineage)}『${esc(q.title)}』${q.year ? `（${q.year}年）` : ""} のフォーメーションです。空欄（前から${frontRow}列目）は誰でしょう？</p>
  <div class="fq-board" style="--maxn:${maxn}">${board}</div>`;
  if (!FQ.done) {
    html += `<div>${FQ.choices.map(c => `<button type="button" class="quiz-opt" data-t="${esc(c)}">${esc(c)}</button>`).join("")}</div>`;
  } else {
    const ok = FQ.picked === q.answer;
    html += `<p class="score">${ok ? `正解！ +${FQ_POINTS}点` : `残念… 正解は「${esc(q.answer)}」でした`}</p>
    <p>答え：<b>${esc(q.answer)}</b>（${esc(q.lineage)}『${esc(q.title)}』・前から${frontRow}列目）</p>
    <p><button type="button" id="fqNext" class="primary">${FQ.i + 1 < FQ.list.length ? "次の問題へ" : "結果を見る"}</button></p>`;
  }
  area.innerHTML = html + "</div>";
  area.querySelectorAll(".quiz-opt").forEach(b => b.addEventListener("click", () => {
    FQ.picked = b.dataset.t;
    FQ.done = true;
    if (FQ.picked === q.answer) FQ.score += FQ_POINTS;
    fqRender();
    area.querySelectorAll(".quiz-opt").forEach(x => {
      if (x.dataset.t === q.answer) x.classList.add("correct");
      else if (x.dataset.t === FQ.picked) x.classList.add("wrong");
      x.disabled = true;
    });
  }));
  const next = document.getElementById("fqNext");
  if (next) next.addEventListener("click", () => {
    FQ.i++;
    if (FQ.i >= FQ.list.length) { fqResult(); return; }
    FQ.done = false; FQ.picked = null;
    FQ.choices = fqChoices(FQ.list[FQ.i]);
    fqRender();
  });
}
function fqResult() {
  const area = document.getElementById("fqArea");
  const max = FQ.list.length * FQ_POINTS;
  const list = FQ.list.map((e, idx) => `<p style="margin:6px 0">${idx + 1}. 『${esc(e.title)}』（${esc(e.lineage)}）の空欄は <b>${esc(e.answer)}</b></p>`).join("");
  area.innerHTML = `<div class="card" style="margin-bottom:40px"><h3>結果</h3>
  <p class="score">${FQ.score} / ${max} 点</p>
  <h4 style="margin:18px 0 6px">出題されたフォーメーション</h4>
  ${list}
  <p>${FQ.score >= max * 0.8 ? "すごい！配置まで完璧に覚えていますね。" : FQ.score >= max * 0.5 ? "なかなかのフォーメーション通です。" : FQ.score >= max * 0.3 ? "前列は覚えていても、後列は意外と難しいですよね。" : "配置を当てるのは至難の業です。楽曲図鑑で眺めるのも楽しいですよ。"}</p>
  <p><button type="button" class="primary" onclick="location.reload()">モード選択に戻る</button> <button type="button" id="fqShare">結果を共有</button></p></div>`;
  const sh = document.getElementById("fqShare");
  if (sh) sh.addEventListener("click", () => shareContent({ text: `サカミチア「フォーメーションクイズ」で ${FQ.score}／${max}点でした（モード：${FQ.mode === "all" ? "すべて" : FQ.mode}）。`, url: location.href }, sh));
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
  const excluded = FQ_LINEAGES.filter(l => !ok.includes(l));
  const note = excluded.length ? `<p style="color:var(--muted)">${excluded.map(l => `${esc(l)}（公式確定分 ${counts[l] || 0}曲）`).join("・")}は、出題に使える公式確定のフォーメーションが${FQ_MIN_POOL}曲未満のため対象外です。</p>` : "";
  area.innerHTML = `<div class="card" style="margin-bottom:40px"><h3>モードを選んでください</h3>
  <p style="color:var(--muted)">出題は公式発表で確定しているフォーメーションのみです（参考データの配置は出題しません）。</p>
  ${note}
  <div class="filters" style="margin:10px 0">${chips}</div>
  <p><button type="button" class="primary" id="fqStart">スタート</button></p></div>`;
  area.querySelectorAll("[data-m]").forEach(b => b.addEventListener("click", () => {
    mode = b.dataset.m;
    area.querySelectorAll("[data-m]").forEach(x => x.classList.toggle("on", x === b));
  }));
  document.getElementById("fqStart").addEventListener("click", () => {
    const src = mode === "all" ? all : pool.filter(e => e.lineage === mode);
    FQ.list = fqShuffle(src).slice(0, FQ_MAX).map(fqMakeQuestion);
    FQ.mode = mode; FQ.i = 0; FQ.score = 0; FQ.done = false; FQ.picked = null;
    FQ.choices = fqChoices(FQ.list[0]);
    fqRender();
  });
}
async function fqInit() {
  const area = document.getElementById("fqArea");
  const [forms, songs, members, photos] = await Promise.all([
    loadJSON("formations.json"), loadJSON("songs.json"), loadJSON("members.json"), loadJSON("member-photos.json")]);
  if (!forms || !Array.isArray(songs) || !Array.isArray(members)) {
    area.innerHTML = `<div class="card"><p>出題データを読み込めませんでした。</p></div>`;
    return;
  }
  FQ = { members, photos: photos || {}, memberByName: {}, list: [], mode: "all", i: 0, score: 0, done: false, picked: null, choices: [] };
  for (const m of members) FQ.memberByName[m.name] = m;
  fqStartPanel(fqBuildPool(forms, songs));
}
document.addEventListener("DOMContentLoaded", fqInit);
