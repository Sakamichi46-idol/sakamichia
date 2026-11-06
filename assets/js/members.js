// メンバーページ：206人の一覧・検索と、ブログ/楽曲/ライブを横断した詳細表示
const GROUPS = ["乃木坂46", "櫻坂46", "日向坂46", "欅坂46", "けやき坂46"];
const GCOL = { "乃木坂46": "#7e57c2", "櫻坂46": "#e77a9b", "日向坂46": "#5aa9d6", "欅坂46": "#5eba53", "けやき坂46": "#a4c639" };
let MEMBERS = [], PHOTOS = {}, BLOGS = {}, SONGS = [], FORMS = {}, MEMBERLIVE = {}, GAL = {}, META = {};
let fGroupSet = new Set(), fShowGrad = false, fQuery = "", fSort = "group";
// グループは複数選択可（選んだグループのいずれかに所属していれば通す＝OR、空＝すべて）
const groupMatch = mm => !fGroupSet.size || (mm.groups || [mm.group]).some(g => fGroupSet.has(g));
// 期の複数選択プルダウン（値は期番号の文字列の Set、選択同士は OR、空＝すべての期）
const fGenSet = new Set(); let genMS = null;
// 推し登録：localStorage の "sakamichia-favs"（メンバー名の配列）でトップページと共有する
const FAV_KEY = "sakamichia-favs";
function loadFavs() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
    return new Set(Array.isArray(v) ? v.filter(x => typeof x === "string") : []);
  } catch (e) { return new Set(); }
}
let FAVS = loadFavs();
function saveFavs() { try { localStorage.setItem(FAV_KEY, JSON.stringify([...FAVS])); } catch (e) {} }
function photoURL(name) { const f = PHOTOS[name]; return f ? BASE + "assets/member-photos/" + f : ""; }
// メンバー個別ページのスラッグ（写真ファイル名が正）
function slugOf(name) { const f = PHOTOS[name]; return f ? f.replace(/\.jpg$/, "").replace(/_/g, "-") : ""; }
function galURL(name, f) { const p = PHOTOS[name]; if (!p) return ""; return BASE + "assets/member-gallery/" + p.replace(/\.jpg$/, "") + "/" + f; }
// メイン表示は常に最新の歴代アー写（ギャラリーの最後の1枚）。ギャラリーが無い人はプロフィール写真
function latestGal(name) { const g = GAL[name] || []; return g.length ? g[g.length - 1] : null; }
function mainPhotoURL(name) { const l = latestGal(name); return l ? galURL(name, l.f) : photoURL(name); }
function galCap(g, isLatest) { return `${g.t ? g.t : "アー写"}${g.y ? `（${g.y}年）` : ""}${isLatest ? "・最新" : ""}`; }
// 所属は「最後に所属していたグループ」で表す（改名・移籍の世代順で判定）
const ERA_RANK = { "けやき坂46": 1, "欅坂46": 2, "櫻坂46": 3, "日向坂46": 3, "乃木坂46": 0 };
function lastGroup(m) {
  const gs = (m.groups && m.groups.length) ? m.groups : [m.group];
  let best = m.group, br = -1;
  for (const g of gs) { const r = (g in ERA_RANK) ? ERA_RANK[g] : 0; if (r > br) { br = r; best = g; } }
  return best;
}
// 並び順の「グループ」は改名をまたぐ系統で見る（櫻坂46・欅坂46は同一系統、日向坂46・けやき坂46も同一系統）。
// 表示上の所属（lastGroup）は最後の所属のままだが、並びは系統→期→五十音とする
// （欅坂46時代に卒業した1期生が、櫻坂46の2期生より下に来ないようにするため）。
const FAMILY = { "乃木坂46": "乃木坂46", "櫻坂46": "櫻坂46", "欅坂46": "櫻坂46", "日向坂46": "日向坂46", "けやき坂46": "日向坂46" };
function familyOf(m) { const lg = lastGroup(m); return FAMILY[lg] || lg; }
const isExchange = m => m.name === "松井玲奈";   // SKE48からの交換留学生
const genKey = m => (m.gen > 0 ? m.gen : 99);    // 期なし（ポカ・交換留学生）はグループ内の最後尾
function centerSongsOf(name, titleOnly = false) {
  // Wセンターは「A・B」形式なので分割して判定し、時系列順（発売日→収録順）で返す
  return SONGS.filter(s => s.center && s.center.split("・").includes(name) && (!titleOnly || s.type === "表題曲"))
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.ord || 0) - (b.ord || 0));
}
function cardHTML(m) {
  const url = mainPhotoURL(m.name);
  const lg = lastGroup(m);
  const ph = url ? `<img loading="lazy" src="${esc(url)}" alt="">` : `<span class="fm-initial" style="background:${GCOL[lg] || "#999"}">${esc(m.name.slice(0, 1))}</span>`;
  const genTxt = isExchange(m) ? "・交換留学生" : (m.gen ? "・" + m.gen + "期" : "");
  return `<button type="button" class="mb-card" data-name="${esc(m.name)}">${FAVS.has(m.name) ? `<span class="mb-fav" title="推し登録済み">★</span>` : ""}<span class="mb-photo">${ph}</span><span class="fm-name">${esc(m.name)}</span><span class="fm-sub">${esc(lg)}${genTxt}${m.graduated ? "・卒業" : ""}</span><span class="fm-sub">ブログ ${BLOGS[m.name] || 0}件</span></button>`;
}
function render() {
  saveState();
  let list = MEMBERS.filter(m =>
    (groupMatch(m))
    && (!fGenSet.size || fGenSet.has(String(m.gen)))
    && (fShowGrad || !m.graduated)
    && (!fQuery || m.name.includes(fQuery) || (m.reading || "").includes(fQuery)));
  const order = g => GROUPS.indexOf(g);
  if (fSort === "kana") list.sort((a, b) => (a.reading || a.name).localeCompare(b.reading || b.name, "ja"));
  else if (fSort === "blog") list.sort((a, b) => (BLOGS[b.name] || 0) - (BLOGS[a.name] || 0));
  else if (fSort === "center") list.sort((a, b) => centerSongsOf(b.name).length - centerSongsOf(a.name).length);
  else if (fSort === "centerT") list.sort((a, b) => centerSongsOf(b.name, true).length - centerSongsOf(a.name, true).length);
  else list.sort((a, b) => order(familyOf(a)) - order(familyOf(b)) || genKey(a) - genKey(b) || (a.reading || a.name).localeCompare(b.reading || b.name, "ja"));
  document.getElementById("mbCount").textContent = fShowGrad
    ? `${list.length}人`
    : `現役 ${list.length}人を表示中（全${MEMBERS.length}人）`;
  const grid = document.getElementById("mbGrid");
  if (!list.length) {
    grid.innerHTML = `<p style="color:var(--muted)">条件に合うメンバーがいません。</p>`;
  } else if (fSort === "group") {
    // グループ・期生順のときは系統ごとに区切り見出しを入れる
    const FAMLABEL = { "乃木坂46": "乃木坂46", "櫻坂46": "櫻坂46・欅坂46", "日向坂46": "日向坂46・けやき坂46" };
    let html = "", lastFam = null;
    for (const m of list) {
      const fam = familyOf(m);
      if (fam !== lastFam) {
        lastFam = fam;
        html += `<div class="mb-sec" style="--page:${GCOL[fam] || "#999"}">${esc(FAMLABEL[fam] || fam)}</div>`;
      }
      html += cardHTML(m);
    }
    grid.innerHTML = html;
  } else {
    grid.innerHTML = list.map(cardHTML).join("");
  }
  grid.querySelectorAll(".mb-card").forEach(c => c.addEventListener("click", () => { const sl = slugOf(c.dataset.name); if (sl) location.href = sl + "/"; }));
}
function syncGenOptions() {
  // 選択肢は表示中グループに実在する期だけにし、無くなった期の選択は自動で外す（MS 側で剪定される）
  const gens = [...new Set(MEMBERS.filter(m => groupMatch(m)).map(m => m.gen).filter(g => g > 0))].sort((a, b) => a - b);
  if (genMS) genMS.setOptions(gens.map(g => ({ value: String(g), label: g + "期生" })));
}

// 絞り込み条件の保存・復元（ブログと同じ方式：一覧へ戻ったときに条件を保つ）
const SKEY="sakamichia-filters-members";
function saveState(){
  try{ localStorage.setItem(SKEY, JSON.stringify({g:[...fGroupSet], gen:[...fGenSet], grad:fShowGrad, q:fQuery, sort:fSort})); }catch(e){}
}
function loadState(){ try{ return JSON.parse(localStorage.getItem(SKEY)||"null"); }catch(e){ return null; } }
async function init() {
  document.getElementById("mbCount").textContent = "読み込み中…";
  document.getElementById("mbGrid").innerHTML = `<p style="color:var(--muted)">読み込み中…</p>`;
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
  MEMBERLIVE = await loadJSON("member-live.json");
  GAL = await loadJSON("member-galleries.json");
  META = await loadJSON("member-meta.json");
  if (!META || Array.isArray(META)) META = {};
  if (!GAL || Array.isArray(GAL)) GAL = {};
  if (!Array.isArray(MEMBERS)) MEMBERS = [];
  if (!Array.isArray(SONGS)) SONGS = [];
  if (!FORMS || Array.isArray(FORMS)) FORMS = {};
  if (!MEMBERLIVE || Array.isArray(MEMBERLIVE)) MEMBERLIVE = {};
  const chips = document.getElementById("mbGroups");
  const paintChips = () => chips.querySelectorAll("button").forEach(x =>
    x.classList.toggle("on", x.dataset.g === "all" ? !fGroupSet.size : fGroupSet.has(x.dataset.g)));
  chips.innerHTML = ["all", ...GROUPS].map(g =>
    `<button type="button" class="ychip" data-g="${g}">${g === "all" ? "すべて" : g}</button>`).join("");
  paintChips();
  chips.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.g === "all") fGroupSet.clear();
    else if (fGroupSet.has(b.dataset.g)) fGroupSet.delete(b.dataset.g);
    else fGroupSet.add(b.dataset.g);
    fGenSet.clear(); syncGenOptions(); paintChips();
    render();
  }));
  genMS = createMultiSelect(document.getElementById("mbGenMS"), {
    allLabel: "すべての期", selected: fGenSet, ariaLabel: "期生",
    options: [], onChange: render
  });
  syncGenOptions();
  document.getElementById("mbQuery").addEventListener("input", e => { fQuery = e.target.value.trim(); render(); });
  // 検索サジェスト：名前・読みから候補を出す。卒業生が選ばれたら「卒業生も表示」を自動でオンにする
  attachSuggest(document.getElementById("mbQuery"), q => {
    const hits = t => kanaNorm(String(t || "").toLowerCase()).includes(kanaNorm(q.toLowerCase()));
    return MEMBERS.filter(m => hits(m.name) || hits(m.reading)).slice(0, 8).map(m => ({
      kind: "メンバー", cls: "member", label: m.name,
      sub: [lastGroup(m), m.gen ? m.gen + "期" : "", m.graduated ? "卒業" : ""].filter(Boolean).join(" ・ ")
    }));
  }, (it, input) => {
    const m = MEMBERS.find(x => x.name === it.label);
    if (m && m.graduated && !fShowGrad) { fShowGrad = true; document.getElementById("mbShowGrad").checked = true; }
    input.value = it.label; fQuery = it.label; render(); input.focus();
  });
  document.getElementById("mbShowGrad").addEventListener("change", e => { fShowGrad = e.target.checked; render(); });
  document.getElementById("mbSort").addEventListener("input", e => { fSort = e.target.value; render(); });
  // 条件をリセット：グループ・期・卒業生表示・検索・並び替えをすべて初期状態に戻す
  document.getElementById("mbReset").addEventListener("click", () => {
    fGroupSet.clear(); fGenSet.clear(); fShowGrad = false; fQuery = ""; fSort = "group";
    document.getElementById("mbQuery").value = "";
    document.getElementById("mbShowGrad").checked = false;
    document.getElementById("mbSort").value = "group";
    paintChips();
    syncGenOptions();
    render();
  });
  // 保存済みの絞り込み条件を復元する
  const saved=loadState();
  if (saved) {
    (saved.g||[]).forEach(v=>fGroupSet.add(v));
    paintChips();
    syncGenOptions();
    (saved.gen||[]).forEach(v=>fGenSet.add(v));
    if (genMS) genMS.refresh();
    fShowGrad=!!saved.grad;
    document.getElementById("mbShowGrad").checked=fShowGrad;
    fQuery=saved.q||"";
    document.getElementById("mbQuery").value=fQuery;
    fSort=saved.sort||"group";
    document.getElementById("mbSort").value=fSort;
  }
  // ?member= の旧ディープリンクは個別ページへ引き継ぐ
  const q = new URLSearchParams(location.search).get("member");
  if (q && MEMBERS.some(m => m.name === q)) { location.replace(slugOf(q) + "/"); return; }
  render();
}
init();
