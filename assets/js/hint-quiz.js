// 段階ヒント曲当てクイズ：ヒントを1つずつ開き、開いた段階で得点が決まる（時間制限なし）。全5問・4択
const HQ_POINTS = [100, 80, 60, 45, 30, 15];
const HQ_N = 5;
let SONGS = [], FORMS = {}, qs = [], qi = 0, score = 0, stage = 0, answered = false, results = [];
let hqStyle = "choice", hqPool = [];
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
  const centerList = center ? center.split("・").filter(Boolean) : [];
  const initials = centerList.map(c => c.slice(0, 1));
  return [
    `グループは ${s.group}、発売は ${s.year}年`,
    `種別は「${s.type || "不明"}」／収録：${s.release ? relLabel(s.release) : "不明"}`,
    `歌唱・フォーメーション参加は ${parts.length}人`,
    front ? `フォーメーションは ${f.rows.length}列構成、最前列は ${front}人` : `作曲：${(s.writers || []).join("・") || "不明"}`,
    center ? (centerList.length > 1
      ? `センターは${centerList.length}人、名字の頭文字は${initials.map(i => `「${i}」`).join("と")}`
      : `センターの名字の頭文字は「${initials[0]}」`) : `タイトルは ${String(s.title).length}文字`,
    center ? `センターは ${center}` : `タイトルの読みは「${s.yomi || ""}」`
  ];
}
function pickQuestions() {
  const pool = SONGS.filter(s => s.group !== "その他" && participantsOf(s).length >= 3);
  hqPool = pool;
  const picks = quizPick("hint", pool, HQ_N, s => s.group + "|" + s.title);
  return picks.map(s => {
    const same = shuffle(pool.filter(x => x.title !== s.title && x.group === s.group)).slice(0, 3);
    return { s, hints: hintsOf(s), choices: shuffle([s.title, ...same.map(x => x.title)]) };
  });
}
function render() {
  const main = document.getElementById("hqMain");
  if (qi >= qs.length) {
    const max = HQ_N * 100;
    const bestIsNew = quizBestSave("hint", score);
    const bestNow = quizBest("hint");
    main.innerHTML = `<div class="mz-result"><h3>結果：${score}点 ／ ${max}点</h3>
      ${bestNow > 0 ? `<p style="color:var(--muted)">${bestIsNew ? "🎉 自己ベスト更新！" : `自己ベスト：${bestNow}点`}</p>` : ""}
      <div class="mz-rows">${results.map((r, i) => `<p>${i + 1}問目：${esc(r.mine)} ― ${r.ok ? `<b>${r.pts}点</b>（ヒント${r.stage + 1}段階目）` : `不正解（正解は${esc(r.title)}）`}</p>`).join("")}</div>
      <div class="gacha-btns"><button type="button" class="btn" id="hqRetry">もう一度遊ぶ</button><button type="button" class="btn sub" id="hqShare">結果を共有する</button></div></div>`;
    document.getElementById("hqRetry").addEventListener("click", start);
    document.getElementById("hqShare").addEventListener("click", e => shareScoreImage({ game: "段階ヒント曲当てクイズ", score: `${score}点／${max}点`, lines: results.map((r, i) => `${i + 1}問目 ${r.mine}：${r.ok ? r.pts + "点" : "不正解（正解は" + r.title + "）"}`) }, e.target));
    return;
  }
  const q = qs[qi];
  main.innerHTML = `<div class="mz-head"><span>第${qi + 1}問 ／ ${HQ_N}問</span><span>スコア：${score}点</span><span>今答えると ${HQ_POINTS[stage]}点</span></div>
    <div class="hq-hints">${q.hints.map((h, i) => `<p class="hq-hint${i <= stage ? " open" : ""}">${i <= stage ? `<span class="hq-no">ヒント${i + 1}</span>${esc(h)}` : `<span class="hq-no">ヒント${i + 1}</span>？？？`}</p>`).join("")}</div>
    ${stage < q.hints.length - 1 && !answered ? `<p><button type="button" class="btn sub" id="hqNext">次のヒントを開く（得点は${HQ_POINTS[stage + 1]}点に）</button></p>` : ""}
    ${hqStyle === "input"
      ? `<div class="fq-inputrow"><input id="hqInput" type="text" placeholder="曲名を入力（候補を選ぶと入力されます）" autocomplete="off"><button type="button" class="btn" id="hqAnswer">回答する</button></div>`
      : `<div class="mz-choices">${q.choices.map(c => `<button type="button" class="mz-choice" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>`}
    <p class="mz-msg" id="hqMsg"></p>`;
  const next = document.getElementById("hqNext");
  if (next) next.addEventListener("click", () => { stage++; render(); });
  const judge = picked => {
    if (answered) return;
    answered = true;
    const ok = picked === q.s.title;
    const pts = ok ? HQ_POINTS[stage] : 0;
    score += pts;
    results.push({ title: q.s.title, mine: picked, ok, pts, stage });
    main.querySelectorAll(".mz-choice").forEach(x => { x.disabled = true; if (x.dataset.c === q.s.title) x.classList.add("ok"); else if (x.dataset.c === picked) x.classList.add("ng"); });
    const inp = document.getElementById("hqInput");
    if (inp) { inp.disabled = true; const ab = document.getElementById("hqAnswer"); if (ab) ab.disabled = true; }
    const hnb = document.getElementById("hqNext");
    if (hnb) hnb.remove();
    const last = qi >= qs.length - 1;
    document.getElementById("hqMsg").innerHTML = ok ? `<b>正解！ ${pts}点</b>` : `残念…正解は <b>${esc(q.s.title)}</b> でした`;
    const nav = document.createElement("p");
    nav.innerHTML = `<button type="button" class="btn" id="hqGoNext">${last ? "結果を見る" : "次の問題へ"}</button>`;
    main.appendChild(nav);
    document.getElementById("hqGoNext").addEventListener("click", () => { qi++; stage = 0; answered = false; render(); });
  };
  main.querySelectorAll(".mz-choice").forEach(b => b.addEventListener("click", () => judge(b.dataset.c)));
  const hqIn = document.getElementById("hqInput");
  if (hqIn) {
    const answerTyped = () => {
      const norm = v => kanaNorm(String(v || "").toLowerCase()).replace(/[\s　]/g, "");
      const nv = norm(hqIn.value);
      if (!nv) return;
      const hit = hqPool.find(s => norm(s.title) === nv || norm(s.yomi || "") === nv);
      if (!hit) {
        document.getElementById("hqMsg").innerHTML = "その曲名は見つかりませんでした。下に出る候補から選んでください。";
        hqIn.setAttribute("aria-invalid", "true");
        return;
      }
      judge(hit.title);
    };
    // 候補を選んでも・Enterを押しても回答にはならない。回答は「回答する」ボタンのみ（ユーザー要望 2026-11-02）
    attachSuggest(hqIn, query => {
      const nq = kanaNorm(query.toLowerCase());
      const hits = t => kanaNorm(String(t || "").toLowerCase()).includes(nq);
      return hqPool.filter(s => hits(s.title) || hits(s.yomi))
        .map(s => ({ kind: "楽曲", cls: "song", label: s.title, sub: `${s.group}・${s.year}年` }));
    }, (it, input) => { input.value = it.label; input.removeAttribute("aria-invalid"); input.focus(); });
    document.getElementById("hqAnswer").addEventListener("click", answerTyped);
  }
}
function start() { qs = pickQuestions(); qi = 0; score = 0; stage = 0; answered = false; results = []; render(); }
function startPanel() {
  const main = document.getElementById("hqMain");
  main.innerHTML = `<div class="card"><h3>遊び方</h3>
  <p style="color:var(--muted)">${document.documentElement.dataset.lite === "1" ? `ヒントを開いて曲名を当てる全${HQ_N}問。早く答えるほど高得点、時間制限なし。` : `ヒントを1つずつ開いて曲名を当てる全${HQ_N}問のクイズです。早く答えるほど高得点（ヒント1で正解＝100点〜ヒント6＝15点）。時間制限はありません。`}</p>
  ${quizBest("hint") ? `<p style="color:var(--muted)">自己ベスト：${quizBest("hint")}点</p>` : ""}
  <h4 style="margin:14px 0 6px">回答方式</h4>
  <div class="filters" style="margin:6px 0 10px"><button type="button" class="ychip${hqStyle === "choice" ? " on" : ""}" data-s="choice">4択式</button><button type="button" class="ychip${hqStyle === "input" ? " on" : ""}" data-s="input">記述式（候補サジェスト付き）</button></div>
  <p><button type="button" class="primary" id="hqStart">スタート</button></p></div>`;
  main.querySelectorAll("[data-s]").forEach(b => b.addEventListener("click", () => {
    hqStyle = b.dataset.s;
    main.querySelectorAll("[data-s]").forEach(x => x.classList.toggle("on", x === b));
  }));
  document.getElementById("hqStart").addEventListener("click", start);
}
async function init() {
  const [songs, forms] = await Promise.all([loadJSON("songs.json"), loadJSON("formations.json")]);
  SONGS = songs || []; FORMS = forms || {};
  startPanel();
}
init();
