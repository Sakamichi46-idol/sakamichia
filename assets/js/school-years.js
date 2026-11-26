// 学年一覧：誕生日から学年（4月2日〜翌年4月1日生まれ）を割り出して学年別に一覧する
// 年齢表：生年月日順（年齢が高い順）に、今日時点の年齢つきで一覧する
let SY = [], SY_PHOTOS = {}, syActiveOnly = false, syView = "cohort";
function syCohort(b) { const [y, m, d] = b; return (m > 4 || (m === 4 && d >= 2)) ? y : y - 1; }
function syPhoto(name) { const f = SY_PHOTOS[name]; return f ? BASE + "assets/member-photos/" + f : ""; }
function syAge(b) {
  const now = new Date();
  let age = now.getFullYear() - b[0];
  if (now.getMonth() + 1 < b[1] || (now.getMonth() + 1 === b[1] && now.getDate() < b[2])) age--;
  return age;
}
function syRow(m) {
  const [y, mo, d] = m.b;
  const photo = syPhoto(m.name);
  return `<a class="bd-row" href="../members/?member=${encodeURIComponent(m.name)}">
    ${photo ? `<img class="bd-thumb" src="${esc(photo)}" alt="" loading="lazy">` : `<span class="bd-thumb bd-nophoto"></span>`}
    <span class="bd-date"><b>${mo}/${d}</b></span>
    <span class="bd-main"><span class="bd-name">${esc(m.name)}</span>
    <span class="bd-sub">${groupChip(m.group)}${m.gen ? `<span class="tag">${esc(m.gen)}期</span>` : ""}${m.graduated ? `<span class="tag">卒業</span>` : ""}<span class="bd-year">${y}年生まれ</span></span></span></a>`;
}
function syAgeRow(m, rank) {
  const [y, mo, d] = m.b;
  const photo = syPhoto(m.name);
  return `<a class="bd-row" href="../members/?member=${encodeURIComponent(m.name)}">
    ${photo ? `<img class="bd-thumb" src="${esc(photo)}" alt="" loading="lazy">` : `<span class="bd-thumb bd-nophoto"></span>`}
    <span class="bd-date"><b>${rank}位</b></span>
    <span class="bd-main"><span class="bd-name">${esc(m.name)}</span>
    <span class="bd-sub">${groupChip(m.group)}${m.gen ? `<span class="tag">${esc(m.gen)}期</span>` : ""}${m.graduated ? `<span class="tag">卒業</span>` : ""}<span class="bd-year">${y}年${mo}月${d}日生まれ</span></span></span>
    <span class="sy-age"><b>${syAge(m.b)}歳</b></span></a>`;
}
function renderCohort(list) {
  const byCohort = {};
  list.forEach(m => { const c = syCohort(m.b); (byCohort[c] = byCohort[c] || []).push(m); });
  const cohorts = Object.keys(byCohort).map(Number).sort((a, b) => a - b);
  document.getElementById("syBody").innerHTML = cohorts.map(c => {
    const ms = byCohort[c].slice().sort((a, b) => (a.b[0] - b.b[0]) || (a.b[1] - b.b[1]) || (a.b[2] - b.b[2]) || a.name.localeCompare(b.name, "ja"));
    return `<h3 class="home-ghead" id="y${c}">${c}年度生まれ（${c}年4月2日〜${c + 1}年4月1日）・${ms.length}人</h3><div class="bd-list">${ms.map(syRow).join("")}</div>`;
  }).join("") || `<p style="color:var(--muted)">該当するメンバーがいません。</p>`;
}
function renderAge(list) {
  const ms = list.slice().sort((a, b) => (a.b[0] - b.b[0]) || (a.b[1] - b.b[1]) || (a.b[2] - b.b[2]) || a.name.localeCompare(b.name, "ja"));
  if (!ms.length) { document.getElementById("syBody").innerHTML = `<p style="color:var(--muted)">該当するメンバーがいません。</p>`; return; }
  let rank = 0, prevKey = "";
  const rows = ms.map((m, i) => {
    const key = m.b.join("-");
    if (key !== prevKey) { rank = i + 1; prevKey = key; }
    return syAgeRow(m, rank);
  });
  document.getElementById("syBody").innerHTML =
    `<p style="color:var(--muted);margin:4px 0 10px">年齢が高い順（生年月日が早い順）です。年齢は今日時点の満年齢です。</p><div class="bd-list">${rows.join("")}</div>`;
}
function render() {
  const list = SY.filter(m => !syActiveOnly || !m.graduated);
  document.getElementById("syTabCohort").classList.toggle("on", syView === "cohort");
  document.getElementById("syTabAge").classList.toggle("on", syView === "age");
  if (syView === "age") renderAge(list); else renderCohort(list);
}
async function init() {
  const [members, meta, photos] = await Promise.all([loadJSON("members.json"), loadJSON("member-meta.json"), loadJSON("member-photos.json")]);
  SY_PHOTOS = photos || {};
  const byName = {}; (members || []).forEach(m => byName[m.name] = m);
  SY = Object.entries(meta || {}).filter(([, v]) => v && v.b).map(([name, v]) => ({ ...(byName[name] || { name }), b: v.b })).filter(m => m.name);
  document.getElementById("syActiveOnly").addEventListener("change", e => { syActiveOnly = e.target.checked; render(); });
  document.getElementById("syTabCohort").addEventListener("click", () => { syView = "cohort"; render(); });
  document.getElementById("syTabAge").addEventListener("click", () => { syView = "age"; render(); });
  render();
  // メンバー詳細などから #y<年度> で来たら、その学年までスクロールする
  if (location.hash) { const t = document.querySelector(location.hash); if (t) t.scrollIntoView(); }
}
init();
