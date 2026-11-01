// セトリ登場回数ランキング：data/song-live.json（曲→公演ID一覧）を集計して表示
let ROWS = [], rkGroup = "all", rkOnce = false, rkQ = "";
const RK_GROUPS = ["乃木坂46", "櫻坂46", "日向坂46"];
function render() {
  const q = kanaNorm(rkQ.toLowerCase());
  const list = ROWS.filter(r =>
    (rkGroup === "all" || r.group === rkGroup)
    && (!rkOnce || r.n === 1)
    && (!q || kanaNorm((r.title + " " + (r.yomi || "")).toLowerCase()).includes(q)));
  document.getElementById("rkCount").textContent = `${list.length}曲`;
  document.getElementById("rkList").innerHTML = list.length ? `<div class="rk-list">${list.map((r, i) => `
    <a class="rk-row" href="../../songs/?q=${encodeURIComponent(r.title)}">
      <span class="rk-rank">${rkOnce ? "・" : i + 1}</span>
      <span class="rk-main"><span class="rk-title">${esc(r.title)}</span>
      <span class="rk-sub">${groupChip(r.group)}${r.type ? `<span class="tag">${esc(r.type)}</span>` : ""}<span class="rk-last">最近の披露：${esc(r.last || "―")}</span></span></span>
      <span class="rk-n">${r.n}<small>回</small></span></a>`).join("")}</div>`
    : `<p style="color:var(--muted)">条件に合う曲がありません。</p>`;
}
async function init() {
  const [sl, songs] = await Promise.all([loadJSON("song-live.json"), loadJSON("songs.json")]);
  const byTitle = {}; (songs || []).forEach(s => byTitle[s.title] = s);
  const shows = (sl && sl.shows) || {};
  ROWS = Object.entries((sl && sl.songs) || {}).map(([title, v]) => {
    const s = byTitle[title] || {};
    const dates = (v.ids || []).map(id => (shows[id] || [])[0]).filter(Boolean).sort();
    return { title, n: v.n || (v.ids || []).length, group: s.group || "", type: s.type || "", yomi: s.yomi || "", date: s.date || "", last: dates[dates.length - 1] || "" };
  }).sort((a, b) => b.n - a.n || String(a.date).localeCompare(String(b.date)) || a.title.localeCompare(b.title, "ja"));
  const chips = document.getElementById("rkGroups");
  chips.innerHTML = ["all", ...RK_GROUPS].map(g => `<button type="button" class="ychip${rkGroup === g ? " on" : ""}" data-g="${g}">${g === "all" ? "すべてのグループ" : g}</button>`).join("");
  chips.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    rkGroup = b.dataset.g;
    chips.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    render();
  }));
  document.getElementById("rkOnce").addEventListener("change", e => { rkOnce = e.target.checked; render(); });
  document.getElementById("rkQ").addEventListener("input", e => { rkQ = e.target.value.trim(); render(); });
  render();
}
init();
