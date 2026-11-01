// 坂道年表：表題曲/アルバムリード曲のリリース＋歴代ライブ（同ツアーは初日に集約）を年別に並べる
let EVENTS = [], tlGroup = "all", tlSongs = true, tlLives = true;
const TL_GROUPS = ["乃木坂46", "櫻坂46", "日向坂46"];
function render() {
  const list = EVENTS.filter(e => (tlGroup === "all" || e.group === tlGroup) && (e.kind === "song" ? tlSongs : tlLives));
  const byYear = {};
  list.forEach(e => { const y = e.date.slice(0, 4); (byYear[y] = byYear[y] || []).push(e); });
  const years = Object.keys(byYear).sort().reverse();
  document.getElementById("tlBody").innerHTML = years.map(y => `
    <h3 class="home-ghead">${y}年</h3><div class="tl-list">${byYear[y].sort((a, b) => a.date.localeCompare(b.date)).map(e => `
      <a class="tl-row" href="${esc(e.href)}"><span class="tl-date">${+e.date.slice(5, 7)}/${+e.date.slice(8, 10)}</span>
      <span class="tl-kind tl-${e.kind}">${e.kind === "song" ? "リリース" : "ライブ"}</span>
      <span class="tl-main"><span class="tl-title">${esc(e.title)}</span><span class="tl-sub">${groupChip(e.group)}<span class="tl-note">${esc(e.note || "")}</span></span></span></a>`).join("")}</div>`).join("")
    || `<p style="color:var(--muted)">条件に合う出来事がありません。</p>`;
}
async function init() {
  const [songs, lives] = await Promise.all([loadJSON("songs.json"), loadJSON("lives.json")]);
  const ev = [];
  (songs || []).filter(s => (s.type === "表題曲" || s.type === "アルバムリード曲") && s.date).forEach(s => ev.push({
    kind: "song", date: s.date, group: s.group, title: s.title,
    note: `${s.type}${s.center ? "・センター：" + s.center : ""}`,
    href: BASE + "songs/?q=" + encodeURIComponent(s.title)
  }));
  // ライブは同タイトル（［DAY］等を除いた基本形）ごとに初日へ集約
  const tourMap = {};
  (lives || []).forEach(l => {
    const base = l.title.replace(/［[^］]*］\s*/g, "").replace(/〈[^〉]*〉\s*/g, "").trim();
    const key = l.group + "|" + base;
    if (!tourMap[key]) tourMap[key] = { kind: "live", date: l.date, group: l.group, title: base, n: 0, id: l.id, venue: l.venue };
    const t = tourMap[key];
    t.n++;
    if (l.date < t.date) { t.date = l.date; t.id = l.id; t.venue = l.venue; }
  });
  Object.values(tourMap).forEach(t => ev.push({
    kind: "live", date: t.date, group: t.group, title: t.title,
    note: `${t.venue || ""}${t.n > 1 ? `・全${t.n}公演` : ""}`,
    href: BASE + "live/?show=" + encodeURIComponent(t.id)
  }));
  EVENTS = ev;
  const chips = document.getElementById("tlGroups");
  chips.innerHTML = ["all", ...TL_GROUPS].map(g => `<button type="button" class="ychip${tlGroup === g ? " on" : ""}" data-g="${g}">${g === "all" ? "すべてのグループ" : g}</button>`).join("");
  chips.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    tlGroup = b.dataset.g;
    chips.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    render();
  }));
  document.getElementById("tlSongs").addEventListener("change", e => { tlSongs = e.target.checked; render(); });
  document.getElementById("tlLives").addEventListener("change", e => { tlLives = e.target.checked; render(); });
  render();
}
init();
