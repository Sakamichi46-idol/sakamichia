// 在籍日数ランキング：draft-members（名前・期）＋ draft-timeline（加入日・卒業日）から日数を計算する
let TN = [], TN_PHOTOS = {}, tnGroup = "", tnQuery = "";
const TN_GROUP_ORDER = ["乃木坂46", "櫻坂46", "日向坂46", "欅坂46", "けやき坂46"];
function tnPhoto(name) { const f = TN_PHOTOS[name]; return f ? BASE + "assets/member-photos/" + f : ""; }
function tnParse(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function tnDays(a, b) { return Math.round((b - a) / 86400000); }
function tnSpan(a, b) {
  let y = b.getFullYear() - a.getFullYear();
  let m = b.getMonth() - a.getMonth();
  let d = b.getDate() - a.getDate();
  if (d < 0) { m--; d += new Date(b.getFullYear(), b.getMonth(), 0).getDate(); }
  if (m < 0) { y--; m += 12; }
  return y > 0 ? `${y}年${m}ヶ月` : (m > 0 ? `${m}ヶ月${d}日` : `${d}日`);
}
function tnFmtDate(s) { const [y, m, d] = s.split("-").map(Number); return `${y}/${m}/${d}`; }
function tnRow(m, rank) {
  const photo = tnPhoto(m.name);
  return `<a class="bd-row" href="../members/?member=${encodeURIComponent(m.name)}">
    ${photo ? `<img class="bd-thumb" src="${esc(photo)}" alt="" loading="lazy">` : `<span class="bd-thumb bd-nophoto"></span>`}
    <span class="bd-date"><b>${rank}位</b></span>
    <span class="bd-main"><span class="bd-name">${esc(m.name)}</span>
    <span class="bd-sub">${groupChip(m.group)}${m.gen ? `<span class="tag">${esc(m.gen)}期</span>` : ""}${m.graduated ? `<span class="tag">卒業</span>` : `<span class="tag">現役</span>`}<span class="bd-year">${tnFmtDate(m.joined)}加入${m.left ? ` 〜 ${tnFmtDate(m.left)}卒業` : " 〜 在籍中"}</span></span></span>
    <span class="tn-days"><b>${m.days.toLocaleString("ja-JP")}日</b><small>${esc(m.span)}</small></span></a>`;
}
function render() {
  const activeOnly = document.getElementById("tnActiveOnly").checked;
  const gradOnly = document.getElementById("tnGradOnly").checked;
  const q = kanaNorm(tnQuery.trim().toLowerCase());
  const list = TN.filter(m =>
    (!tnGroup || m.group === tnGroup) &&
    (!activeOnly || !m.graduated) && (!gradOnly || m.graduated) &&
    (!q || kanaNorm((m.name + " " + (m.reading || "")).toLowerCase()).includes(q)));
  let rank = 0, prevDays = -1;
  const rows = list.map((m, i) => {
    if (m.days !== prevDays) { rank = i + 1; prevDays = m.days; }
    return tnRow(m, rank);
  });
  document.getElementById("tnCount").textContent = `${list.length}人を表示中（全${TN.length}人）`;
  document.getElementById("tnBody").innerHTML = rows.length
    ? `<div class="bd-list">${rows.join("")}</div>`
    : `<p style="color:var(--muted)">該当するメンバーがいません。</p>`;
}
async function init() {
  const [members, draftMembers, timeline, photos] = await Promise.all([
    loadJSON("members.json"), loadJSON("draft-members.json"), loadJSON("draft-timeline.json"), loadJSON("member-photos.json")]);
  TN_PHOTOS = photos || {};
  const byName = {}; (members || []).forEach(m => byName[m.name] = m);
  const tl = (timeline && timeline.members) || {};
  const today = new Date(); today.setHours(0, 0, 0, 0);
  TN = (draftMembers || []).map(dm => {
    const t = tl[dm.id];
    const base = byName[dm.name] || {};
    if (!t || !t.joined) return null;
    const joined = tnParse(t.joined);
    const end = t.left ? tnParse(t.left) : today;
    return {
      name: dm.name, reading: dm.reading || base.reading || "",
      group: base.group || "", gen: base.gen || dm.generation || "",
      graduated: !!base.graduated, joined: t.joined, left: t.left || null,
      days: tnDays(joined, end), span: tnSpan(joined, end),
    };
  }).filter(Boolean).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, "ja"));
  // グループチップ（表示グループの並び順で）
  const groups = [...new Set(TN.map(m => m.group))].sort((a, b) => TN_GROUP_ORDER.indexOf(a) - TN_GROUP_ORDER.indexOf(b));
  const gwrap = document.getElementById("tnGroups");
  gwrap.innerHTML = [`<button type="button" class="ychip tn-gchip on" data-g="">すべて</button>`,
    ...groups.map(g => `<button type="button" class="ychip tn-gchip" data-g="${esc(g)}">${esc(g)}</button>`)].join("");
  gwrap.querySelectorAll(".tn-gchip").forEach(b => b.addEventListener("click", () => {
    tnGroup = b.dataset.g;
    gwrap.querySelectorAll(".tn-gchip").forEach(x => x.classList.toggle("on", x === b));
    render();
  }));
  document.getElementById("tnActiveOnly").addEventListener("change", render);
  document.getElementById("tnGradOnly").addEventListener("change", render);
  document.getElementById("tnQuery").addEventListener("input", e => { tnQuery = e.target.value; render(); });
  render();
}
init();
