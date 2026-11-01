// ブログ統計：data/blogs/index.json（年別件数・メンバー別件数・メンバー年別件数）だけで描く
let IDX = null;
function barRow(label, value, max, href) {
  const pct = max ? Math.max(2, Math.round(value / max * 100)) : 0;
  const inner = `<span class="st-lab">${label}</span><span class="st-track"><span class="st-fill" style="width:${pct}%"></span></span><span class="st-val">${value.toLocaleString()}</span>`;
  return href ? `<a class="st-row" href="${href}">${inner}</a>` : `<div class="st-row">${inner}</div>`;
}
function renderTrend(name) {
  const box = document.getElementById("bsTrend");
  const my = (IDX.memberYears || {})[name];
  if (!my) { box.innerHTML = `<p style="color:var(--muted)">データがありません。</p>`; return; }
  const years = Object.keys(my).sort();
  const max = Math.max(...Object.values(my));
  const total = Object.values(my).reduce((a, b) => a + b, 0);
  box.innerHTML = `<p style="margin:4px 0 8px"><b>${esc(name)}</b>：全${total.toLocaleString()}件（${years[0]}〜${years[years.length - 1]}年）　<a href="../?member=${encodeURIComponent(name)}">この人のブログを見る →</a></p>`
    + years.map(y => barRow(y + "年", my[y], max)).join("");
}
async function init() {
  IDX = await loadJSON("blogs/index.json");
  if (!IDX) return;
  document.getElementById("bsLead").textContent = `アーカイブ全${(IDX.total || 0).toLocaleString()}件の集計です。`;
  const years = Object.entries(IDX.years || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const ymax = Math.max(...years.map(([, n]) => n));
  document.getElementById("bsYears").innerHTML = years.map(([y, n]) => barRow(y + "年", n, ymax, "../?year=" + y)).join("");
  const top = Object.entries(IDX.memberCounts || {}).map(([k, n]) => {
    const [g, name] = k.split("|"); return { g, name, n };
  }).sort((a, b) => b.n - a.n).slice(0, 30);
  const tmax = top.length ? top[0].n : 0;
  document.getElementById("bsTop").innerHTML = top.map((t, i) => barRow(`${i + 1}位 ${esc(t.name)}（${esc(t.g)}）`, t.n, tmax, "../?member=" + encodeURIComponent(t.name))).join("");
  const names = [...new Set(Object.values(IDX.memberCounts || {}).length ? Object.keys(IDX.memberYears || {}) : [])].sort((a, b) => a.localeCompare(b, "ja"));
  const sel = document.getElementById("bsMember");
  sel.innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  sel.addEventListener("change", () => renderTrend(sel.value));
  if (names.length) { sel.value = names.includes("小坂菜緒") ? "小坂菜緒" : names[0]; renderTrend(sel.value); }
}
init();
