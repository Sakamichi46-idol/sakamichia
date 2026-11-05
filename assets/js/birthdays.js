// 誕生日カレンダー：member-meta.json の誕生日を月別一覧にする。今日と次の誕生日も出す
let BD = [], PHOTOS = {}, activeOnly = false;
function bdPhoto(name) { const f = PHOTOS[name]; return f ? BASE + "assets/member-photos/" + f : ""; }
function bdRow(m) {
  const [, mo, d] = m.b;
  const photo = bdPhoto(m.name);
  return `<a class="bd-row" href="../members/?member=${encodeURIComponent(m.name)}">
    ${photo ? `<img class="bd-thumb" src="${esc(photo)}" alt="" loading="lazy">` : `<span class="bd-thumb bd-nophoto"></span>`}
    <span class="bd-date"><b>${mo}/${d}</b></span>
    <span class="bd-main"><span class="bd-name">${esc(m.name)}</span>
    <span class="bd-sub">${groupChip(m.group)}${m.gen ? `<span class="tag">${esc(m.gen)}期</span>` : ""}${m.graduated ? `<span class="tag">卒業</span>` : ""}<span class="bd-year">${m.b[0]}年生まれ</span></span></span></a>`;
}
function render() {
  const list = BD.filter(m => !activeOnly || !m.graduated);
  const now = new Date();
  const todayMD = (now.getMonth() + 1) * 100 + now.getDate();
  // 今日の誕生日＋次の誕生日（今日から60日以内）
  const upcoming = list.map(m => {
    const md = m.b[1] * 100 + m.b[2];
    let diff = md - todayMD; if (diff < 0) diff += 10000; // 年またぎは概算（日数ではない）
    // 正確な日数差
    const next = new Date(now.getFullYear(), m.b[1] - 1, m.b[2]);
    const target = next < new Date(now.getFullYear(), now.getMonth(), now.getDate()) ? new Date(now.getFullYear() + 1, m.b[1] - 1, m.b[2]) : next;
    const days = Math.round((target - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
    return { m, days };
  }).filter(x => x.days <= 60).sort((a, b) => a.days - b.days);
  const today = upcoming.filter(x => x.days === 0);
  const nextOnes = upcoming.filter(x => x.days > 0).slice(0, 5);
  document.getElementById("bdToday").innerHTML =
    (today.length ? `<h3 class="home-ghead">今日が誕生日のメンバー</h3><div class="bd-list">${today.map(x => bdRow(x.m)).join("")}</div>` : "")
    + (nextOnes.length ? `<h3 class="home-ghead">もうすぐ誕生日</h3><div class="bd-list">${nextOnes.map(x => bdRow(x.m).replace("</a>", `<span class="bd-days">あと${x.days}日</span></a>`)).join("")}</div>` : "");
  let html = "";
  for (let mo = 1; mo <= 12; mo++) {
    const ms = list.filter(m => m.b[1] === mo).sort((a, b) => a.b[2] - b.b[2] || a.name.localeCompare(b.name, "ja"));
    if (!ms.length) continue;
    html += `<h3 class="home-ghead" id="bd-m${mo}">${mo}月（${ms.length}人）</h3><div class="bd-list">${ms.map(bdRow).join("")}</div>`;
  }
  document.getElementById("bdMonths").innerHTML = html || `<p style="color:var(--muted)">該当するメンバーがいません。</p>`;
}
async function init() {
  const [members, meta, photos] = await Promise.all([loadJSON("members.json"), loadJSON("member-meta.json"), loadJSON("member-photos.json")]);
  PHOTOS = photos || {};
  const byName = {}; (members || []).forEach(m => byName[m.name] = m);
  BD = Object.entries(meta || {}).filter(([, v]) => v && v.b).map(([name, v]) => ({ ...(byName[name] || { name }), b: v.b }))
    .filter(m => m.name);
  document.getElementById("bdActiveOnly").addEventListener("change", e => { activeOnly = e.target.checked; render(); });
  render();
  // 今月へ自動スクロール（今日の欄がある場合はそちらを優先してスクロールしない）
  const now = new Date();
  if (!BD.some(m => m.b[1] === now.getMonth() + 1 && m.b[2] === now.getDate() && (!activeOnly || !m.graduated))) {
    const el = document.getElementById("bd-m" + (now.getMonth() + 1));
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
  }
}
init();
