// メンバーページ：206人の一覧・検索と、ブログ/楽曲/ライブを横断した詳細表示
const GROUPS = ["乃木坂46", "櫻坂46", "日向坂46", "欅坂46", "けやき坂46"];
const GCOL = { "乃木坂46": "#7e57c2", "櫻坂46": "#e77a9b", "日向坂46": "#5aa9d6", "欅坂46": "#5eba53", "けやき坂46": "#a4c639" };
let MEMBERS = [], PHOTOS = {}, BLOGS = {}, SONGS = [], FORMS = {}, LIVEIDX = {};
let fGroup = "all", fGen = "all", fStatus = "all", fQuery = "", fSort = "group";

function photoURL(name) { const f = PHOTOS[name]; return f ? BASE + "assets/member-photos/" + f : ""; }
function centerSongsOf(name) { return SONGS.filter(s => s.center === name); }
function formCountOf(name) {
  let n = 0;
  for (const k in FORMS) {
    const f = FORMS[k];
    if ((f.rows && f.rows.flat().includes(name)) || (f.vocal && f.vocal.includes(name))) n++;
  }
  return n;
}
function liveStatsOf(name) {
  let shows = 0, centers = 0;
  for (const id in LIVEIDX) {
    const e = LIVEIDX[id];
    const inp = (e.p || []).includes(name), inc = (e.c || []).includes(name);
    if (inp || inc) shows++;
    if (inc) centers++;
  }
  return { shows, centers };
}
function cardHTML(m) {
  const url = photoURL(m.name);
  const ph = url ? `<img loading="lazy" src="${esc(url)}" alt="">` : `<span class="fm-initial" style="background:${GCOL[m.group] || "#999"}">${esc(m.name.slice(0, 1))}</span>`;
  return `<button type="button" class="mb-card" data-name="${esc(m.name)}"><span class="mb-photo">${ph}</span><span class="fm-name">${esc(m.name)}</span><span class="fm-sub">${esc(m.group)}${m.gen ? "・" + m.gen + "期" : ""}${m.graduated ? "・卒業" : ""}</span><span class="fm-sub">ブログ ${BLOGS[m.name] || 0}件</span></button>`;
}
function render() {
  let list = MEMBERS.filter(m =>
    (fGroup === "all" || (m.groups || [m.group]).includes(fGroup))
    && (fGen === "all" || m.gen === +fGen)
    && (fStatus === "all" || (fStatus === "active" ? !m.graduated : !!m.graduated))
    && (!fQuery || m.name.includes(fQuery) || (m.reading || "").includes(fQuery)));
  const order = g => GROUPS.indexOf(g);
  if (fSort === "kana") list.sort((a, b) => (a.reading || a.name).localeCompare(b.reading || b.name, "ja"));
  else if (fSort === "blog") list.sort((a, b) => (BLOGS[b.name] || 0) - (BLOGS[a.name] || 0));
  else if (fSort === "center") list.sort((a, b) => centerSongsOf(b.name).length - centerSongsOf(a.name).length);
  else list.sort((a, b) => order(a.group) - order(b.group) || a.gen - b.gen || (a.reading || a.name).localeCompare(b.reading || b.name, "ja"));
  document.getElementById("mbCount").textContent = `${list.length}人`;
  const grid = document.getElementById("mbGrid");
  grid.innerHTML = list.map(cardHTML).join("") || `<p style="color:var(--muted)">条件に合うメンバーがいません。</p>`;
  grid.querySelectorAll(".mb-card").forEach(c => c.addEventListener("click", () => openMember(c.dataset.name)));
}
function openMember(name) {
  const m = MEMBERS.find(x => x.name === name); if (!m) return;
  const url = photoURL(name);
  const cs = centerSongsOf(name);
  const ls = liveStatsOf(name);
  const fc = formCountOf(name);
  const others = (m.groups || []).filter(g => g !== m.group);
  const dlg = document.getElementById("dlg");
  dlg.style.setProperty("--page", GCOL[m.group] || "#2b2430");
  document.getElementById("dlgBody").innerHTML = `
    <div class="mb-detail">
      <div class="mb-dphoto">${url ? `<img src="${esc(url)}" alt="">` : `<span class="fm-initial" style="background:${GCOL[m.group] || "#999"}">${esc(name.slice(0, 1))}</span>`}</div>
      <div class="mb-dinfo">
        <h3 style="margin:0 0 4px">${esc(name)}</h3>
        <p style="margin:0 0 2px;color:var(--muted)">${esc(m.reading || "")}</p>
        <p>${groupChip(m.group)}${m.gen ? ` ${m.gen}期生` : ""}${m.graduated ? ` ・ <b>卒業・活動終了</b>` : " ・ 現役"}${others.length ? `<br>所属歴：${others.map(esc).join("、")}` : ""}</p>
        <p>センター曲：<b>${cs.length}曲</b>　フォーメーション/歌唱参加：<b>${fc}曲</b><br>ライブ記録：センター <b>${ls.centers}公演</b>・出演記録のある公演 <b>${ls.shows}公演</b><br>ブログ記事：<b>${BLOGS[name] || 0}件</b></p>
        ${cs.length ? `<h4 style="margin:10px 0 4px">センター曲</h4><p style="line-height:2">${cs.map(s => esc(s.title)).join("、")}</p>` : ""}
        <p class="mb-links"><a class="btn" href="../blog/?member=${encodeURIComponent(name)}">この人のブログを見る</a> <a class="btn" href="../live/?member=${encodeURIComponent(name)}">ライブ記録で見る</a></p>
      </div>
    </div>`;
  dlg.showModal();
}
function syncGenOptions() {
  const gens = [...new Set(MEMBERS.filter(m => fGroup === "all" || (m.groups || [m.group]).includes(fGroup)).map(m => m.gen).filter(g => g > 0))].sort((a, b) => a - b);
  const sel = document.getElementById("mbGen");
  sel.innerHTML = `<option value="all">すべての期</option>` + gens.map(g => `<option value="${g}">${g}期生</option>`).join("");
  sel.value = gens.includes(+fGen) ? fGen : "all";
  fGen = sel.value;
}
async function init() {
  MEMBERS = await loadJSON("members.json");
  PHOTOS = await loadJSON("member-photos.json");
  const bidx = await loadJSON("blogs/index.json");
  BLOGS = {};
  for (const [k, v] of Object.entries((bidx && bidx.memberCounts) || {})) {
    const nm = k.split("|").pop();           // キーは「グループ|名前」。複数グループ所属は合算
    BLOGS[nm] = (BLOGS[nm] || 0) + v;
  }
  SONGS = await loadJSON("songs.json");
  FORMS = await loadJSON("formations.json");
  LIVEIDX = await loadJSON("live-index.json");
  if (!Array.isArray(MEMBERS)) MEMBERS = [];
  if (!Array.isArray(SONGS)) SONGS = [];
  if (!FORMS || Array.isArray(FORMS)) FORMS = {};
  if (!LIVEIDX || Array.isArray(LIVEIDX)) LIVEIDX = {};
  const chips = document.getElementById("mbGroups");
  chips.innerHTML = ["all", ...GROUPS].map(g =>
    `<button type="button" class="ychip${fGroup === g ? " on" : ""}" data-g="${g}">${g === "all" ? "すべてのグループ" : g}</button>`).join("");
  chips.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    fGroup = b.dataset.g; fGen = "all"; syncGenOptions();
    chips.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    render();
  }));
  syncGenOptions();
  document.getElementById("mbQuery").addEventListener("input", e => { fQuery = e.target.value.trim(); render(); });
  document.getElementById("mbStatus").addEventListener("input", e => { fStatus = e.target.value; render(); });
  document.getElementById("mbGen").addEventListener("input", e => { fGen = e.target.value; render(); });
  document.getElementById("mbSort").addEventListener("input", e => { fSort = e.target.value; render(); });
  // ?member= で直接詳細を開く
  const q = new URLSearchParams(location.search).get("member");
  render();
  if (q && MEMBERS.some(m => m.name === q)) openMember(q);
}
init();
