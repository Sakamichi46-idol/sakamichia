// 学年一覧：誕生日から学年（4月2日〜翌年4月1日生まれ）を割り出して学年別に一覧する
let SY = [], SY_PHOTOS = {}, syActiveOnly = false;
function syCohort(b) { const [y, m, d] = b; return (m > 4 || (m === 4 && d >= 2)) ? y : y - 1; }
function syPhoto(name) { const f = SY_PHOTOS[name]; return f ? BASE + "assets/member-photos/" + f : ""; }
function syRow(m) {
  const [y, mo, d] = m.b;
  const photo = syPhoto(m.name);
  return `<a class="bd-row" href="../members/?member=${encodeURIComponent(m.name)}">
    ${photo ? `<img class="bd-thumb" src="${esc(photo)}" alt="" loading="lazy">` : `<span class="bd-thumb bd-nophoto"></span>`}
    <span class="bd-date"><b>${mo}/${d}</b></span>
    <span class="bd-main"><span class="bd-name">${esc(m.name)}</span>
    <span class="bd-sub">${groupChip(m.group)}${m.gen ? `<span class="tag">${esc(m.gen)}期</span>` : ""}${m.graduated ? `<span class="tag">卒業</span>` : ""}<span class="bd-year">${y}年生まれ</span></span></span></a>`;
}
function render() {
  const list = SY.filter(m => !syActiveOnly || !m.graduated);
  const byCohort = {};
  list.forEach(m => { const c = syCohort(m.b); (byCohort[c] = byCohort[c] || []).push(m); });
  const cohorts = Object.keys(byCohort).map(Number).sort((a, b) => a - b);
  document.getElementById("syBody").innerHTML = cohorts.map(c => {
    const ms = byCohort[c].slice().sort((a, b) => (a.b[0] - b.b[0]) || (a.b[1] - b.b[1]) || (a.b[2] - b.b[2]) || a.name.localeCompare(b.name, "ja"));
    return `<h3 class="home-ghead" id="y${c}">${c}年度生まれ（${c}年4月2日〜${c + 1}年4月1日）・${ms.length}人</h3><div class="bd-list">${ms.map(syRow).join("")}</div>`;
  }).join("") || `<p style="color:var(--muted)">該当するメンバーがいません。</p>`;
}
async function init() {
  const [members, meta, photos] = await Promise.all([loadJSON("members.json"), loadJSON("member-meta.json"), loadJSON("member-photos.json")]);
  SY_PHOTOS = photos || {};
  const byName = {}; (members || []).forEach(m => byName[m.name] = m);
  SY = Object.entries(meta || {}).filter(([, v]) => v && v.b).map(([name, v]) => ({ ...(byName[name] || { name }), b: v.b })).filter(m => m.name);
  document.getElementById("syActiveOnly").addEventListener("change", e => { syActiveOnly = e.target.checked; render(); });
  render();
  // メンバー詳細などから #y<年度> で来たら、その学年までスクロールする
  if (location.hash) { const t = document.querySelector(location.hash); if (t) t.scrollIntoView(); }
}
init();
