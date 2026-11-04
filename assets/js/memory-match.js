// 神経衰弱：最新アー写のカードをめくって、同じメンバーのペアを揃えるメモリーゲーム
const MM_PAIR_COUNTS = [6, 8, 12];
const MM_DEFAULT_PAIRS = 8;
const MM_FLIP_BACK_MS = 800; // 外れたカードを裏に戻すまでの表示時間
let MEMBERS = [], PHOTOS = {}, GAL = {}, POOL = [];
let selPairs = MM_DEFAULT_PAIRS;
let deck = [], openIdx = [], matchedPairs = 0, moves = 0, lock = false, playing = false;
let startAt = 0, timer = null;
let imgStage = {}; // name -> 表示中の写真ステージ（>=0: ギャラリーの添字（最新が末尾）/ -1: プロフィール写真 / -2: 全て失敗）

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function shuffleR(a, rand) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function fmtTime(sec) { return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }

// 写真URL：モザイククイズ（mosaic.js）と同じギャラリーデータ・同じ作り方
function galURL(name, idx) {
  const g = GAL[name]; if (!g || !g.length || !PHOTOS[name]) return "";
  const e = g[idx]; if (!e) return "";
  return BASE + "assets/member-gallery/" + PHOTOS[name].replace(/\.jpg$/, "") + "/" + e.f;
}
function galLatestURL(name) { return galURL(name, (GAL[name] || []).length - 1); }
function profileURL(name) { return PHOTOS[name] ? BASE + "assets/member-photos/" + PHOTOS[name] : ""; }

// デッキ生成（テストから検証できるよう公開する）：pairCount 人を抽選し、各2枚ずつをシャッフルして返す
// prefer は優先して出すメンバー名の集合（出題の重複回避用。省略時は従来どおり全員から引く）
// 戻り値 [{name, url}, ...]（同じ name がちょうど2枚ずつ、url は最新アー写）
function buildDeck(pairCount, rng, prefer) {
  const rand = rng || Math.random;
  const fresh = prefer ? POOL.filter(n => prefer.has(n)) : [...POOL];
  const names = fresh.length >= pairCount
    ? shuffleR([...fresh], rand).slice(0, pairCount)
    : [...fresh, ...shuffleR(POOL.filter(n => !fresh.includes(n)), rand).slice(0, pairCount - fresh.length)];
  const cards = [];
  names.forEach(name => { cards.push({ name, url: galLatestURL(name) }); cards.push({ name, url: galLatestURL(name) }); });
  return shuffleR(cards, rand);
}
// テスト用：現在のゲーム状態を返す
function __mmState() {
  return { deck: deck.map(c => ({ name: c.name, state: c.state })), open: [...openIdx], matchedPairs, moves, pairs: deck.length / 2, playing };
}

// ベスト記録（ペア数ごと）：手数が少ない方を優先し、同手数ならタイムが速い方
function mmBestKey(pairs) { return "sakamichia-best-memory-" + pairs; }
function mmBest(pairs) { try { const v = JSON.parse(localStorage.getItem(mmBestKey(pairs)) || "null"); return v && v.moves > 0 ? v : null; } catch (e) { return null; } }
function mmBestSave(pairs, mv, sec) {
  const b = mmBest(pairs);
  if (!b || mv < b.moves || (mv === b.moves && sec < b.sec)) {
    try { localStorage.setItem(mmBestKey(pairs), JSON.stringify({ moves: mv, sec })); } catch (e) {}
    return true;
  }
  return false;
}

// 写真の読み込みに失敗したときの備え：同じメンバーの別のギャラリー写真（新しい順に遡る）→
// プロフィール写真 → それも駄目なら名前タイル表示に切り替える。ペアの2枚は常に同じ写真に揃える
function handleImgError(name, img) {
  if (imgStage[name] === undefined || imgStage[name] === -2) return;
  // 既に別のカードのエラーで差し替え済みの場合は、古いURLのエラーを無視する
  if (+img.dataset.stage !== imgStage[name]) return;
  let url = "";
  if (imgStage[name] > 0) { imgStage[name]--; url = galURL(name, imgStage[name]); }
  else if (imgStage[name] === 0) { imgStage[name] = -1; url = profileURL(name); }
  if (!url) {
    imgStage[name] = -2;
    document.querySelectorAll(".mm-card .mm-front").forEach(f => {
      const im = f.querySelector("img");
      if (im && im.dataset.name === name) f.classList.add("noimg");
    });
    return;
  }
  document.querySelectorAll(".mm-card .mm-front img").forEach(im => {
    if (im.dataset.name === name) { im.dataset.stage = String(imgStage[name]); im.src = url; }
  });
}

function cardEl(i) { return document.querySelector(`.mm-card[data-i="${i}"]`); }
function paintCard(i) {
  const el = cardEl(i); if (!el) return;
  const st = deck[i].state;
  el.classList.toggle("open", st === "open");
  el.classList.toggle("done", st === "done");
}
function updateHead() {
  const f = document.getElementById("mmFound"); if (f) f.textContent = `揃った ${matchedPairs}／${deck.length / 2}ペア`;
  const m = document.getElementById("mmMoves"); if (m) m.textContent = `手数 ${moves}`;
}

function onCardClick(i) {
  if (!playing || lock) return;
  const card = deck[i];
  if (!card || card.state !== "down") return; // 開いたカード・完成したカードの再タップ、同じカードの連打は無効
  card.state = "open";
  openIdx.push(i);
  paintCard(i);
  if (openIdx.length < 2) return;
  moves++;
  const a = openIdx[0], b = openIdx[1];
  if (deck[a].name === deck[b].name) {
    deck[a].state = "done"; deck[b].state = "done";
    matchedPairs++;
    openIdx = [];
    paintCard(a); paintCard(b);
    updateHead();
    if (matchedPairs * 2 >= deck.length) finish();
  } else {
    updateHead();
    lock = true;
    setTimeout(() => {
      deck[a].state = "down"; deck[b].state = "down";
      openIdx = [];
      lock = false;
      paintCard(a); paintCard(b);
    }, MM_FLIP_BACK_MS);
  }
}

function start() {
  // 直近に出たメンバーは避け、未登場のメンバーを優先する（端末に記録）
  const seenNames = new Set(quizSeenGet("memory"));
  const prefer = new Set(POOL.filter(n => !seenNames.has(n)));
  deck = buildDeck(selPairs, undefined, prefer).map(c => ({ ...c, state: "down" }));
  quizSeenTouch("memory", [...new Set(deck.map(c => c.name))]);
  openIdx = []; matchedPairs = 0; moves = 0; lock = false;
  imgStage = {};
  deck.forEach(c => { if (imgStage[c.name] === undefined) imgStage[c.name] = (GAL[c.name] || []).length - 1; });
  const cols = selPairs === 6 ? 3 : 4;
  const main = document.getElementById("mmMain");
  main.innerHTML = `<div class="mm-head"><span id="mmFound">揃った 0／${selPairs}ペア</span><span id="mmMoves">手数 0</span><span>経過時間 <span id="mmTime">0:00</span></span></div>
    <div class="mm-grid c${cols}" id="mmGrid">${deck.map((c, i) => `<button type="button" class="mm-card" data-i="${i}" aria-label="カード ${i + 1}"><span class="mm-inner"><span class="mm-face mm-back"><span class="mm-a">ア</span><span class="mm-dots"><i></i><i></i><i></i></span></span><span class="mm-face mm-front"><img src="${esc(c.url)}" alt="" data-name="${esc(c.name)}" data-stage="${imgStage[c.name]}"><span class="mm-name">${esc(c.name)}</span></span></span></button>`).join("")}</div>
    <p class="mm-msg">カードをタップしてめくってください。同じメンバーの2枚を揃えよう。</p>`;
  main.querySelectorAll(".mm-card").forEach(el => el.addEventListener("click", () => onCardClick(+el.dataset.i)));
  main.querySelectorAll(".mm-front img").forEach(im => im.addEventListener("error", () => handleImgError(im.dataset.name, im)));
  playing = true;
  startAt = Date.now();
  clearInterval(timer);
  timer = setInterval(() => {
    const el = document.getElementById("mmTime");
    if (el) el.textContent = fmtTime(Math.floor((Date.now() - startAt) / 1000));
  }, 1000);
}

function finish() {
  playing = false;
  clearInterval(timer);
  const sec = Math.floor((Date.now() - startAt) / 1000);
  const pairs = deck.length / 2;
  const isNew = mmBestSave(pairs, moves, sec);
  const best = mmBest(pairs);
  const main = document.getElementById("mmMain");
  main.innerHTML = `<div class="card"><h3>🎉 コンプリート！</h3>
    <p>タイム：<b>${fmtTime(sec)}</b> ／ 手数：<b>${moves}手</b>（${pairs}ペア）</p>
    ${best ? `<p style="color:var(--muted)">${isNew ? "🎉 ベスト記録更新！" : `ベスト（${pairs}ペア）：${best.moves}手・${fmtTime(best.sec)}`}</p>` : ""}
    <p><button type="button" class="btn" id="mmRetry">もう一度遊ぶ</button> <button type="button" class="btn" id="mmSettings">条件を変える</button></p></div>`;
  document.getElementById("mmRetry").addEventListener("click", start);
  document.getElementById("mmSettings").addEventListener("click", startPanel);
}

function startPanel() {
  const main = document.getElementById("mmMain");
  main.innerHTML = `<div class="card"><h3>遊び方</h3>
  <p style="color:var(--muted)">${document.documentElement.dataset.lite === "1" ? `最新アー写のカードをめくり、同じメンバーのペアを全部揃えるゲームです。ペア数は下で選べます。` : `裏向きのカードを2枚ずつめくり、同じメンバーの写真ペアを揃えてください。写真は各メンバーの最新の公式アー写です。外れたカードは少し見えてから裏に戻ります。全ペアを揃えるまでの手数とタイムが記録になります。`}</p>
  <p style="margin:10px 0 6px"><b>ペア数</b></p>
  <div class="ychips" id="mmPairs">${MM_PAIR_COUNTS.map(n => `<button type="button" class="ychip" data-n="${n}">${n}ペア（${n * 2}枚）</button>`).join("")}</div>
  <p style="color:var(--muted)" id="mmBestLine"></p>
  <p><button type="button" class="primary" id="mmStart">スタート</button></p></div>`;
  const paintBest = () => {
    document.querySelectorAll("#mmPairs .ychip").forEach(ch => ch.classList.toggle("on", +ch.dataset.n === selPairs));
    const b = mmBest(selPairs);
    document.getElementById("mmBestLine").textContent = b ? `ベスト（${selPairs}ペア）：${b.moves}手・${fmtTime(b.sec)}` : "";
  };
  document.querySelectorAll("#mmPairs .ychip").forEach(ch => ch.addEventListener("click", () => { selPairs = +ch.dataset.n; paintBest(); }));
  paintBest();
  document.getElementById("mmStart").addEventListener("click", start);
}

async function init() {
  const [members, photos, gals] = await Promise.all([loadJSON("members.json"), loadJSON("member-photos.json"), loadJSON("member-galleries.json")]);
  MEMBERS = members || []; PHOTOS = photos || {}; GAL = gals || {};
  POOL = MEMBERS.map(m => m.name).filter(n => GAL[n] && GAL[n].length && PHOTOS[n]);
  if (POOL.length < Math.max(...MM_PAIR_COUNTS)) { document.getElementById("mmMain").innerHTML = `<p style="color:var(--muted)">写真データが足りません。</p>`; return; }
  startPanel();
}
init();
