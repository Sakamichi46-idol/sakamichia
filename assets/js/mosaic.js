// モザイククイズ：最新アー写だけを対象に、モザイクが2秒ごとに解けていく4択クイズ（全5問）
// 段階の粗さと得点はプレビューv3の調整値をそのまま採用
const MZ_STAGES = [6, 9, 13, 18, 25, 34, 46, 62, 84, 114, 160, 480];
const MZ_POINTS = [100, 94, 88, 81, 74, 66, 58, 49, 40, 30, 20, 10];
const MZ_N = 5, MZ_DWELL = 2000;
let POOL = [], MEMBERS = [], PHOTOS = {}, GAL = {};
let qs = [], qi = 0, score = 0, stage = 0, timer = null, answered = false, results = [];
const FAMILY = { "乃木坂46": "n", "櫻坂46": "s", "欅坂46": "s", "日向坂46": "h", "けやき坂46": "h" };
function galLatestURL(name) {
  const g = GAL[name]; if (!g || !g.length || !PHOTOS[name]) return "";
  return BASE + "assets/member-gallery/" + PHOTOS[name].replace(/\.jpg$/, "") + "/" + g[g.length - 1].f;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function pickQuestions() {
  const names = shuffle([...POOL]).slice(0, MZ_N);
  return names.map(name => {
    const m = MEMBERS.find(x => x.name === name);
    const fam = FAMILY[m.group] || "";
    let cand = MEMBERS.filter(x => x.name !== name && (FAMILY[x.group] || "") === fam && POOL.includes(x.name));
    cand = shuffle(cand).slice(0, 3);
    if (cand.length < 3) cand = cand.concat(shuffle(POOL.filter(n => n !== name && !cand.some(c => c.name === n))).slice(0, 3 - cand.length).map(n => MEMBERS.find(x => x.name === n)));
    return { name, choices: shuffle([name, ...cand.map(c => c.name)]) };
  });
}
const base = document.createElement("canvas"); base.width = 480; base.height = 640;
const tiny = document.createElement("canvas");
function drawStage(cv, st) {
  const ctx = cv.getContext("2d");
  const w = MZ_STAGES[st], h = Math.round(w * 4 / 3);
  tiny.width = w; tiny.height = h;
  const tctx = tiny.getContext("2d");
  tctx.drawImage(base, 0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(tiny, 0, 0, w, h, 0, 0, cv.width, cv.height);
}
function loadToBase(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const ctx = base.getContext("2d");
      // 480x640 に cover で描く（顔が上に来るよう上寄せ）
      const scale = Math.max(480 / img.width, 640 / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.clearRect(0, 0, 480, 640);
      ctx.drawImage(img, (480 - w) / 2, 0, w, h);
      res();
    };
    img.onerror = rej;
    img.src = url;
  });
}
function render() {
  const main = document.getElementById("mzMain");
  if (qi >= qs.length) {
    const max = MZ_N * 100;
    main.innerHTML = `<div class="mz-result"><h3>結果：${score}点 ／ ${max}点</h3>
      <div class="mz-rows">${results.map((r, i) => `<p>${i + 1}問目：${esc(r.name)} ― ${r.ok ? `<b>${r.pts}点</b>（${r.stage + 1}段階目）` : `不正解（正解は${esc(r.name)}）`}</p>`).join("")}</div>
      <div class="gacha-btns"><button type="button" class="btn" id="mzRetry">もう一度遊ぶ</button><button type="button" class="btn sub" id="mzShare">結果を共有する</button></div></div>`;
    document.getElementById("mzRetry").addEventListener("click", start);
    document.getElementById("mzShare").addEventListener("click", e => shareScoreImage({ game: "モザイククイズ", score: `${score}点／${max}点`, lines: results.map((r, i) => `${i + 1}問目 ${r.name}：${r.ok ? r.pts + "点（" + (r.stage + 1) + "段階目）" : "不正解"}`) }, e.target));
    return;
  }
  const q = qs[qi];
  main.innerHTML = `<div class="mz-head"><span>第${qi + 1}問 ／ ${MZ_N}問</span><span>スコア：${score}点</span><span id="mzStageLab"></span></div>
    <div class="mz-stage"><canvas id="mzCv" width="480" height="640"></canvas></div>
    <div class="mz-choices">${q.choices.map(c => `<button type="button" class="mz-choice" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <p class="mz-msg" id="mzMsg"></p>`;
  const cv = document.getElementById("mzCv");
  stage = 0; answered = false;
  const lab = () => { const el = document.getElementById("mzStageLab"); if (el) el.textContent = `解像度 ${stage + 1}／${MZ_STAGES.length}段階（今答えると${MZ_POINTS[stage]}点）`; };
  loadToBase(galLatestURL(q.name)).then(() => { drawStage(cv, stage); lab(); }).catch(() => {
    document.getElementById("mzMsg").textContent = "写真を読み込めませんでした。次の問題へ進みます。";
    setTimeout(() => { results.push({ name: q.name, ok: false, pts: 0, stage: 0 }); qi++; render(); }, 1200);
  });
  clearInterval(timer);
  timer = setInterval(() => {
    if (answered) return;
    if (stage < MZ_STAGES.length - 1) { stage++; drawStage(cv, stage); lab(); }
  }, MZ_DWELL);
  main.querySelectorAll(".mz-choice").forEach(b => b.addEventListener("click", () => {
    if (answered) return;
    answered = true; clearInterval(timer);
    const ok = b.dataset.c === q.name;
    const pts = ok ? MZ_POINTS[stage] : 0;
    score += pts;
    results.push({ name: q.name, ok, pts, stage });
    // 正解の写真をクリアに表示してから次へ
    drawStage(cv, MZ_STAGES.length - 1);
    main.querySelectorAll(".mz-choice").forEach(x => { x.disabled = true; if (x.dataset.c === q.name) x.classList.add("ok"); else if (x === b) x.classList.add("ng"); });
    document.getElementById("mzMsg").innerHTML = ok ? `<b>正解！ ${pts}点</b>（${esc(q.name)}）` : `残念…正解は <b>${esc(q.name)}</b> でした`;
    setTimeout(() => { qi++; render(); }, 1600);
  }));
}
function start() { qs = pickQuestions(); qi = 0; score = 0; results = []; render(); }
async function init() {
  const [members, photos, gals] = await Promise.all([loadJSON("members.json"), loadJSON("member-photos.json"), loadJSON("member-galleries.json")]);
  MEMBERS = members || []; PHOTOS = photos || {}; GAL = gals || {};
  POOL = MEMBERS.map(m => m.name).filter(n => GAL[n] && GAL[n].length && PHOTOS[n]);
  if (POOL.length < MZ_N) { document.getElementById("mzMain").innerHTML = `<p style="color:var(--muted)">写真データが足りません。</p>`; return; }
  start();
}
init();
