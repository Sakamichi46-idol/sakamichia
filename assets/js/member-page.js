// メンバー個別ページ：推し登録・歴代アー写の切り替え・推し写真設定
// （一覧ページの詳細ダイアログと同じ操作を、個別ページ用に用意したもの）
(function () {
  const dataEl = document.getElementById("memberData");
  if (!dataEl) return;
  const MD = JSON.parse(dataEl.textContent || "{}");
  const name = MD.name;
  const FAV_KEY = "sakamichia-favs";
  const FAVPHOTO_KEY = "sakamichia-fav-photos";
  function loadFavs() {
    try {
      const v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
      return new Set(Array.isArray(v) ? v.filter(x => typeof x === "string") : []);
    } catch (e) { return new Set(); }
  }
  function saveFavs() { try { localStorage.setItem(FAV_KEY, JSON.stringify([...FAVS])); } catch (e) {} }
  let FAVS = loadFavs();
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
  function favBtnLabel() { return FAVS.has(name) ? "★ 推し登録済み（タップで解除）" : "☆ 推しに登録"; }

  const gal = [...document.querySelectorAll(".mb-gal-th")].map(th => ({
    f: th.dataset.f, cap: th.dataset.cap, el: th
  }));
  const latestF = MD.latestF || null;
  let curF = latestF;
  const capOfF = f => { const g = gal.find(x => x.f === f); return g ? g.cap : f; };

  const favPhotoRow = document.getElementById("favPhotoRow");
  function renderFavPhotoCtl() {
    if (!favPhotoRow) return;
    if (!FAVS.has(name) || !gal.length || !latestF) { favPhotoRow.innerHTML = ""; return; }
    const setF = FAVPHOTOS[name] || null;
    let inner;
    if (setF && setF === curF) {
      inner = `<span>推し写真：<b>この写真</b>に設定済みです。</span> <button type="button" class="btn" id="favPhotoClear">推し写真を最新に戻す</button>`;
    } else if (setF) {
      inner = `<span>推し写真：<b>${capOfF(setF)}</b>に設定済みです。</span> <button type="button" class="btn" id="favPhotoSet">表示中の写真に変更する</button> <button type="button" class="btn" id="favPhotoClear">推し写真を最新に戻す</button>`;
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

  const favBtn = document.getElementById("favBtn");
  if (favBtn) {
    favBtn.textContent = favBtnLabel();
    favBtn.setAttribute("aria-pressed", String(FAVS.has(name)));
    favBtn.addEventListener("click", () => {
      if (FAVS.has(name)) FAVS.delete(name); else FAVS.add(name);
      saveFavs();
      favBtn.textContent = favBtnLabel();
      favBtn.setAttribute("aria-pressed", String(FAVS.has(name)));
      renderFavPhotoCtl();
    });
  }

  const mainImg = document.getElementById("mbMainImg"), mainCap = document.getElementById("mbMainCap");
  if (mainImg && gal.length) {
    gal.forEach(g => g.el.addEventListener("click", () => {
      mainImg.src = g.el.dataset.src;
      curF = g.f || null;
      if (mainCap) mainCap.textContent = g.cap;
      gal.forEach(x => x.el.classList.toggle("on", x === g));
      renderFavPhotoCtl();
    }));
    mainImg.addEventListener("click", () => {
      mainImg.src = MD.latestSrc;
      curF = latestF;
      if (mainCap) mainCap.textContent = MD.latestCap;
      gal.forEach(x => x.el.classList.toggle("on", x.el.dataset.src === MD.latestSrc));
      renderFavPhotoCtl();
    });
  }
  renderFavPhotoCtl();
})();
