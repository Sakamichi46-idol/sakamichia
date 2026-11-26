// 参戦記録（集計専用）：記録そのものは歴代ライブの各公演の詳細で付ける「参戦した」「配信で見た」と共通。
// 保存先は live.js と同じ localStorage キー "sakamichia-attended"（公演id → "venue"=現地参戦 / "stream"=配信）。
// 初期の参戦記録ページが使っていた旧キー "sakamichia-my-lives"（idの配列）に残っている記録は、
// 初回読み込み時に "venue" として取り込んでから旧キーを消す。
const ATTEND_KEY = "sakamichia-attended";
const OLD_KEY = "sakamichia-my-lives";
let ML_LIVES = [], ML_INDEX = {}, ML_SONG_ID = {}, ML_SONG_ID_BY_TITLE = {};
const ATTENDED = new Map();
function mlLoadAttended() {
  ATTENDED.clear();
  try {
    const v = JSON.parse(localStorage.getItem(ATTEND_KEY) || "null");
    if (Array.isArray(v)) v.forEach(x => { if (typeof x === "string" && x) ATTENDED.set(x, "venue"); });
    else if (v && typeof v === "object") Object.entries(v).forEach(([id, st]) => { if (id) ATTENDED.set(id, st === "stream" ? "stream" : "venue"); });
  } catch (e) {}
  // 旧キーからの移行（未登録のものだけ現地参戦として取り込む）
  try {
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || "null");
    if (Array.isArray(old)) {
      let changed = false;
      old.forEach(id => { if (typeof id === "string" && id && !ATTENDED.has(id)) { ATTENDED.set(id, "venue"); changed = true; } });
      if (changed) mlSaveAttended();
      localStorage.removeItem(OLD_KEY);
    }
  } catch (e) {}
}
function mlSaveAttended() {
  try {
    const o = {};
    ATTENDED.forEach((st, id) => { o[id] = st; });
    localStorage.setItem(ATTEND_KEY, JSON.stringify(o));
  } catch (e) {}
}
function mlSongHref(group, title) {
  const id = ML_SONG_ID[group + "|" + title] || ML_SONG_ID_BY_TITLE[title];
  return id ? `../songs/${id.toLowerCase()}/` : "";
}
function mlAttendedShows() { return ML_LIVES.filter(l => ATTENDED.has(l.id)); }
function mlParts(v, s) { return [v ? `参戦${v}` : "", s ? `配信${s}` : ""].filter(Boolean).join("・"); }
function mlRender() {
  const box = document.getElementById("mlStats");
  const detail = document.getElementById("mlDetail");
  const listBox = document.getElementById("mlList");
  const shows = mlAttendedShows();
  if (!shows.length) {
    box.innerHTML = `<p style="color:var(--muted)">まだ記録がありません。歴代ライブで公演の詳細を開き、「参戦した」「配信で見た」を選ぶと記録できます。</p>
      <p><a class="btn" href="../live/">歴代ライブで記録する</a></p>`;
    detail.innerHTML = "";
    listBox.innerHTML = "";
    return;
  }
  const venueShows = shows.filter(l => ATTENDED.get(l.id) !== "stream");
  const streamShows = shows.filter(l => ATTENDED.get(l.id) === "stream");
  const songCount = new Map(), memberCount = new Map(), venueCount = new Map(), yearMap = new Map(), groupMap = new Map();
  let totalSongs = 0;
  const bump = (map, k) => { if (k) map.set(k, (map.get(k) || { v: 0, s: 0 })); };
  for (const live of shows) {
    const st = ATTENDED.get(live.id) === "stream" ? "s" : "v";
    const idx = ML_INDEX[live.id] || {};
    totalSongs += (idx.s || []).length;
    (idx.s || []).forEach(t => songCount.set(t, (songCount.get(t) || 0) + 1));
    if (st === "v") {
      (idx.p || []).forEach(n => memberCount.set(n, (memberCount.get(n) || 0) + 1));
      if (live.venue) venueCount.set(live.venue, (venueCount.get(live.venue) || 0) + 1);
    }
    const y = (live.date || "").slice(0, 4);
    if (y) { bump(yearMap, y); yearMap.get(y)[st]++; }
    if (live.group) { bump(groupMap, live.group); groupMap.get(live.group)[st]++; }
  }
  const topSongs = [...songCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).slice(0, 20);
  const topMembers = [...memberCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).slice(0, 20);
  const topVenues = [...venueCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const songGroupOf = t => {
    for (const live of shows) {
      const ss = (ML_INDEX[live.id] || {}).s || [];
      if (ss.includes(t)) return live.group;
    }
    return "";
  };
  box.innerHTML = `<div class="ml-stats">
      <span class="ml-stat">参戦した公演（現地）<b>${venueShows.length}公演</b></span>
      <span class="ml-stat">配信で見た公演<b>${streamShows.length}公演</b></span>
      <span class="ml-stat">聴いた曲<b>${songCount.size}曲</b></span>
      <span class="ml-stat">延べ曲数<b>${totalSongs}曲</b></span>
      <span class="ml-stat">現地で会えたメンバー<b>${memberCount.size}人</b></span>
    </div>
    <div class="gacha-btns"><a class="btn" href="../live/">歴代ライブで探す・記録する</a><button type="button" class="btn sub" id="mlShare">記録を共有する</button><button type="button" class="btn sub" id="mlClear">記録をすべて消す</button></div>`;
  detail.innerHTML = `
    <h3 class="home-ghead">よく聴いた曲</h3>
    <ol class="ml-rank">${topSongs.map(([t, c]) => { const h = mlSongHref(songGroupOf(t), t); return `<li>${h ? `<a href="${h}">${esc(t)}</a>` : esc(t)} ― ${c}回</li>`; }).join("")}</ol>
    <h3 class="home-ghead">現地でよく会えたメンバー</h3>
    ${topMembers.length ? `<ol class="ml-rank">${topMembers.map(([n, c]) => `<li><a href="../members/?member=${encodeURIComponent(n)}">${esc(n)}</a> ― ${c}公演</li>`).join("")}</ol>` : `<p style="color:var(--muted)">現地参戦の記録がまだありません。</p>`}
    <h3 class="home-ghead">よく行った会場</h3>
    ${topVenues.length ? `<ol class="ml-rank">${topVenues.map(([v, c]) => `<li>${esc(v)} ― ${c}公演</li>`).join("")}</ol>` : `<p style="color:var(--muted)">現地参戦の記録がまだありません。</p>`}
    <h3 class="home-ghead">年別の記録数</h3>
    <p>${[...yearMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([y, c]) => `${esc(y)}年：${mlParts(c.v, c.s)}`).join("　")}</p>
    <h3 class="home-ghead">グループ別の記録数</h3>
    <p>${[...groupMap.entries()].sort((a, b) => (b[1].v + b[1].s) - (a[1].v + a[1].s)).map(([g, c]) => `${esc(g)}：${mlParts(c.v, c.s)}`).join("　")}</p>`;
  listBox.innerHTML = shows.map(l => {
    const st = ATTENDED.get(l.id);
    return `<div class="ml-row">
      <span class="ml-date">${esc(l.date || "")}${l.time ? `<br>${esc(l.time)}` : ""}</span>
      <span class="ml-main"><span class="ml-title">${esc(l.title || "")}</span>
      <span class="ml-sub">${groupChip(l.group)}${esc(l.venue || "")}／${l.songCount || 0}曲</span></span>
      <span class="badge ${st === "stream" ? "stream-badge" : "attend-badge"}">${st === "stream" ? "配信で見た" : "参戦済み"}</span>
      <span class="ml-acts"><a class="btn sub" href="../live/?show=${encodeURIComponent(l.id)}">セトリ</a><button type="button" class="btn sub" data-remove="${esc(l.id)}">外す</button></span></div>`;
  }).join("");
  listBox.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => {
    ATTENDED.delete(b.dataset.remove);
    mlSaveAttended();
    mlRender();
  }));
  document.getElementById("mlShare").addEventListener("click", e => {
    shareContent({ title: "参戦記録 | サカミチア", text: `参戦記録：現地参戦${venueShows.length}公演・配信${streamShows.length}公演で、${songCount.size}曲を聴きました。`, url: location.href }, e.target);
  });
  document.getElementById("mlClear").addEventListener("click", () => {
    if (!confirm("参戦記録をすべて消しますか？（歴代ライブの記録も共通なので、そちらの表示も消えます）")) return;
    ATTENDED.clear(); mlSaveAttended(); mlRender();
  });
}
async function init() {
  mlLoadAttended();
  const [lives, index, songs] = await Promise.all([loadJSON("lives.json"), loadJSON("live-index.json"), loadJSON("songs.json")]);
  ML_LIVES = (lives || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.time || "").localeCompare(String(a.time || "")));
  ML_INDEX = index || {};
  (songs || []).forEach(s => { ML_SONG_ID[s.group + "|" + s.title] = s.id; if (!ML_SONG_ID_BY_TITLE[s.title]) ML_SONG_ID_BY_TITLE[s.title] = s.id; });
  mlRender();
}
init();
