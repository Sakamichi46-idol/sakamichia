// スクラッチクイズ（プレビュー）：最新アー写を覆いで隠し、指でこすって少しずつ見せながら当てる4択クイズ（全5問）
// 得点は回答時点の「覆いの残り割合」で決まる：残り100%＝100点、全部削ると最低5点
const SC_N = 5;
const SC_W = 480, SC_H = 640, SC_BRUSH = 30;
let POOL = [], MEMBERS = [], PHOTOS = {}, GAL = {};
let qs = [], qi = 0, score = 0, results = [];
let ratio = 0, answered = false, scratching = false, lastPt = null, sampleBusy = false;
const FAMILY = { "乃木坂46": "n", "櫻坂46": "s", "欅坂46": "s", "日向坂46": "h", "けやき坂46": "h" };
function galLatestURL(name) {
  const g = GAL[name]; if (!g || !g.length || !PHOTOS[name]) return "";
  return BASE + "assets/member-gallery/" + PHOTOS[name].replace(/\.jpg$/, "") + "/" + g[g.length - 1].f;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function pickQuestions() {
  const names = quizPick("scratch", POOL, SC_N, n => n);
  return names.map(name => {
    const m = MEMBERS.find(x => x.name === name);
    const fam = FAMILY[m.group] || "";
    let cand = MEMBERS.filter(x => x.name !== name && (FAMILY[x.group] || "") === fam && POOL.includes(x.name));
    cand = shuffle(cand).slice(0, 3);
    if (cand.length < 3) cand = cand.concat(shuffle(POOL.filter(n => n !== name && !cand.some(c => c.name === n))).slice(0, 3 - cand.length).map(n => MEMBERS.find(x => x.name === n)));
    return { name, choices: shuffle([name, ...cand.map(c => c.name)]) };
  });
}
function pointsNow() { return ratio <= 0 ? 100 : Math.max(5, Math.round(100 * (1 - ratio))); }
const samp = document.createElement("canvas"); samp.width = 48; samp.height = 64;
function measureRatio(coverCv) {
  const sctx = samp.getContext("2d", { willReadFrequently: true });
  sctx.clearRect(0, 0, 48, 64);
  sctx.drawImage(coverCv, 0, 0, 48, 64);
  const d = sctx.getImageData(0, 0, 48, 64).data;
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) { if (d[i] < 128) clear++; }
  return clear / (48 * 64);
}
function render() {
  const main = document.getElementById("scMain");
  if (qi >= qs.length) {
    const max = SC_N * 100;
    const bestIsNew = quizBestSave("scratch", score);
    const bestNow = quizBest("scratch");
    main.innerHTML = `<div class="mz-result"><h3>結果：${score}点 ／ ${max}点</h3>
      ${bestNow > 0 ? `<p style="color:var(--muted)">${bestIsNew ? "自己ベスト更新！" : `自己ベスト：${bestNow}点`}</p>` : ""}
      <div class="mz-rows">${results.map((r, i) => `<p>${i + 1}問目：${esc(r.mine)} ― ${r.ok ? `<b>${r.pts}点</b>（削った割合 ${r.pct}%）` : `不正解（正解は${esc(r.name)}）`}</p>`).join("")}</div>
      <div class="gacha-btns"><button type="button" class="btn" id="scRetry">もう一度遊ぶ</button><button type="button" class="btn sub" id="scShare">結果を共有する</button></div></div>`;
    document.getElementById("scRetry").addEventListener("click", start);
    document.getElementById("scShare").addEventListener("click", e => shareScoreImage({ game: "スクラッチクイズ", score: `${score}点／${max}点`, lines: results.map((r, i) => `${i + 1}問目 ${r.mine}：${r.ok ? r.pts + "点（削った割合" + r.pct + "%）" : "不正解（正解は" + r.name + "）"}`) }, e.target));
    return;
  }
  const q = qs[qi];
  ratio = 0; answered = false; scratching = false; lastPt = null;
  main.innerHTML = `<div class="mz-head"><span>第${qi + 1}問 ／ ${SC_N}問</span><span>スコア：${score}点</span><span id="scPtsLab">今答えると100点</span></div>
    <div class="sc-meter"><div class="sc-meter-bar" id="scMeter"></div></div>
    <div class="mz-stage sc-stage"><img id="scPhoto" alt=""><canvas id="scCover" width="${SC_W}" height="${SC_H}"></canvas>
    <div class="sc-cover-label" id="scCoverLabel"><span class="sc-cover-en">SCRATCH</span><span>こすってめくる</span></div></div>
    <div class="mz-choices">${q.choices.map(c => `<button type="button" class="mz-choice" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <p class="mz-msg" id="scMsg"></p>`;
  const photoImg = document.getElementById("scPhoto");
  const coverCv = document.getElementById("scCover");
  const cctx = coverCv.getContext("2d");
  cctx.globalCompositeOperation = "source-over";
  cctx.fillStyle = "#cfc2de";
  cctx.fillRect(0, 0, SC_W, SC_H);
  cctx.strokeStyle = "rgba(255,255,255,.55)";
  cctx.lineWidth = 2;
  cctx.strokeRect(14, 14, SC_W - 28, SC_H - 28);
  const updLab = () => {
    const lab = document.getElementById("scPtsLab");
    if (lab) lab.textContent = `今答えると${pointsNow()}点`;
    const meter = document.getElementById("scMeter");
    if (meter) meter.style.width = `${Math.round((1 - ratio) * 100)}%`;
  };
  const sample = () => {
    if (sampleBusy || answered) return;
    sampleBusy = true;
    requestAnimationFrame(() => {
      ratio = measureRatio(coverCv);
      sampleBusy = false;
      updLab();
      const lbl = document.getElementById("scCoverLabel");
      if (lbl && ratio > 0.005) lbl.style.display = "none";
    });
  };
  const ptOf = e => {
    const r = coverCv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * SC_W / r.width, y: (e.clientY - r.top) * SC_H / r.height };
  };
  const drawDot = p => {
    cctx.globalCompositeOperation = "destination-out";
    cctx.beginPath(); cctx.arc(p.x, p.y, SC_BRUSH, 0, Math.PI * 2); cctx.fill();
  };
  const drawLine = (a, b) => {
    cctx.globalCompositeOperation = "destination-out";
    cctx.strokeStyle = "rgba(0,0,0,1)";
    cctx.lineWidth = SC_BRUSH * 2; cctx.lineCap = "round"; cctx.lineJoin = "round";
    cctx.beginPath(); cctx.moveTo(a.x, a.y); cctx.lineTo(b.x, b.y); cctx.stroke();
  };
  coverCv.addEventListener("pointerdown", e => {
    if (answered) return;
    e.preventDefault();
    coverCv.setPointerCapture(e.pointerId);
    scratching = true;
    lastPt = ptOf(e);
    drawDot(lastPt);
    sample();
  });
  coverCv.addEventListener("pointermove", e => {
    if (!scratching || answered) return;
    e.preventDefault();
    const p = ptOf(e);
    if (lastPt) drawLine(lastPt, p);
    lastPt = p;
    sample();
  });
  const endScratch = () => { scratching = false; lastPt = null; sample(); };
  coverCv.addEventListener("pointerup", endScratch);
  coverCv.addEventListener("pointercancel", endScratch);
  const showNext = () => {
    const last = qi >= qs.length - 1;
    const nav = document.createElement("p");
    nav.innerHTML = `<button type="button" class="btn" id="scGoNext">${last ? "結果を見る" : "次の問題へ"}</button>`;
    main.appendChild(nav);
    document.getElementById("scGoNext").addEventListener("click", () => { qi++; render(); });
  };
  photoImg.addEventListener("error", () => {
    if (answered) return;
    answered = true;
    document.getElementById("scMsg").textContent = "写真を読み込めませんでした。この問題は不正解になります。";
    results.push({ name: q.name, mine: "（写真を表示できませんでした）", ok: false, pts: 0, pct: 0 });
    showNext();
  });
  photoImg.src = galLatestURL(q.name);
  main.querySelectorAll(".mz-choice").forEach(b => b.addEventListener("click", () => {
    if (answered) return;
    answered = true;
    ratio = measureRatio(coverCv);
    const ok = b.dataset.c === q.name;
    const pts = ok ? pointsNow() : 0;
    const pct = Math.round(ratio * 100);
    score += pts;
    results.push({ name: q.name, mine: b.dataset.c, ok, pts, pct });
    // 覆いを全部はがして正解の写真を見せる
    cctx.globalCompositeOperation = "destination-out";
    cctx.fillRect(0, 0, SC_W, SC_H);
    const lbl = document.getElementById("scCoverLabel");
    if (lbl) lbl.style.display = "none";
    main.querySelectorAll(".mz-choice").forEach(x => { x.disabled = true; if (x.dataset.c === q.name) x.classList.add("ok"); else if (x === b) x.classList.add("ng"); });
    document.getElementById("scMsg").innerHTML = ok ? `<b>正解！ ${pts}点</b>（${esc(q.name)}／削った割合 ${pct}%）` : `残念…正解は <b>${esc(q.name)}</b> でした`;
    showNext();
  }));
}
function start() { qs = pickQuestions(); qi = 0; score = 0; results = []; render(); }
function startPanel() {
  const main = document.getElementById("scMain");
  main.innerHTML = `<div class="card"><h3>遊び方</h3>
  <p style="color:var(--muted)">${document.documentElement.dataset.lite === "1" ? `覆いをこすって写真を少しずつ見せ、誰か当てる全${SC_N}問。削る面積が小さいほど高得点。` : `写真は覆いで隠れています。指（マウス）でこすった所だけ写真が見えるので、少しずつめくりながら誰か当ててください。得点は回答した時点で残っている覆いの割合で決まります（ほとんど削らずに正解＝100点、全部削ってから正解＝5点）。回答は1回だけ。全${SC_N}問です。`}</p>
  ${quizBest("scratch") ? `<p style="color:var(--muted)">自己ベスト：${quizBest("scratch")}点</p>` : ""}
  <p><button type="button" class="primary" id="scStart">スタート</button></p></div>`;
  document.getElementById("scStart").addEventListener("click", start);
}
async function init() {
  const [members, photos, gals] = await Promise.all([loadJSON("members.json"), loadJSON("member-photos.json"), loadJSON("member-galleries.json")]);
  MEMBERS = members || []; PHOTOS = photos || {}; GAL = gals || {};
  POOL = MEMBERS.map(m => m.name).filter(n => GAL[n] && GAL[n].length && PHOTOS[n]);
  if (POOL.length < SC_N) { document.getElementById("scMain").innerHTML = `<p style="color:var(--muted)">写真データが足りません。</p>`; return; }
  startPanel();
}
init();
