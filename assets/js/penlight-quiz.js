// サイリウムクイズ：メンバーのペンライトカラー（2色の組み合わせ）を4択で当てる全10問
// 対象は公式に確認できたメンバー（推定扱いのメンバーは出題しない）
const PQ_N = 10, PQ_PTS = 100;
let PQ_POOL = [], PQ_MEMBERS = {}, PQ_COLORS = {}, PQ_PHOTOS = {};
let pqQs = [], pqQi = 0, pqScore = 0, pqResults = [], pqAnswered = false;
function pqShuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function pqPairKey(c) { return [...c].sort().join("|"); }
function pqPairHTML(c) {
  return `<span class="pq-pair">${c.map(x => `<span class="pq-dot" style="background:${esc(PQ_COLORS[x] || "#ccc")}"></span>`).join("")}<span>${esc(c.join(" × "))}</span></span>`;
}
function pqPickQuestions() {
  const names = quizPick("penlight-quiz", PQ_POOL, PQ_N, n => n);
  const allPairs = PQ_POOL.map(n => PQ_COLORS_OF[n]);
  return names.map(name => {
    const correct = PQ_COLORS_OF[name];
    const ck = pqPairKey(correct);
    const seen = new Set([ck]);
    const distract = [];
    for (const p of pqShuffle(allPairs)) {
      const k = pqPairKey(p);
      if (seen.has(k)) continue;
      seen.add(k); distract.push(p);
      if (distract.length >= 3) break;
    }
    return { name, correct, choices: pqShuffle([correct, ...distract]) };
  });
}
let PQ_COLORS_OF = {};
function pqStart() {
  pqQs = pqPickQuestions();
  pqQi = 0; pqScore = 0; pqResults = [];
  pqRender();
}
function pqRender() {
  const main = document.getElementById("pqMain");
  if (pqQi >= pqQs.length) {
    const max = PQ_N * PQ_PTS;
    const bestIsNew = quizBestSave("penlight-quiz", pqScore);
    const bestNow = quizBest("penlight-quiz");
    main.innerHTML = `<div class="mz-result"><h3>結果：${pqScore}点 ／ ${max}点</h3>
      ${bestNow > 0 ? `<p style="color:var(--muted)">${bestIsNew ? "自己ベスト更新！" : `自己ベスト：${bestNow}点`}</p>` : ""}
      <div class="mz-rows">${pqResults.map((r, i) => `<p>${i + 1}問目：${esc(r.name)} ― ${r.ok ? `<b>${PQ_PTS}点</b>（${esc(r.correct.join(" × "))}）` : `不正解（正解は${esc(r.correct.join(" × "))}）`}</p>`).join("")}</div>
      <div class="gacha-btns"><button type="button" class="btn" id="pqRetry">もう一度遊ぶ</button><button type="button" class="btn sub" id="pqShare">結果を共有する</button></div></div>`;
    document.getElementById("pqRetry").addEventListener("click", pqStart);
    document.getElementById("pqShare").addEventListener("click", e => shareScoreImage({
      game: "サイリウムクイズ", score: `${pqScore}点／${max}点`, cond: "全10問",
      lines: pqResults.map((r, i) => `${i + 1}問目 ${r.name}：${r.ok ? PQ_PTS + "点" : "不正解（正解は" + r.correct.join("×") + "）"}`),
    }, e.target));
    return;
  }
  const q = pqQs[pqQi];
  const m = PQ_MEMBERS[q.name] || {};
  const photo = PQ_PHOTOS[q.name] ? BASE + "assets/member-photos/" + PQ_PHOTOS[q.name] : "";
  pqAnswered = false;
  main.innerHTML = `<div class="mz-head"><span>第${pqQi + 1}問 ／ ${PQ_N}問</span><span>スコア：${pqScore}点</span></div>
    ${photo ? `<img class="pq-photo" src="${esc(photo)}" alt="">` : ""}
    <div class="pq-name">${esc(q.name)}</div>
    <div class="pq-sub">${esc(m.group || "")}${m.gen ? ` ${esc(m.gen)}期` : ""}${m.graduated ? "（卒業）" : ""} のサイリウムカラーは？</div>
    <div class="mz-choices">${q.choices.map((c, i) => `<button type="button" class="mz-choice" data-i="${i}">${pqPairHTML(c)}</button>`).join("")}</div>
    <p class="mz-msg" id="pqMsg"></p><div class="gacha-btns" id="pqNav"></div>`;
  main.querySelectorAll(".mz-choice").forEach(btn => btn.addEventListener("click", () => pqAnswer(q, +btn.dataset.i, btn)));
}
function pqAnswer(q, idx, btn) {
  if (pqAnswered) return;
  pqAnswered = true;
  const picked = q.choices[idx];
  const ok = pqPairKey(picked) === pqPairKey(q.correct);
  if (ok) pqScore += PQ_PTS;
  pqResults.push({ name: q.name, correct: q.correct, ok });
  document.querySelectorAll("#pqMain .mz-choice").forEach(b => {
    b.disabled = true;
    const c = q.choices[+b.dataset.i];
    if (pqPairKey(c) === pqPairKey(q.correct)) b.classList.add("ok");
    else if (b === btn) b.classList.add("ng");
  });
  document.getElementById("pqMsg").innerHTML = ok
    ? `<b>正解！</b> ${esc(q.name)}のサイリウムカラーは ${esc(q.correct.join(" × "))} です。`
    : `不正解… 正解は ${esc(q.correct.join(" × "))} でした。`;
  const last = pqQi >= pqQs.length - 1;
  const nav = document.getElementById("pqNav");
  nav.innerHTML = `<button type="button" class="btn" id="pqNext">${last ? "結果を見る" : "次の問題へ"}</button>`;
  document.getElementById("pqNext").addEventListener("click", () => { pqQi++; pqRender(); });
}
async function pqInit() {
  const [penlight, members, photos] = await Promise.all([
    loadJSON("penlight.json"), loadJSON("members.json"), loadJSON("member-photos.json")]);
  PQ_COLORS = (penlight && penlight.colors) || {};
  PQ_PHOTOS = photos || {};
  (members || []).forEach(m => PQ_MEMBERS[m.name] = m);
  const entries = (penlight && penlight.members) || {};
  PQ_POOL = Object.keys(entries).filter(n => !entries[n].approx && PQ_MEMBERS[n]);
  PQ_POOL.forEach(n => PQ_COLORS_OF[n] = entries[n].c);
  const main = document.getElementById("pqMain");
  const best = quizBest("penlight-quiz");
  main.innerHTML = `<div class="mz-result"><h3>サイリウムクイズ</h3>
    <p>メンバーのサイリウムカラー（2色）を当てる全${PQ_N}問クイズです。1問${PQ_PTS}点、全${PQ_N * PQ_PTS}点満点。</p>
    ${best > 0 ? `<p style="color:var(--muted)">自己ベスト：${best}点</p>` : ""}
    <div class="gacha-btns"><button type="button" class="btn" id="pqGo">スタート</button></div></div>`;
  document.getElementById("pqGo").addEventListener("click", pqStart);
}
pqInit();
