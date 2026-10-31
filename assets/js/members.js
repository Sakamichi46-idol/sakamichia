// メンバーページ：206人の一覧・検索と、ブログ/楽曲/ライブを横断した詳細表示
const GROUPS = ["乃木坂46", "櫻坂46", "日向坂46", "欅坂46", "けやき坂46"];
const GCOL = { "乃木坂46": "#7e57c2", "櫻坂46": "#e77a9b", "日向坂46": "#5aa9d6", "欅坂46": "#5eba53", "けやき坂46": "#a4c639" };
let MEMBERS = [], PHOTOS = {}, BLOGS = {}, SONGS = [], FORMS = {}, MEMBERLIVE = {}, GAL = {};
let fGroup = "all", fGen = "all", fShowGrad = false, fQuery = "", fSort = "group";
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
function favBtnLabel(name) { return FAVS.has(name) ? "★ 推し登録済み（タップで解除）" : "☆ 推しに登録"; }
// 推し写真：歴代アー写から選んだ1枚を localStorage の "sakamichia-fav-photos"（{名前: ギャラリーのファイル名}）に保存し、
// 推しフローティングボタン（common.js）などの個人用表示にだけ使う。
// メンバーページのメイン写真はサイト共通ルールどおり常に最新の歴代アー写のままで、ここでは変更しない。
const FAVPHOTO_KEY = "sakamichia-fav-photos";
function loadFavPhotos() {
  try {
    const v = JSON.parse(localStorage.getItem(FAVPHOTO_KEY) || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = {};
      for (const [k, val] of Object.entries(v)) if (typeof val === "string" && val) o[k] = val;
      return o;
    }
  } catch (e) {}
  return {};
}
let FAVPHOTOS = loadFavPhotos();
function saveFavPhotos() { try { localStorage.setItem(FAVPHOTO_KEY, JSON.stringify(FAVPHOTOS)); } catch (e) {} }

function photoURL(name) { const f = PHOTOS[name]; return f ? BASE + "assets/member-photos/" + f : ""; }
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
function formCountOf(name) {
  let n = 0;
  for (const k in FORMS) {
    const f = FORMS[k];
    if ((f.rows && f.rows.flat().includes(name)) || (f.vocal && f.vocal.includes(name))) n++;
  }
  return n;
}
function liveStatsOf(name) {
  // data/member-live.json（全員歌唱曲のある公演は当日在籍メンバー全員を参加として集計済み）
  const s = MEMBERLIVE[name] || {};
  return { shows: s.shows || 0, centers: s.centers || 0 };
}
function cardHTML(m) {
  const url = mainPhotoURL(m.name);
  const lg = lastGroup(m);
  const ph = url ? `<img loading="lazy" src="${esc(url)}" alt="">` : `<span class="fm-initial" style="background:${GCOL[lg] || "#999"}">${esc(m.name.slice(0, 1))}</span>`;
  const genTxt = isExchange(m) ? "・交換留学生" : (m.gen ? "・" + m.gen + "期" : "");
  return `<button type="button" class="mb-card" data-name="${esc(m.name)}">${FAVS.has(m.name) ? `<span class="mb-fav" title="推し登録済み">★</span>` : ""}<span class="mb-photo">${ph}</span><span class="fm-name">${esc(m.name)}</span><span class="fm-sub">${esc(lg)}${genTxt}${m.graduated ? "・卒業" : ""}</span><span class="fm-sub">ブログ ${BLOGS[m.name] || 0}件</span></button>`;
}
function render() {
  let list = MEMBERS.filter(m =>
    (fGroup === "all" || (m.groups || [m.group]).includes(fGroup))
    && (fGen === "all" || m.gen === +fGen)
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
  grid.querySelectorAll(".mb-card").forEach(c => c.addEventListener("click", () => openMember(c.dataset.name)));
}
function openMember(name) {
  const m = MEMBERS.find(x => x.name === name); if (!m) return;
  const url = mainPhotoURL(name);
  const cs = centerSongsOf(name);
  const cst = centerSongsOf(name, true);
  const ls = liveStatsOf(name);
  const fc = formCountOf(name);
  const lg = lastGroup(m);
  const others = (m.groups || []).filter(g => g !== lg);
  const dlg = document.getElementById("dlg");
  dlg.style.setProperty("--page", GCOL[lg] || "#2b2430");
  const gal = GAL[name] || [];
  const latest = gal.length ? gal[gal.length - 1] : null;
  const mainCapTxt = latest ? galCap(latest, true) : "現在のアー写";
  const galHTML = gal.length >= 2 ? `
    <div class="mb-gal">
      <h4 style="margin:14px 0 6px">歴代アー写など（${gal.length}枚）</h4>
      <div class="mb-gal-strip">${gal.map((g, i) => {
        const isLatest = i === gal.length - 1;
        const cap = galCap(g, isLatest);
        const lab = g.y ? String(g.y) : (g.t ? g.t.slice(0, 6) : `${i + 1}枚目`);
        return `<button type="button" class="mb-gal-th${isLatest ? " on" : ""}" data-src="${esc(galURL(name, g.f))}" data-cap="${esc(cap)}" data-f="${esc(g.f)}"><img loading="lazy" src="${esc(galURL(name, g.f))}" alt=""><span>${esc(lab)}</span></button>`;
      }).join("")}</div>
      <p class="mb-gal-note">タップすると上の写真が切り替わります。上の写真をタップすると最新のアー写に戻ります。</p>
    </div>` : "";
  document.getElementById("dlgBody").innerHTML = `
    <div class="mb-detail">
      <div class="mb-dphoto">${url ? `<img id="mbMainImg" src="${esc(url)}" alt="">` : `<span class="fm-initial" style="background:${GCOL[lg] || "#999"}">${esc(name.slice(0, 1))}</span>`}<p class="mb-cap" id="mbMainCap">${esc(mainCapTxt)}</p></div>
      <div class="mb-dinfo">
        <h3 style="margin:0 0 4px">${esc(name)}</h3>
        <p style="margin:0 0 2px;color:var(--muted)">${esc(m.reading || "")}</p>
        <p>${groupChip(lg)}${isExchange(m) ? " 交換留学生（SKE48から）" : (m.gen ? ` ${m.gen}期生` : "")}${m.graduated ? ` ・ <b>卒業・活動終了</b>` : " ・ 現役"}${others.length ? `<br>所属歴：${others.map(esc).join("、")}` : ""}</p>
        <p>センター曲：<b>${cs.length}曲</b>（シングル表題曲センター：<b>${cst.length}曲</b>）　フォーメーション/歌唱参加：<b>${fc}曲</b><br>ライブ記録：センター <b>${ls.centers}公演</b>・出演記録のある公演 <b>${ls.shows}公演</b><br>ブログ記事：<b>${BLOGS[name] || 0}件</b></p>
        ${cs.length ? `<h4 style="margin:10px 0 4px">センター曲</h4><p style="line-height:2">${cs.map(s => esc(s.title)).join("、")}</p>` : ""}
        <p class="mb-links"><a class="btn" href="../blog/?member=${encodeURIComponent(name)}">この人のブログを見る</a> <a class="btn" href="../live/?member=${encodeURIComponent(name)}">ライブ記録で見る</a> <button type="button" class="btn" id="favBtn" aria-pressed="${FAVS.has(name)}">${favBtnLabel(name)}</button></p>
        <p style="color:var(--muted);font-size:12px;margin:2px 0 0">推しに登録すると、トップページに「推しの新着」（最新のブログ）が出ます。</p>
      </div>
    </div>${galHTML}<div id="favPhotoRow"></div>`;
  // 推し写真コントロール：いま大きく表示している歴代アー写（curF）を推し写真として設定／変更／解除する。
  // 推し登録済みで、ギャラリーがあり写真ファイル名が解決できるメンバーだけに出す。
  let curF = latest ? latest.f : null;
  const favPhotoRow = document.getElementById("favPhotoRow");
  const capOfF = f => { const g = gal.find(x => x.f === f); return g ? galCap(g, g === latest) : f; };
  function renderFavPhotoCtl() {
    if (!favPhotoRow) return;
    if (!FAVS.has(name) || !gal.length || !PHOTOS[name]) { favPhotoRow.innerHTML = ""; return; }
    const setF = FAVPHOTOS[name] || null;
    let inner;
    if (setF && setF === curF) {
      inner = `<span>推し写真：<b>この写真</b>に設定済みです。</span> <button type="button" class="btn" id="favPhotoClear">推し写真を最新に戻す</button>`;
    } else if (setF) {
      inner = `<span>推し写真：<b>${esc(capOfF(setF))}</b>に設定済みです。</span> <button type="button" class="btn" id="favPhotoSet">表示中の写真に変更する</button> <button type="button" class="btn" id="favPhotoClear">推し写真を最新に戻す</button>`;
    } else {
      inner = `<span>推し写真は未設定です（推しボタンなどでは最新の写真が出ます）。</span> <button type="button" class="btn" id="favPhotoSet">この写真を推し写真にする</button>`;
    }
    favPhotoRow.innerHTML = `<p style="margin:10px 0 0">${inner}</p>`;
    const setBtn = document.getElementById("favPhotoSet");
    if (setBtn) setBtn.addEventListener("click", () => {
      if (!curF) return;
      FAVPHOTOS[name] = curF; saveFavPhotos(); renderFavPhotoCtl();
    });
    const clrBtn = document.getElementById("favPhotoClear");
    if (clrBtn) clrBtn.addEventListener("click", () => {
      delete FAVPHOTOS[name]; saveFavPhotos(); renderFavPhotoCtl();
    });
  }
  renderFavPhotoCtl();
  const favBtn = document.getElementById("favBtn");
  if (favBtn) favBtn.addEventListener("click", () => {
    if (FAVS.has(name)) FAVS.delete(name); else FAVS.add(name);
    saveFavs();
    favBtn.textContent = favBtnLabel(name);
    favBtn.setAttribute("aria-pressed", String(FAVS.has(name)));
    renderFavPhotoCtl();   // 推し写真コントロールの出し分けも追随させる
    render();   // カード側の ★ バッジも追随させる
  });
  const mainImg = document.getElementById("mbMainImg"), mainCap = document.getElementById("mbMainCap");
  if (mainImg) {
    document.querySelectorAll(".mb-gal-th").forEach(th => th.addEventListener("click", () => {
      mainImg.src = th.dataset.src;
      curF = th.dataset.f || null;
      if (mainCap) mainCap.textContent = th.dataset.cap;
      document.querySelectorAll(".mb-gal-th").forEach(x => x.classList.toggle("on", x === th));
      renderFavPhotoCtl();
    }));
    mainImg.addEventListener("click", () => {
      mainImg.src = url;
      curF = latest ? latest.f : null;
      if (mainCap) mainCap.textContent = mainCapTxt;
      document.querySelectorAll(".mb-gal-th").forEach(x => x.classList.toggle("on", x.dataset.src === url));
      renderFavPhotoCtl();
    });
  }
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
  if (!GAL || Array.isArray(GAL)) GAL = {};
  if (!Array.isArray(MEMBERS)) MEMBERS = [];
  if (!Array.isArray(SONGS)) SONGS = [];
  if (!FORMS || Array.isArray(FORMS)) FORMS = {};
  if (!MEMBERLIVE || Array.isArray(MEMBERLIVE)) MEMBERLIVE = {};
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
  document.getElementById("mbShowGrad").addEventListener("change", e => { fShowGrad = e.target.checked; render(); });
  document.getElementById("mbGen").addEventListener("input", e => { fGen = e.target.value; render(); });
  document.getElementById("mbSort").addEventListener("input", e => { fSort = e.target.value; render(); });
  // 条件をリセット：グループ・期・卒業生表示・検索・並び替えをすべて初期状態に戻す
  document.getElementById("mbReset").addEventListener("click", () => {
    fGroup = "all"; fGen = "all"; fShowGrad = false; fQuery = ""; fSort = "group";
    document.getElementById("mbQuery").value = "";
    document.getElementById("mbShowGrad").checked = false;
    document.getElementById("mbSort").value = "group";
    chips.querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.g === "all"));
    syncGenOptions();
    render();
  });
  // ?member= で直接詳細を開く
  const q = new URLSearchParams(location.search).get("member");
  render();
  if (q && MEMBERS.some(m => m.name === q)) openMember(q);
}
init();
