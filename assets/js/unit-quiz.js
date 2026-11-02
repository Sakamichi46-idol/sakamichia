"use strict";
/* ユニットクイズ: ユニット曲のメンバー構成（写真と名前）を見せて、
   「この組み合わせはどのユニット曲？」を曲名4択で当てる。10問制・1問100点・回答1回のみ。
   プールは種別「ユニット曲」で、歌唱メンバーが data/formations.json の vocal で
   確定している曲のみ。選択肢は同じ系統の他のユニット曲から作る。
   データ: data/songs.json / data/formations.json / data/member-photos.json */
const UQ_MAX = 10, UQ_MIN_POOL = 10, UQ_POINTS = 100;
const UQ_LINEAGES = ["乃木坂46", "櫻坂46", "日向坂46"];
const UQ_GCOL = { "乃木坂46": "#7e57c2", "櫻坂46": "#e77a9b", "日向坂46": "#5aa9d6", "欅坂46": "#5eba53", "けやき坂46": "#a4c639" };
let UQ = null;

function uqShuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function uqLineage(g) { return g === "欅坂46" ? "櫻坂46" : g === "けやき坂46" ? "日向坂46" : g; }
function uqPhoto(name) { const f = UQ.photos[name]; return f ? BASE + "assets/member-photos/" + f : null; }

function uqBuildPool(songs, forms) {
  // 同じメンバー構成の曲が複数ある場合は1つの出題単位にまとめる（正解が2つになるのを防ぐ）
  const bySig = new Map();
  for (const s of songs) {
    if (s.type !== "ユニット曲") continue;
    const lin = uqLineage(s.group);
    if (!UQ_LINEAGES.includes(lin)) continue;
    const f = (forms || {})[s.group + "|" + s.title];
    if (!f || !Array.isArray(f.vocal) || f.vocal.length < 2) continue;
    const sig = [...f.vocal].sort().join("");
    if (!bySig.has(sig)) bySig.set(sig, { sig, lineage: lin, vocal: f.vocal, titles: [] });
    bySig.get(sig).titles.push({ group: s.group, title: s.title, year: s.year || null, release: s.release || "" });
  }
  return [...bySig.values()];
}
function uqMakeQuestion(entry) {
  const answer = entry.titles[Math.floor(Math.random() * entry.titles.length)];
  return { ...entry, answer };
}
function uqChoices(q) {
  const same = UQ.pool.filter(e => e.sig !== q.sig && e.lineage === q.lineage);
  const others = UQ.pool.filter(e => e.sig !== q.sig && e.lineage !== q.lineage);
  const used = new Set([q.answer.title]);
  const decoys = [];
  for (const e of [...uqShuffle(same), ...uqShuffle(others)]) {
    if (decoys.length >= 3) break;
    const cand = uqShuffle(e.titles.map(t => t.title)).find(t => !used.has(t));
    if (cand) { used.add(cand); decoys.push(cand); }
  }
  return uqShuffle([q.answer.title, ...decoys]);
}
function uqMemberHTML(name, group) {
  const url = uqPhoto(name);
  const ph = url ? `<img loading="lazy" src="${esc(url)}" alt="">` : `<span class="fq-initial" style="background:${UQ_GCOL[group] || "#999"}">${esc(name.slice(0, 1))}</span>`;
  return `<div class="uq-member">${ph}<span class="fq-name">${esc(name)}</span></div>`;
}
function uqRender() {
  const area = document.getElementById("uqArea");
  const q = UQ.list[UQ.i];
  let html = `<div class="card" style="margin-bottom:40px"><h3>第${UQ.i + 1}問 / ${UQ.list.length}問（現在 ${UQ.score}点）</h3>
  <p style="color:var(--muted);margin:4px 0">${esc(q.lineage)}のユニット曲です。この組み合わせは、どの曲でしょう？</p>
  <div class="uq-members${q.vocal.length <= 4 ? " fit" + q.vocal.length : ""}">${q.vocal.map(n => uqMemberHTML(n, q.answer.group)).join("")}</div>`;
  if (!UQ.done) {
    html += `<div>${UQ.choices.map(c => `<button type="button" class="quiz-opt" data-t="${esc(c)}">『${esc(c)}』</button>`).join("")}</div>`;
  } else {
    const ok = UQ.picked === q.answer.title;
    const others = q.titles.filter(t => t.title !== q.answer.title);
    html += `<p class="score">${ok ? `正解！ +${UQ_POINTS}点` : `残念… 正解は『${esc(q.answer.title)}』でした`}</p>
    <p>答え：<b>『${esc(q.answer.title)}』</b>（${esc(q.answer.group)}${q.answer.year ? "・" + q.answer.year + "年" : ""}／${q.vocal.length}人のユニット）</p>
    ${others.length ? `<p style="color:var(--muted)">同じメンバーの組み合わせには、ほかに${others.map(t => `『${esc(t.title)}』`).join("、")}もあります。</p>` : ""}
    <p><button type="button" id="uqNext" class="primary">${UQ.i + 1 < UQ.list.length ? "次の問題へ" : "結果を見る"}</button></p>`;
  }
  area.innerHTML = html + "</div>";
  area.querySelectorAll(".quiz-opt").forEach(b => b.addEventListener("click", () => {
    UQ.picked = b.dataset.t;
    UQ.done = true;
    if (UQ.picked === q.answer.title) UQ.score += UQ_POINTS;
    uqRender();
    area.querySelectorAll(".quiz-opt").forEach(x => {
      if (x.dataset.t === q.answer.title) x.classList.add("correct");
      else if (x.dataset.t === UQ.picked) x.classList.add("wrong");
      x.disabled = true;
    });
  }));
  const next = document.getElementById("uqNext");
  if (next) next.addEventListener("click", () => {
    UQ.i++;
    if (UQ.i >= UQ.list.length) { uqResult(); return; }
    UQ.done = false; UQ.picked = null;
    UQ.choices = uqChoices(UQ.list[UQ.i]);
    uqRender();
  });
}
function uqResult() {
  const area = document.getElementById("uqArea");
  const max = UQ.list.length * UQ_POINTS;
  const list = UQ.list.map((e, idx) => `<p style="margin:6px 0">${idx + 1}. 『${esc(e.answer.title)}』（${esc(e.lineage)}／${e.vocal.length}人：${e.vocal.map(esc).join("・")}）${e.titles.length > 1 ? `　※同じメンバーで${e.titles.filter(t => t.title !== e.answer.title).map(t => `『${esc(t.title)}』`).join("、")}もあり` : ""}</p>`).join("");
  area.innerHTML = `<div class="card" style="margin-bottom:40px"><h3>結果</h3>
  <p class="score">${UQ.score} / ${max} 点</p>
  <h4 style="margin:18px 0 6px">出題されたユニット曲</h4>
  ${list}
  <p>${UQ.score >= max * 0.8 ? "すごい！ユニットの組み合わせまで完璧ですね。" : UQ.score >= max * 0.5 ? "なかなかのユニット通です。" : UQ.score >= max * 0.3 ? "定番ユニットは押さえていても、意外な組み合わせもありますよね。" : "ユニット曲は隠れた名曲の宝庫です。楽曲図鑑で探してみてください。"}</p>
  <p><button type="button" class="primary" onclick="location.reload()">モード選択に戻る</button> <button type="button" id="uqShare">結果を共有</button></p></div>`;
  const sh = document.getElementById("uqShare");
  if (sh) sh.addEventListener("click", () => shareContent({ text: `サカミチア「ユニットクイズ」で ${UQ.score}／${max}点でした（モード：${UQ.mode === "all" ? "すべて" : UQ.mode}）。`, url: location.href }, sh));
}
function uqStartPanel(pool) {
  const area = document.getElementById("uqArea");
  const counts = {};
  for (const e of pool) counts[e.lineage] = (counts[e.lineage] || 0) + 1;
  const ok = UQ_LINEAGES.filter(l => (counts[l] || 0) >= UQ_MIN_POOL);
  const all = pool.filter(e => ok.includes(e.lineage));
  if (!all.length) {
    area.innerHTML = `<div class="card"><p>出題できるユニット曲（歌唱メンバーが確定している曲）がまだありません。</p></div>`;
    return;
  }
  let mode = "all";
  const chips = [`<button type="button" class="ychip on" data-m="all">すべて（${all.length}組）</button>`,
    ...ok.map(g => `<button type="button" class="ychip" data-m="${esc(g)}">${esc(g)}（${counts[g]}組）</button>`)].join("");
  area.innerHTML = `<div class="card" style="margin-bottom:40px"><h3>モードを選んでください</h3>
  <p style="color:var(--muted)">全${UQ_MAX}問・1問${UQ_POINTS}点のクイズです。グループ別に絞って遊べます。出題は歌唱メンバーが確定しているユニット曲のみです。</p>
  <div class="filters" style="margin:10px 0">${chips}</div>
  <p><button type="button" class="primary" id="uqStart">スタート</button></p></div>`;
  area.querySelectorAll("[data-m]").forEach(b => b.addEventListener("click", () => {
    mode = b.dataset.m;
    area.querySelectorAll("[data-m]").forEach(x => x.classList.toggle("on", x === b));
  }));
  document.getElementById("uqStart").addEventListener("click", () => {
    const src = mode === "all" ? all : pool.filter(e => e.lineage === mode);
    UQ.list = uqShuffle(src).slice(0, UQ_MAX).map(uqMakeQuestion);
    UQ.mode = mode; UQ.i = 0; UQ.score = 0; UQ.done = false; UQ.picked = null;
    UQ.choices = uqChoices(UQ.list[0]);
    uqRender();
  });
}
async function uqInit() {
  const area = document.getElementById("uqArea");
  const [songs, forms, photos] = await Promise.all([
    loadJSON("songs.json"), loadJSON("formations.json"), loadJSON("member-photos.json")]);
  if (!Array.isArray(songs) || !forms) {
    area.innerHTML = `<div class="card"><p>出題データを読み込めませんでした。</p></div>`;
    return;
  }
  UQ = { pool: uqBuildPool(songs, forms), photos: photos || {}, list: [], mode: "all", i: 0, score: 0, done: false, picked: null, choices: [] };
  uqStartPanel(UQ.pool);
}
document.addEventListener("DOMContentLoaded", uqInit);
