// 参戦記録：行ったライブを選ぶと live-index（参加メンバー・セトリ）から集計する。記録は端末の localStorage のみ。
const ML_KEY = "sakamichia-my-lives";
let ML_LIVES = [], ML_INDEX = {}, ML_SONG_ID = {}, ML_SONG_ID_BY_TITLE = {};
let mlSel = new Set(), mlGroup = "", mlYear = "", mlQuery = "";
function mlLoad() { try { const v = JSON.parse(localStorage.getItem(ML_KEY) || "[]"); if (Array.isArray(v)) mlSel = new Set(v); } catch (e) {} }
function mlSave() { try { localStorage.setItem(ML_KEY, JSON.stringify([...mlSel])); } catch (e) {} }
function mlSongHref(group, title) {
  const id = ML_SONG_ID[group + "|" + title] || ML_SONG_ID_BY_TITLE[title];
  return id ? `../songs/${id.toLowerCase()}/` : "";
}
function mlRenderStats() {
  const box = document.getElementById("mlStats");
  const detail = document.getElementById("mlDetail");
  const chosen = ML_LIVES.filter(l => mlSel.has(l.id));
  if (!chosen.length) {
    box.innerHTML = `<p style="color:var(--muted)">まだ記録がありません。下のリストから、行ったライブを選んでください。</p>`;
    detail.innerHTML = "";
    return;
  }
  const songCount = new Map(), memberCount = new Map(), venueCount = new Map(), yearCount = new Map(), groupCount = new Map();
  let totalSongs = 0;
  for (const live of chosen) {
    const idx = ML_INDEX[live.id] || {};
    totalSongs += (idx.s || []).length;
    (idx.s || []).forEach(t => songCount.set(t, (songCount.get(t) || 0) + 1));
    (idx.p || []).forEach(n => memberCount.set(n, (memberCount.get(n) || 0) + 1));
    if (live.venue) venueCount.set(live.venue, (venueCount.get(live.venue) || 0) + 1);
    const y = (live.date || "").slice(0, 4); if (y) yearCount.set(y, (yearCount.get(y) || 0) + 1);
    if (live.group) groupCount.set(live.group, (groupCount.get(live.group) || 0) + 1);
  }
  const topSongs = [...songCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).slice(0, 20);
  const topMembers = [...memberCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).slice(0, 20);
  const topVenues = [...venueCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const songGroupOf = t => {
    for (const live of chosen) {
      const ss = (ML_INDEX[live.id] || {}).s || [];
      if (ss.includes(t)) return live.group;
    }
    return "";
  };
  box.innerHTML = `<div class="ml-stats">
      <span class="ml-stat">参戦した公演<b>${chosen.length}公演</b></span>
      <span class="ml-stat">現地で聴いた曲<b>${songCount.size}曲</b></span>
      <span class="ml-stat">延べ曲数<b>${totalSongs}曲</b></span>
      <span class="ml-stat">会えたメンバー<b>${memberCount.size}人</b></span>
    </div>
    <div class="gacha-btns"><button type="button" class="btn sub" id="mlShare">記録を共有する</button><button type="button" class="btn sub" id="mlClear">記録をすべて消す</button></div>`;
  detail.innerHTML = `
    <h3 class="home-ghead">よく聴いた曲</h3>
    <ol class="ml-rank">${topSongs.map(([t, c]) => { const h = mlSongHref(songGroupOf(t), t); return `<li>${h ? `<a href="${h}">${esc(t)}</a>` : esc(t)} ― ${c}回</li>`; }).join("")}</ol>
    <h3 class="home-ghead">よく会えたメンバー</h3>
    <ol class="ml-rank">${topMembers.map(([n, c]) => `<li><a href="../members/?member=${encodeURIComponent(n)}">${esc(n)}</a> ― ${c}公演</li>`).join("")}</ol>
    <h3 class="home-ghead">よく行った会場</h3>
    <ol class="ml-rank">${topVenues.map(([v, c]) => `<li>${esc(v)} ― ${c}公演</li>`).join("")}</ol>
    <h3 class="home-ghead">年別の参戦数</h3>
    <p>${[...yearCount.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([y, c]) => `${esc(y)}年：${c}公演`).join("　")}</p>
    <h3 class="home-ghead">グループ別の参戦数</h3>
    <p>${[...groupCount.entries()].sort((a, b) => b[1] - a[1]).map(([g, c]) => `${esc(g)}：${c}公演`).join("　")}</p>`;
  document.getElementById("mlShare").addEventListener("click", e => {
    shareContent({ title: "参戦記録 | サカミチア", text: `参戦記録：${chosen.length}公演に参戦して、${songCount.size}曲を現地で聴きました。`, url: location.href }, e.target);
  });
  document.getElementById("mlClear").addEventListener("click", () => {
    if (!confirm("参戦記録をすべて消しますか？")) return;
    mlSel.clear(); mlSave(); mlRenderAll();
  });
}
function mlRenderList() {
  const q = kanaNorm(mlQuery.trim().toLowerCase());
  const list = ML_LIVES.filter(l =>
    (!mlGroup || l.group === mlGroup) &&
    (!mlYear || (l.date || "").startsWith(mlYear)) &&
    (!q || kanaNorm((l.title + " " + (l.venue || "")).toLowerCase()).includes(q)));
  const shown = list.slice(0, 120);
  document.getElementById("mlCount").textContent =
    `${list.length}公演が該当${list.length > shown.length ? `（先頭${shown.length}件を表示中。検索で絞り込んでください）` : ""}／記録済み ${mlSel.size}公演`;
  document.getElementById("mlList").innerHTML = shown.map(l => {
    const on = mlSel.has(l.id);
    return `<button type="button" class="ml-row ${on ? "on" : ""}" data-id="${esc(l.id)}">
      <span class="ml-date">${esc(l.date || "")}${l.time ? `<br>${esc(l.time)}` : ""}</span>
      <span class="ml-main"><span class="ml-title">${esc(l.title || "")}</span>
      <span class="ml-sub">${groupChip(l.group)}${esc(l.venue || "")}／${l.songCount || 0}曲</span></span>
      <span class="ml-mark">${on ? "参戦済み" : "＋ 記録"}</span></button>`;
  }).join("") || `<p style="color:var(--muted)">該当するライブがありません。</p>`;
  document.querySelectorAll(".ml-row").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.id;
    if (mlSel.has(id)) mlSel.delete(id); else mlSel.add(id);
    mlSave(); mlRenderAll();
  }));
}
function mlRenderAll() { mlRenderStats(); mlRenderList(); }
async function init() {
  mlLoad();
  const [lives, index, songs] = await Promise.all([loadJSON("lives.json"), loadJSON("live-index.json"), loadJSON("songs.json")]);
  ML_LIVES = (lives || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  ML_INDEX = index || {};
  (songs || []).forEach(s => { ML_SONG_ID[s.group + "|" + s.title] = s.id; if (!ML_SONG_ID_BY_TITLE[s.title]) ML_SONG_ID_BY_TITLE[s.title] = s.id; });
  const groups = [...new Set(ML_LIVES.map(l => l.group).filter(Boolean))];
  const gwrap = document.getElementById("mlGroups");
  gwrap.innerHTML = [`<button type="button" class="ychip ml-gchip on" data-g="">すべて</button>`,
    ...groups.map(g => `<button type="button" class="ychip ml-gchip" data-g="${esc(g)}">${esc(g)}</button>`)].join("");
  gwrap.querySelectorAll(".ml-gchip").forEach(b => b.addEventListener("click", () => {
    mlGroup = b.dataset.g;
    gwrap.querySelectorAll(".ml-gchip").forEach(x => x.classList.toggle("on", x === b));
    mlRenderList();
  }));
  const years = [...new Set(ML_LIVES.map(l => (l.date || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  const ysel = document.getElementById("mlYear");
  years.forEach(y => { const o = document.createElement("option"); o.value = y; o.textContent = y + "年"; ysel.appendChild(o); });
  ysel.addEventListener("change", () => { mlYear = ysel.value; mlRenderList(); });
  document.getElementById("mlQuery").addEventListener("input", e => { mlQuery = e.target.value; mlRenderList(); });
  mlRenderAll();
}
init();
