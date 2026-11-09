// AI画像クイズ（プレビュー）：曲名の字面だけでAI生成した画像から元の曲を当てるクイズ（全10問）
// 択一式＝1問100点・ヒントなし／記述式＝1問300点・段階ヒントで減点、サジェスト＋「回答する」ボタンでのみ確定
const AIQ_N = 10;
const AIQ_PTS = [300, 240, 180, 120, 60];
let SONGS = [], GROUPS = [];
let mode = "choice", groupSel = "all";
let qs = [], qi = 0, score = 0, results = [], hintsOpen = 0, answered = false;
function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function poolNow() { return groupSel === "all" ? SONGS : SONGS.filter(s => s.group === groupSel); }
function bestKey() { return `aiq:${mode}:${groupSel}`; }
function condText() { return `${mode === "choice" ? "択一式" : "記述式"}・${groupSel === "all" ? "全グループ" : groupSel}`; }
function pickSongs(pool, n) {
  let picks = quizPick("aiq", pool, Math.min(n, pool.length), s => s.id);
  const cyc = shuffle(pool);
  let i = 0;
  while (picks.length < n && cyc.length) { picks.push(cyc[i % cyc.length]); i++; }
  return picks.slice(0, n).map(song => ({ song, img: song.images[Math.floor(Math.random() * song.images.length)] }));
}
function hintStages(song) {
  const st = [];
  if (groupSel === "all") st.push({ lab: "グループ", val: song.group });
  st.push({ lab: "リリース年", val: song.year + "年" });
  st.push({ lab: "分類", val: song.type });
  if (song.center) st.push({ lab: "センター", val: song.center });
  else st.push({ lab: "文字数", val: `曲名の文字数（表記）：${song.chars}文字` });
  return st;
}
function norm(s) { return kanaNorm(s).replace(/[\s　]/g, ""); }
function render() {
  const main = document.getElementById("aiqMain");
  if (qi >= qs.length) {
    const max = AIQ_N * (mode === "choice" ? 100 : 300);
    const bestIsNew = quizBestSave(bestKey(), score);
    const bestNow = quizBest(bestKey());
    main.innerHTML = `<div class="mz-result"><h3>結果：${score}点 ／ ${max}点</h3>
      ${bestNow > 0 ? `<p style="color:var(--muted)">${bestIsNew ? "自己ベスト更新！" : `自己ベスト：${bestNow}点`}</p>` : ""}
      <div class="mz-rows">${results.map((r, i) => `<p>${i + 1}問目：${esc(r.mine)} ― ${r.ok ? `<b>${r.pts}点</b>${mode === "type" ? `（ヒント${r.hints}つ）` : ""}` : `不正解（正解は${esc(r.song.title)}）`}</p>`).join("")}</div>
      <div class="gacha-btns"><button type="button" class="btn" id="aiqRetry">もう一度遊ぶ</button><button type="button" class="btn sub" id="aiqShare">結果を共有する</button></div></div>`;
    document.getElementById("aiqRetry").addEventListener("click", startPanel);
    document.getElementById("aiqShare").addEventListener("click", e => shareScoreImage({ game: "AI画像クイズ", cond: condText(), score: `${score}点／${max}点`, lines: results.map((r, i) => `${i + 1}問目 ${r.mine}：${r.ok ? r.pts + "点" : "不正解（正解は" + r.song.title + "）"}`) }, e.target));
    return;
  }
  const { song, img } = qs[qi];
  hintsOpen = 0; answered = false;
  const imgUrl = BASE + "assets/ai-quiz/" + img;
  if (mode === "choice") {
    const others = shuffle(poolNow().filter(s => s.id !== song.id && s.group === song.group));
    const rest = shuffle(poolNow().filter(s => s.id !== song.id && s.group !== song.group));
    const choices = shuffle([song, ...others.concat(rest).slice(0, 3)]);
    main.innerHTML = `<div class="mz-head"><span>第${qi + 1}問 ／ ${AIQ_N}問</span><span>スコア：${score}点</span><span>正解で100点</span></div>
      <div class="aiq-stage"><img src="${imgUrl}" alt="AI生成画像"></div>
      <div class="mz-choices">${choices.map(c => `<button type="button" class="mz-choice" data-id="${esc(c.id)}">${esc(c.title)}</button>`).join("")}</div>
      <p class="mz-msg" id="aiqMsg"></p>`;
    main.querySelectorAll(".mz-choice").forEach(b => b.addEventListener("click", () => {
      if (answered) return;
      answered = true;
      const ok = b.dataset.id === song.id;
      const pts = ok ? 100 : 0;
      score += pts;
      const mine = choices.find(c => c.id === b.dataset.id).title;
      results.push({ song, mine, ok, pts, hints: 0 });
      main.querySelectorAll(".mz-choice").forEach(x => { x.disabled = true; if (x.dataset.id === song.id) x.classList.add("ok"); else if (x === b) x.classList.add("ng"); });
      document.getElementById("aiqMsg").innerHTML = ok ? `<b>正解！ 100点</b>（${esc(song.title)}）` : `残念…正解は <b>${esc(song.title)}</b> でした`;
      showNext(main);
    }));
  } else {
    const stages = hintStages(song);
    main.innerHTML = `<div class="mz-head"><span>第${qi + 1}問 ／ ${AIQ_N}問</span><span>スコア：${score}点</span><span id="aiqPtsLab">今答えると${AIQ_PTS[0]}点</span></div>
      <div class="aiq-stage"><img src="${imgUrl}" alt="AI生成画像"></div>
      <div class="aiq-hints">${stages.map((h, i) => `<div class="aiq-hint"><span class="aiq-hint-lab">ヒント${i + 1}</span><span id="aiqHintVal${i}" style="display:none">${esc(h.lab)}：${esc(h.val)}</span><button type="button" class="btn sub" data-hint="${i}">ヒントを開く（${esc(h.lab)}）</button></div>`).join("")}</div>
      <div class="aiq-input"><input type="text" id="aiqInput" placeholder="曲名を入力" autocomplete="off"><div class="aiq-sugg" id="aiqSugg" style="display:none"></div></div>
      <button type="button" class="primary aiq-submit" id="aiqSubmit">回答する</button>
      <p class="mz-msg" id="aiqMsg"></p>`;
    const input = document.getElementById("aiqInput");
    const sugg = document.getElementById("aiqSugg");
    const updPts = () => { const el = document.getElementById("aiqPtsLab"); if (el) el.textContent = `今答えると${AIQ_PTS[Math.min(hintsOpen, AIQ_PTS.length - 1)]}点`; };
    main.querySelectorAll("[data-hint]").forEach(btn => btn.addEventListener("click", () => {
      if (answered) return;
      const i = +btn.dataset.hint;
      document.getElementById("aiqHintVal" + i).style.display = "";
      btn.style.display = "none";
      hintsOpen++;
      updPts();
    }));
    input.addEventListener("input", () => {
      const q = norm(input.value);
      if (!q) { sugg.style.display = "none"; return; }
      const cand = poolNow().filter(s => norm(s.title).includes(q) || norm(s.yomi).includes(q)).slice(0, 6);
      if (!cand.length) { sugg.style.display = "none"; return; }
      sugg.innerHTML = cand.map(s => `<button type="button" data-t="${esc(s.title)}">${esc(s.title)}</button>`).join("");
      sugg.style.display = "";
      sugg.querySelectorAll("button").forEach(b => b.addEventListener("click", () => { input.value = b.dataset.t; sugg.style.display = "none"; input.focus(); }));
    });
    document.getElementById("aiqSubmit").addEventListener("click", () => {
      if (answered) return;
      const mine = input.value.trim();
      if (!mine) { document.getElementById("aiqMsg").textContent = "曲名を入力してください。"; return; }
      answered = true;
      const ok = norm(mine) === norm(song.title) || norm(mine) === norm(song.yomi);
      const pts = ok ? AIQ_PTS[Math.min(hintsOpen, AIQ_PTS.length - 1)] : 0;
      score += pts;
      results.push({ song, mine, ok, pts, hints: hintsOpen });
      input.disabled = true;
      document.getElementById("aiqSubmit").disabled = true;
      sugg.style.display = "none";
      document.getElementById("aiqMsg").innerHTML = ok ? `<b>正解！ ${pts}点</b>（${esc(song.title)}）` : `残念…正解は <b>${esc(song.title)}</b> でした`;
      showNext(main);
    });
  }
}
function showNext(main) {
  const last = qi >= qs.length - 1;
  const nav = document.createElement("p");
  nav.innerHTML = `<button type="button" class="btn" id="aiqGoNext">${last ? "結果を見る" : "次の問題へ"}</button>`;
  main.appendChild(nav);
  document.getElementById("aiqGoNext").addEventListener("click", () => { qi++; render(); });
}
function start() {
  const pool = poolNow();
  if (!pool.length) return;
  qs = pickSongs(pool, AIQ_N);
  qi = 0; score = 0; results = [];
  render();
}
function startPanel() {
  const main = document.getElementById("aiqMain");
  const lite = document.documentElement.dataset.lite === "1";
  main.innerHTML = `<div class="card"><h3>遊び方</h3>
  <p style="color:var(--muted)">${lite ? `曲名の字面だけで作ったAI画像から元の曲を当てる全${AIQ_N}問。択一式と記述式が選べます。` : `画像は曲名の字面だけをもとにAIが作ったもので、曲名の文字は入っていません。1曲に10枚の画像があり、出題ごとに1枚がランダムで出ます。全${AIQ_N}問。<br>択一式は正解で100点（ヒントなし）。記述式はヒントなしで正解＝300点、ヒントを開くごとに240／180／120／60点と下がります。ヒントはグループ→リリース年→分類→センターの順で、センターがない曲では代わりに「曲名の文字数（表記）」が出ます。グループを絞るとグループのヒントは出ません。記述式は候補から選んでも確定せず、「回答する」ボタンを押したときだけ回答になります。`}</p>
  <div class="aiq-set">
    <div><h4>回答方法</h4><div class="aiq-chips" id="aiqModeChips">
      <button type="button" class="ychip ${mode === "choice" ? "on" : ""}" data-m="choice">択一式</button>
      <button type="button" class="ychip ${mode === "type" ? "on" : ""}" data-m="type">記述式</button></div></div>
    <div><h4>グループ</h4><div class="aiq-chips" id="aiqGroupChips">
      <button type="button" class="ychip ${groupSel === "all" ? "on" : ""}" data-g="all">すべて</button>
      ${GROUPS.map(g => `<button type="button" class="ychip ${groupSel === g ? "on" : ""}" data-g="${esc(g)}">${esc(g)}</button>`).join("")}</div></div>
  </div>
  <p style="color:var(--muted)" id="aiqBestLine">${quizBest(bestKey()) ? `自己ベスト（${condText()}）：${quizBest(bestKey())}点` : ""}</p>
  <p><button type="button" class="primary" id="aiqStart">スタート</button></p></div>`;
  main.querySelectorAll("#aiqModeChips .ychip").forEach(c => c.addEventListener("click", () => { mode = c.dataset.m; startPanel(); }));
  main.querySelectorAll("#aiqGroupChips .ychip").forEach(c => c.addEventListener("click", () => { groupSel = c.dataset.g; startPanel(); }));
  document.getElementById("aiqStart").addEventListener("click", start);
}
async function init() {
  const data = await loadJSON("ai-quiz.json");
  SONGS = (data && data.songs) || [];
  GROUPS = [...new Set(SONGS.map(s => s.group))];
  const order = ["乃木坂46", "櫻坂46", "欅坂46", "日向坂46", "けやき坂46"];
  GROUPS.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (SONGS.length < 1) { document.getElementById("aiqMain").innerHTML = `<p style="color:var(--muted)">画像データがまだありません。</p>`; return; }
  startPanel();
}
init();
