// 公式リンク集：data/links.json（グループ公式／メンバーのInstagram／写真集アカウント）を描画する
// 収録基準：各グループの公式サイトや公式の告知で案内されているリンクだけ
let LK = null, lkGroup = "", lkQ = "";
const LK_VAR = { "乃木坂46": "var(--n)", "櫻坂46": "var(--s)", "日向坂46": "var(--h)", "欅坂46": "var(--k)", "けやき坂46": "var(--h)" };

function lkHead(text, group) {
  return `<h3 class="home-ghead" style="border-left:5px solid ${LK_VAR[group] || "var(--line)"};padding-left:8px">${esc(text)}</h3>`;
}
function lkOfficialHtml() {
  const blocks = (LK.groups || []).filter(b => !lkGroup || b.group === lkGroup).map(b => `
    <section>${lkHead(b.group, b.group)}
    <div style="display:flex;flex-wrap:wrap;gap:8px">${b.links.map(l => `<a class="btn sub" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join("")}</div></section>`).join("");
  return blocks ? `<h3 class="home-ghead">グループ公式</h3>${blocks}` : "";
}
function lkIgHtml() {
  const q = kanaNorm(lkQ.trim());
  const rows = (LK.memberInstagram || []).filter(m => (!lkGroup || m.group === lkGroup) &&
    (!q || kanaNorm(m.name).includes(q) || kanaNorm(m.reading || "").includes(q) || kanaNorm(m.url).includes(q)));
  if (!rows.length) return "";
  const byGroup = {};
  rows.forEach(m => { (byGroup[m.group] = byGroup[m.group] || []).push(m); });
  const body = Object.keys(byGroup).map(g => `${lkHead(g, g)}<div class="grid">${byGroup[g].map(m => `
    <a class="card" href="${esc(m.url)}" target="_blank" rel="noopener">${groupChip(m.group)}<h3>${esc(m.name)}</h3><p>Instagram ${esc("@" + m.url.replace(/\/$/, "").split("/").pop())}</p></a>`).join("")}</div>`).join("");
  return `<h3 class="home-ghead">メンバーのInstagram（${rows.length}人）</h3>${body}`;
}
function lkBooksHtml() {
  const q = kanaNorm(lkQ.trim());
  const rows = (LK.photobooks || []).filter(b => (!lkGroup || b.group === lkGroup) &&
    (!q || kanaNorm(b.member).includes(q) || kanaNorm(b.reading || "").includes(q) || kanaNorm(b.title).includes(q)));
  if (!rows.length) return "";
  return `<h3 class="home-ghead">写真集の公式アカウント（${rows.length}件）</h3><div class="grid">${rows.map(b => `
    <div class="card">${groupChip(b.group)}<h3>${esc(b.title)}</h3><p>${esc(b.member)}${b.year ? ` ・ ${esc(String(b.year))}年` : ""}</p>
    <p>${b.x ? `<a class="btn sub" href="${esc(b.x)}" target="_blank" rel="noopener">X ↗</a> ` : ""}${b.instagram ? `<a class="btn sub" href="${esc(b.instagram)}" target="_blank" rel="noopener">Instagram ↗</a>` : ""}</p></div>`).join("")}</div>`;
}
function render() {
  if (!LK) return;
  document.getElementById("lkOfficial").innerHTML = lkOfficialHtml();
  document.getElementById("lkIg").innerHTML = lkIgHtml();
  document.getElementById("lkBooks").innerHTML = lkBooksHtml();
  const ig = (LK.memberInstagram || []).length, bk = (LK.photobooks || []).length;
  document.getElementById("lkCount").textContent = `メンバーのInstagram ${ig}人 ・ 写真集アカウント ${bk}件を収録`;
  if (!lkOfficialHtml() && !lkIgHtml() && !lkBooksHtml())
    document.getElementById("lkOfficial").innerHTML = `<div class="empty">条件に合うリンクがありません。</div>`;
}
async function init() {
  LK = await loadJSON("links.json");
  const chips = [["", "すべて"], ["乃木坂46", "乃木坂46"], ["櫻坂46", "櫻坂46"], ["日向坂46", "日向坂46"], ["欅坂46", "欅坂46"]];
  const box = document.getElementById("lkChips");
  box.innerHTML = chips.map(([v, t]) => `<button type="button" class="ychip${v === lkGroup ? " on" : ""}" data-g="${esc(v)}">${esc(t)}</button>`).join("");
  box.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    lkGroup = b.dataset.g;
    box.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    render();
  }));
  document.getElementById("lkQ").addEventListener("input", e => { lkQ = e.target.value; render(); });
  render();
}
init();
