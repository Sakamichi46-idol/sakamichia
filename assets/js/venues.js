// 会場一覧：lives.json を会場ごとに集計し、展開すると公演リストを出す
let VENUES = [], vnQ = "";
function render() {
  const q = kanaNorm(vnQ.toLowerCase());
  const list = VENUES.filter(v => !q || kanaNorm(v.name.toLowerCase()).includes(q));
  document.getElementById("vnCount").textContent = `${list.length}会場`;
  document.getElementById("vnList").innerHTML = list.length ? list.map((v, i) => `
    <div class="vn-box">
      <button type="button" class="vn-head" data-i="${i}">
        <span class="vn-name">${esc(v.name)}</span>
        <span class="vn-meta">${v.groups.map(groupChip).join("")}<span class="tag">${v.shows.length}公演</span><span class="vn-last">最近：${esc(v.last)}</span></span>
      </button>
      <div class="vn-shows" hidden>${v.shows.map(s => `<a class="vn-show" href="../?show=${encodeURIComponent(s.id)}"><span class="vn-sdate">${esc(s.date)}</span><span>${esc(s.title)}</span>${groupChip(s.group)}</a>`).join("")}
        <p style="margin:8px 0 2px"><a href="../?q=${encodeURIComponent(v.name)}">この会場で絞り込んで開く →</a></p>
      </div>
    </div>`).join("") : `<p style="color:var(--muted)">該当する会場がありません。</p>`;
  document.querySelectorAll(".vn-head").forEach(b => b.addEventListener("click", () => {
    const box = b.nextElementSibling;
    box.hidden = !box.hidden;
  }));
}
async function init() {
  const lives = await loadJSON("lives.json");
  const map = {};
  (lives || []).forEach(l => {
    if (!l.venue) return;
    const v = map[l.venue] || (map[l.venue] = { name: l.venue, shows: [], groups: new Set(), last: "" });
    v.shows.push(l); v.groups.add(l.group);
    if (l.date > v.last) v.last = l.date;
  });
  VENUES = Object.values(map).map(v => ({ ...v, groups: [...v.groups], shows: v.shows.sort((a, b) => String(b.date).localeCompare(String(a.date))) }))
    .sort((a, b) => b.shows.length - a.shows.length || a.name.localeCompare(b.name, "ja"));
  document.getElementById("vnQ").addEventListener("input", e => { vnQ = e.target.value.trim(); render(); });
  render();
}
init();
