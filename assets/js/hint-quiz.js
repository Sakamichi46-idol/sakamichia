// 段階ヒント曲当てクイズ：ヒントを1つずつ開き、開いた段階で得点が決まる（時間制限なし）。全5問・4択
const HQ_POINTS = [100, 80, 60, 45, 30, 15];
const HQ_N = 5;
let SONGS = [], FORMS = {}, qs = [], qi = 0, score = 0, stage = 0, answered = false, results = [];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function participantsOf(s) {
  const f = FORMS[s.group + "|" + s.title];
  if (!f) return [];
  if (f.rows && f.rows.length) return [...new Set(f.rows.flat())];
  return f.vocal || [];
}
function hintsOf(s) {
  const parts = participantsOf(s);
  const f = FORMS[s.group + "|" + s.title];
  const front = f && f.rows && f.rows.length ? f.rows[f.rows.length - 1].length : 0;
  const center = s.center || "";
  const surname = center ? center.split("・")[0].slice(0, 1) : "";
  return [
    `グループは ${s.group}、発売は ${s.year}年`,
    `種別は「${s.type || "不明"}」／収録：${s.release || "不明"}`,
    `歌唱・フォーメーション参加は ${parts.length}人`,
    front ? `フォーメーションは ${f.rows.length}列構成、最前列は ${front}人` : `作曲：${(s.writers || []).join("・") || "不明"}`,
    center ? `センターの名字の頭文字は「${surname}」` : `タイトルは ${String(s.title).length}文字`,
    center ? `センターは ${center}` : `タイトルの読みは「${s.yomi || ""}」`
  ];
}
function pickQuestions() {
  const pool = SONGS.filter(s => s.group !== "その他" && participantsOf(s).length >= 3);
  const picks = shuffle([...pool]).slice(0, HQ_N);
  return picks.map(s => {
    const same = shuffle(pool.filter(x => x.title !== s.title && x.group === s.group)).slice(0, 3);
    return { s, hints: hintsOf(s), choices: shuffle([s.title, ...same.map(x => x.title)]) };
  });
}
function render() {
  const main = document.getElementById("hqMain");
  if (qi >= qs.length) {
    const max = HQ_N * 100;
    main.innerHTML = `<div class="mz-result"><h3>結果：${score}点 ／ ${max}点</h3>
      <div class="mz-rows">${results.map((r, i) => `<p>${i + 1}問目：${esc(r.title)} ― ${r.ok ? `<b>${r.pts}点</b>（ヒント${r.stage + 1}段階目）` : `不正解（正解は${esc(r.title)}）`}</p>`).join("")}</div>
      <div class="gacha-btns"><button type="button" class="btn" id="hqRetry">もう一度遊ぶ</button><button type="button" class="btn sub" id="hqShare">結果を共有する</button></div></div>`;
    document.getElementById("hqRetry").addEventListener("click", start);
    document.getElementById("hqShare").addEventListener("click", e => shareScoreImage({ game: "段階ヒント曲当てクイズ", score: `${score}点／${max}点`, lines: results.map((r, i) => `${i + 1}問目 ${r.title}：${r.ok ? r.pts + "点" : "不正解"}`) }, e.target));
    return;
  }
  const q = qs[qi];
  main.innerHTML = `<div class="mz-head"><span>第${qi + 1}問 ／ ${HQ_N}問</span><span>スコア：${score}点</span><span>今答えると ${HQ_POINTS[stage]}点</span></div>
    <div class="hq-hints">${q.hints.map((h, i) => `<p class="hq-hint${i <= stage ? " open" : ""}">${i <= stage ? `<span class="hq-no">ヒント${i + 1}</span>${esc(h)}` : `<span class="hq-no">ヒント${i + 1}</span>？？？`}</p>`).join("")}</div>
    ${stage < q.hints.length - 1 && !answered ? `<p><button type="button" class="btn sub" id="hqNext">次のヒントを開く（得点は${HQ_POINTS[stage + 1]}点に）</button></p>` : ""}
    <div class="mz-choices">${q.choices.map(c => `<button type="button" class="mz-choice" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <p class="mz-msg" id="hqMsg"></p>`;
  const next = document.getElementById("hqNext");
  if (next) next.addEventListener("click", () => { stage++; render(); });
  main.querySelectorAll(".mz-choice").forEach(b => b.addEventListener("click", () => {
    if (answered) return;
    answered = true;
    const ok = b.dataset.c === q.s.title;
    const pts = ok ? HQ_POINTS[stage] : 0;
    score += pts;
    results.push({ title: q.s.title, ok, pts, stage });
    main.querySelectorAll(".mz-choice").forEach(x => { x.disabled = true; if (x.dataset.c === q.s.title) x.classList.add("ok"); else if (x === b) x.classList.add("ng"); });
    document.getElementById("hqMsg").innerHTML = ok ? `<b>正解！ ${pts}点</b>` : `残念…正解は <b>${esc(q.s.title)}</b> でした`;
    setTimeout(() => { qi++; stage = 0; answered = false; render(); }, 1500);
  }));
}
function start() { qs = pickQuestions(); qi = 0; score = 0; stage = 0; answered = false; results = []; render(); }
async function init() {
  const [songs, forms] = await Promise.all([loadJSON("songs.json"), loadJSON("formations.json")]);
  SONGS = songs || []; FORMS = forms || {};
  start();
}
init();
