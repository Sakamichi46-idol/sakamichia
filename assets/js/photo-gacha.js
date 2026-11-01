// ランダム写真ガチャ：ブログ写真（年別 blog-imgs）からランダムで1枚引く
// 年は記事数で重み付けして選び、その年のデータだけ読み込む（読み込んだ年はキャッシュ）
let YEARS = [], TOTAL = 0;
const CACHE = {}; // year -> {blogs: Map(id->article), imgs: {id:[url]}}
function weserv(url, w) { return "https://images.weserv.nl/?url=" + encodeURIComponent(url.replace(/^https?:\/\//, "")) + "&w=" + w + "&output=webp"; }
async function loadYear(y) {
  if (CACHE[y]) return CACHE[y];
  const [blogs, imgs] = await Promise.all([loadJSON("blogs/y" + y + ".json"), loadJSON("blog-imgs/y" + y + ".json")]);
  const map = new Map(); (blogs || []).forEach(b => map.set(b.id, b));
  CACHE[y] = { blogs: map, imgs: imgs || {} };
  return CACHE[y];
}
function pickYear() {
  let r = Math.random() * TOTAL;
  for (const [y, n] of YEARS) { r -= n; if (r <= 0) return y; }
  return YEARS[YEARS.length - 1][0];
}
async function draw() {
  const btn = document.getElementById("gachaDraw"), msg = document.getElementById("gachaMsg"),
    img = document.getElementById("gachaImg"), cap = document.getElementById("gachaCap"), open = document.getElementById("gachaOpen");
  btn.disabled = true; msg.hidden = false; msg.textContent = "引いています…"; img.hidden = true; open.hidden = true; cap.textContent = "";
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const y = pickYear();
      const { blogs, imgs } = await loadYear(y);
      const ids = Object.keys(imgs).filter(id => imgs[id] && imgs[id].length && blogs.has(id));
      if (!ids.length) continue;
      const id = ids[Math.floor(Math.random() * ids.length)];
      const b = blogs.get(id);
      const url = imgs[id][Math.floor(Math.random() * imgs[id].length)];
      img.onload = () => { img.hidden = false; msg.hidden = true; btn.disabled = false; };
      img.onerror = () => { btn.disabled = false; msg.textContent = "写真を読み込めませんでした。もう一度引いてください。"; };
      img.src = weserv(url, document.documentElement.dataset.lite === "1" ? 640 : 1100);
      cap.innerHTML = `${groupChip(b.group)} <b>${esc(b.member || "")}</b> ・ ${esc(b.date || "")}<br>${esc(b.title || "")}`;
      open.href = BASE + "blog/?open=" + encodeURIComponent(id);
      open.hidden = false;
      btn.textContent = "🎲 もう1枚引く";
      return;
    }
    msg.textContent = "うまく引けませんでした。もう一度お試しください。"; btn.disabled = false;
  } catch (e) {
    msg.textContent = "読み込みに失敗しました。"; btn.disabled = false;
  }
}
async function init() {
  const idx = await loadJSON("blogs/index.json");
  YEARS = Object.entries((idx && idx.years) || {}).map(([y, n]) => [y, +n]).filter(([, n]) => n > 0);
  TOTAL = YEARS.reduce((a, [, n]) => a + n, 0);
  const btn = document.getElementById("gachaDraw");
  btn.addEventListener("click", draw);
  if (TOTAL) { btn.disabled = false; document.getElementById("gachaMsg").textContent = "ボタンを押して1枚引いてください。"; draw(); }
  else document.getElementById("gachaMsg").textContent = "データを読み込めませんでした。";
}
init();
