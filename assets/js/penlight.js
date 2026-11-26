// サイリウムカラー一覧：data/penlight.json（公式発表・本人の公式ブログで確認できた分のみ）
// 色名は15色体系に正規化済み。approx のメンバーは本人の表現からの推定として注記する。
let PL = null, PL_MEMBERS = [], PL_PHOTOS = {}, plGroup = "", plColor = "", plQuery = "";
const PL_GROUP_ORDER = ["乃木坂46", "櫻坂46", "日向坂46", "欅坂46", "けやき坂46"];
function plPhoto(name) { const f = PL_PHOTOS[name]; return f ? BASE + "assets/member-photos/" + f : ""; }
function plDots(entry) {
  if (!entry) return `<span class="pl-none">未確認</span>`;
  const dots = entry.c.map(c => `<span class="pl-dot" style="background:${esc(PL.colors[c] || "#ccc")}"></span>`).join("");
  return `<span class="pl-colors">${dots}<span class="pl-labels">${esc(entry.c.join(" × "))}${entry.note ? `<span class="pl-note">${entry.approx ? "※推定：" : ""}${esc(entry.note)}</span>` : ""}</span></span>`;
}
function plRow(m) {
  const photo = plPhoto(m.name);
  const entry = PL.members[m.name];
  return `<a class="bd-row" href="../members/?member=${encodeURIComponent(m.name)}">
    ${photo ? `<img class="bd-thumb" src="${esc(photo)}" alt="" loading="lazy">` : `<span class="bd-thumb bd-nophoto"></span>`}
    <span class="bd-main"><span class="bd-name">${esc(m.name)}</span>
    <span class="bd-sub">${groupChip(m.group)}${m.gen ? `<span class="tag">${esc(m.gen)}期</span>` : ""}${m.graduated ? `<span class="tag">卒業</span>` : ""}</span></span>
    ${plDots(entry)}</a>`;
}
function render() {
  const activeOnly = document.getElementById("plActiveOnly").checked;
  const q = kanaNorm(plQuery.trim().toLowerCase());
  const list = PL_MEMBERS.filter(m => {
    const entry = PL.members[m.name];
    if (plGroup && m.group !== plGroup) return false;
    if (activeOnly && m.graduated) return false;
    if (plColor && !(entry && entry.c.includes(plColor))) return false;
    if (q && !kanaNorm((m.name + " " + (m.reading || "")).toLowerCase()).includes(q)) return false;
    return true;
  });
  const confirmed = PL_MEMBERS.filter(m => PL.members[m.name]).length;
  document.getElementById("plCount").textContent =
    `${list.length}人を表示中（カラー確認済み ${confirmed}人／全${PL_MEMBERS.length}人）`;
  document.getElementById("plBody").innerHTML = list.length
    ? `<div class="bd-list">${list.map(plRow).join("")}</div>`
    : `<p style="color:var(--muted)">該当するメンバーがいません。</p>`;
}
async function init() {
  const [penlight, members, photos] = await Promise.all([
    loadJSON("penlight.json"), loadJSON("members.json"), loadJSON("member-photos.json")]);
  PL = penlight || { colors: {}, members: {} };
  PL_PHOTOS = photos || {};
  PL_MEMBERS = (members || []).slice().sort((a, b) =>
    (PL_GROUP_ORDER.indexOf(a.group) - PL_GROUP_ORDER.indexOf(b.group)) ||
    ((a.gen || 99) - (b.gen || 99)) ||
    (a.reading || a.name).localeCompare(b.reading || b.name, "ja"));
  const groups = [...new Set(PL_MEMBERS.map(m => m.group))].sort((a, b) => PL_GROUP_ORDER.indexOf(a) - PL_GROUP_ORDER.indexOf(b));
  const gwrap = document.getElementById("plGroups");
  gwrap.innerHTML = [`<button type="button" class="ychip pl-gchip on" data-g="">すべて</button>`,
    ...groups.map(g => `<button type="button" class="ychip pl-gchip" data-g="${esc(g)}">${esc(g)}</button>`)].join("");
  gwrap.querySelectorAll(".pl-gchip").forEach(b => b.addEventListener("click", () => {
    plGroup = b.dataset.g;
    gwrap.querySelectorAll(".pl-gchip").forEach(x => x.classList.toggle("on", x === b));
    render();
  }));
  const sel = document.getElementById("plColor");
  Object.keys(PL.colors).forEach(c => {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => { plColor = sel.value; render(); });
  document.getElementById("plActiveOnly").addEventListener("change", render);
  document.getElementById("plQuery").addEventListener("input", e => { plQuery = e.target.value; render(); });
  render();
}
init();
