"use strict";
/* 漢字だけ歌詞クイズ: 歌詞の漢字だけを順に表示し、どこで曲名が分かるかを当てる。
   データ: data/lyrics-quiz.json [{title, group, year, kanji}]（tools/build_lyrics_quiz.py で生成） */
const KQ_MAX = 10, KQ_FIRST = 5, KQ_STEP = 1;
let KQ = null;

function kqShuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function kqPoints(revealed) {
  // 最初の5文字は100点。以後、1文字出すごとに -1点（最低10点）
  return Math.max(10, 100 - Math.max(0, revealed - KQ_FIRST));
}
function kqRender() {
  const area = document.getElementById("kqArea");
  const q = KQ.list[KQ.i], total = q.kanji.length;
  const shown = q.kanji.slice(0, KQ.revealed);
  const pts = kqPoints(KQ.revealed);
  let html = `<div class="card" style="margin-bottom:40px"><h3>第${KQ.i + 1}問 / ${KQ.list.length}問（現在 ${KQ.score}点）</h3>
  <p style="color:var(--muted);margin:4px 0">${esc(q.group)}${q.group === "サンプル" ? "" : "の曲"}${KQ.done ? "" : ` ・ この問題は現在 <b>${pts}点</b>`}</p>
  <div class="kq-stage">${esc(shown)}${KQ.revealed < total ? '<span class="kq-more">…</span>' : ""}</div>
  <p style="color:var(--muted)">${KQ.revealed} / ${total} 文字目まで表示</p>`;
  if (!KQ.answering && !KQ.done) {
    html += `<p><button type="button" id="kqMore" ${KQ.revealed >= total ? "disabled" : ""}>1文字出す（-1点）</button>
    <button type="button" id="kqAnswer" class="primary">わかった！答える</button></p>`;
  }
  if (KQ.answering && !KQ.done) {
    html += `<div>${KQ.choices.map(c => `<button type="button" class="quiz-opt" data-t="${esc(c)}">${esc(c)}</button>`).join("")}</div>`;
  }
  if (KQ.done) {
    const ok = KQ.picked === q.title;
    html += `<p class="score">${ok ? `正解！ +${KQ.gained}点` : `残念… 正解は「${esc(q.title)}」でした`}</p>
    <p>答え：<b>${esc(q.title)}</b>（${esc(q.group)}${q.year ? "・" + q.year + "年" : ""}）／ 漢字は全${total}文字でした。</p>
    <p><button type="button" id="kqNext" class="primary">${KQ.i + 1 < KQ.list.length ? "次の問題へ" : "結果を見る"}</button></p>`;
  }
  area.innerHTML = html + "</div>";
  const more = document.getElementById("kqMore");
  if (more) more.addEventListener("click", () => { KQ.revealed = Math.min(total, KQ.revealed + KQ_STEP); kqRender(); });
  const ans = document.getElementById("kqAnswer");
  if (ans) ans.addEventListener("click", () => { KQ.answering = true; kqRender(); });
  area.querySelectorAll(".quiz-opt").forEach(b => b.addEventListener("click", () => {
    KQ.picked = b.dataset.t;
    KQ.done = true;
    KQ.gained = KQ.picked === q.title ? kqPoints(KQ.revealed) : 0;
    KQ.score += KQ.gained;
    KQ.revealed = total;
    kqRender();
    area.querySelectorAll(".quiz-opt").forEach(x => {
      if (x.dataset.t === q.title) x.classList.add("correct");
      else if (x.dataset.t === KQ.picked) x.classList.add("wrong");
      x.disabled = true;
    });
  }));
  const next = document.getElementById("kqNext");
  if (next) next.addEventListener("click", () => {
    KQ.i++;
    if (KQ.i >= KQ.list.length) { kqResult(); return; }
    KQ.revealed = KQ_FIRST; KQ.answering = false; KQ.done = false; KQ.picked = null;
    KQ.choices = kqChoices(KQ.list[KQ.i]);
    kqRender();
  });
}
function kqChoices(q) {
  const sameGroup = KQ.songs.filter(s => s.title !== q.title && s.group === q.group);
  const others = KQ.songs.filter(s => s.title !== q.title && s.group !== q.group);
  const decoys = kqShuffle(sameGroup).slice(0, 3);
  if (decoys.length < 3) decoys.push(...kqShuffle(others).slice(0, 3 - decoys.length));
  return kqShuffle([q.title, ...decoys.map(s => s.title)]);
}
function kqResult() {
  const area = document.getElementById("kqArea");
  const max = KQ.list.length * 100;
  area.innerHTML = `<div class="card" style="margin-bottom:40px"><h3>結果</h3>
  <p class="score">${KQ.score} / ${max} 点</p>
  <p>${KQ.score >= max * 0.8 ? "すごい！かなりの早さで分かりましたね。" : KQ.score >= max * 0.5 ? "なかなかの勘の良さです。" : KQ.score >= max * 0.3 ? "もう少し早く当てられるようになると、さらに楽しいですよ。" : "漢字の並びから曲を当てるのは意外と難しいですよね。"}</p>
  <p><button type="button" class="primary" onclick="location.reload()">モード選択に戻る</button></p></div>`;
}
function kqStartPanel(data, songs) {
  const area = document.getElementById("kqArea");
  const counts = {};
  for (const e of data) counts[e.group] = (counts[e.group] || 0) + 1;
  const groups = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  let mode = "all";
  const chips = [`<button type="button" class="ychip on" data-m="all">すべて（${data.length}曲）</button>`,
    ...groups.map(g => `<button type="button" class="ychip" data-m="${esc(g)}">${esc(g)}（${counts[g]}曲）</button>`)].join("");
  area.innerHTML = `<div class="card" style="margin-bottom:40px"><h3>モードを選んでください</h3>
  <p style="color:var(--muted)">グループ別に絞って遊べます。収録曲が10曲未満のモードは、ある曲すべてが出題されます。</p>
  <div class="filters" style="margin:10px 0">${chips}</div>
  <p><button type="button" class="primary" id="kqStart">スタート</button></p></div>`;
  area.querySelectorAll("[data-m]").forEach(b => b.addEventListener("click", () => {
    mode = b.dataset.m;
    area.querySelectorAll("[data-m]").forEach(x => x.classList.toggle("on", x === b));
  }));
  document.getElementById("kqStart").addEventListener("click", () => {
    const pool = mode === "all" ? data : data.filter(e => e.group === mode);
    KQ = { list: kqShuffle(pool).slice(0, KQ_MAX), songs, mode,
           i: 0, score: 0, revealed: KQ_FIRST, answering: false, done: false, picked: null, gained: 0, choices: [] };
    KQ.choices = kqChoices(KQ.list[0]);
    kqRender();
  });
}
async function kqInit() {
  const area = document.getElementById("kqArea");
  const data = await loadJSON("lyrics-quiz.json");
  const songs = await loadJSON("songs.json");
  if (!Array.isArray(data) || !data.length) {
    area.innerHTML = `<div class="card"><p>出題データがまだありません。</p></div>`;
    return;
  }
  kqStartPanel(data, Array.isArray(songs) ? songs : []);
}
document.addEventListener("DOMContentLoaded", kqInit);
