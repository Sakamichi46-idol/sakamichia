// 条件ドラフト（1人用）：旧『坂道日和』ソロドラフトの移植。
// ルール判定は solo-engine.js（SakamichiSoloEngine）に委譲し、ここは画面と状態管理。
const KEY = "sakamichia-solo-draft-v1";
const GLABEL = { nogi: "乃木坂46", keyaki: "欅坂46", sakura: "櫻坂46", hiragana: "けやき坂46", hinata: "日向坂46" };
const GCOL_D = { nogi: "#7e57c2", keyaki: "#5eba53", sakura: "#e77a9b", hiragana: "#a4c639", hinata: "#5aa9d6" };
let R = null, MEMBERS = [], META = {}, BYID = new Map();
let state = null, selCand = null, selSlot = null, selPool = null, placingId = null, spinning = false;
let undoStack = [];

function defaultState() {
  return {
    settings: { mode: "generation", groups: ["nogi", "keyaki", "sakura", "hiragana", "hinata"], status: "all", repeat: true, passLimit: 3, placement: "unplaced", rows: [5, 6, 7], showCenter: true },
    acquired: [], used: [], pending: null, passCount: 0, history: [],
    positions: Array(18).fill(null), title: "マイ坂道選抜"
  };
}
const total = () => state.settings.rows.reduce((a, b) => a + b, 0);
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.settings && Array.isArray(s.positions) && s.positions.length === (s.settings.rows || []).reduce((a, b) => a + b, 0)) return s;
  } catch (e) {}
  return defaultState();
}
function snapshot() { undoStack.push(JSON.stringify(state)); if (undoStack.length > 25) undoStack.shift(); }
function member(id) { return BYID.get(id); }
function photoOf(id) { return (window.DraftPhotoById || {})[id] || ""; }
function opts() { return { ...state.settings, repeat: state.settings.repeat, acquired: state.acquired, used: state.used }; }
function combos() { return R.combinations(MEMBERS, META, opts()); }
function pendingBucket() {
  if (!state.pending) return null;
  const k = R.key(state.pending);
  return combos().find(x => R.key(x) === k) || { ...state.pending, memberIds: [] };
}
function msg(t) { document.getElementById("dfMsg").textContent = t; }
function comboText(x) { return `${GLABEL[x.group]} × ${R.conditionLabel(x.mode, x.value)}`; }

/* ---------- 設定 ---------- */
function renderSettings() {
  const s = state.settings;
  document.getElementById("dfMode").value = s.mode;
  document.getElementById("dfStatus").value = s.status;
  document.getElementById("dfRepeat").value = s.repeat ? "yes" : "no";
  document.getElementById("dfPassLimit").value = String(s.passLimit);
  document.getElementById("dfPlacement").value = s.placement;
  document.getElementById("dfCols").value = String(s.rows.length);
  document.getElementById("dfCenter").checked = s.showCenter;
  document.getElementById("dfTitle").value = state.title || "マイ坂道選抜";
  const gbox = document.getElementById("dfGroups");
  gbox.innerHTML = R.ORDER.map(g => `<button type="button" class="ychip${s.groups.includes(g) ? " on" : ""}" data-g="${g}">${GLABEL[g]}</button>`).join("");
  gbox.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    const g = b.dataset.g;
    if (s.groups.includes(g)) { if (s.groups.length > 1) s.groups = s.groups.filter(x => x !== g); }
    else s.groups = [...s.groups, g];
    save(); renderSettings(); renderSlot();
  }));
  const rc = document.getElementById("dfRowCtl");
  rc.innerHTML = s.rows.map((n, i) => `<span class="fm-stepper">${i + 1}列目 <button type="button" data-r="${i}" data-d="-1">−</button><b>${n}</b><button type="button" data-r="${i}" data-d="1">＋</button></span>`).join("");
  rc.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    const r = +b.dataset.r, next = s.rows[r] + (+b.dataset.d);
    if (next < 1 || next > 12) return;
    changeRows(s.rows.map((n, i) => i === r ? next : n));
  }));
  document.getElementById("dfCountLabel").textContent = `${s.rows.length}列・${total()}人`;
  const modeName = document.querySelector(`#dfMode option[value="${s.mode}"]`)?.textContent || "";
  document.getElementById("dfConfigSummary").textContent = `${modeName}・${s.rows.length}列${total()}人・${s.placement === "now" ? "指名時に配置" : "あとで配置"}`;
  // データの無い条件モードは選べないようにする
  const avail = new Set(combosAllModes());
  document.querySelectorAll("#dfMode option").forEach(o => {
    if (o.value === "random") o.disabled = avail.size < 2;
    else o.disabled = !avail.has(o.value);
  });
}
function combosAllModes() {
  return R.combinations(MEMBERS, META, { ...state.settings, mode: "random", acquired: state.acquired, used: state.used }).map(x => x.mode);
}
function changeRows(rows) {
  if (state.acquired.length && !confirm("フォーメーションの形を変えると、指名と配置はリセットされます。よろしいですか？")) { renderSettings(); return; }
  state.settings.rows = rows;
  state.acquired = []; state.used = []; state.pending = null; state.passCount = 0; state.history = [];
  state.positions = Array(rows.reduce((a, b) => a + b, 0)).fill(null);
  undoStack = []; selCand = selSlot = selPool = placingId = null;
  save(); renderAll();
}

/* ---------- スロット ---------- */
/* スロット枠：ラベルが長くても枠の大きさが変わらないよう、収まるフォントサイズへ自動調整する（枠はCSSで固定高さ） */
let wheelMeasurer = null;
function fitWheel(el) {
  if (!el || !el.clientWidth) return;
  if (!wheelMeasurer) {
    wheelMeasurer = document.createElement("div");
    wheelMeasurer.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0;font-weight:700;line-height:1.3;padding:8px 6px;box-sizing:border-box;text-align:center;pointer-events:none";
    document.body.appendChild(wheelMeasurer);
  }
  wheelMeasurer.style.width = el.clientWidth + "px";
  wheelMeasurer.textContent = el.textContent;
  let size = 19;
  wheelMeasurer.style.fontSize = size + "px";
  while (size > 10 && wheelMeasurer.offsetHeight > el.clientHeight) { size--; wheelMeasurer.style.fontSize = size + "px"; }
  el.style.fontSize = size + "px";
}
/* 候補を選んだら画面下に固定の指名バーを出す（候補が多くてもスクロールせず指名できる） */
let actionBar = null;
function renderActionBar() {
  const show = !!(state && state.pending && selCand && !spinning);
  if (show && !actionBar) {
    actionBar = document.createElement("div");
    actionBar.className = "df-actionbar";
    actionBar.innerHTML = `<span class="df-actionbar-title"></span><button type="button" class="btn">指名する</button>`;
    actionBar.querySelector("button").addEventListener("click", doPick);
    document.body.appendChild(actionBar);
  }
  if (!actionBar) return;
  if (show) {
    const m = member(selCand);
    actionBar.querySelector(".df-actionbar-title").textContent = m ? m.name : "";
    actionBar.classList.add("on");
    document.body.classList.add("dfbar-on");
  } else {
    actionBar.classList.remove("on");
    document.body.classList.remove("dfbar-on");
  }
}
function renderSlot() {
  const s = state.settings;
  const done = state.acquired.length >= total();
  document.getElementById("dfRound").textContent = done ? "完成！" : `指名 ${state.acquired.length}/${total()}人`;
  const passLeft = s.passLimit < 0 ? "∞" : Math.max(0, s.passLimit - state.passCount);
  document.getElementById("dfPass").textContent = `パス（残り${passLeft}）`;
  document.getElementById("dfPass").disabled = !state.pending || spinning || (s.passLimit >= 0 && state.passCount >= s.passLimit);
  document.getElementById("dfSpin").disabled = !!state.pending || spinning || done;
  document.getElementById("dfPick").disabled = !state.pending || !selCand || spinning;
  const wg = document.getElementById("dfWheelGroup"), wc = document.getElementById("dfWheelCond");
  if (state.pending) {
    wg.textContent = GLABEL[state.pending.group];
    wc.textContent = R.conditionLabel(state.pending.mode, state.pending.value);
    wg.parentElement.style.setProperty("--page", GCOL_D[state.pending.group]);
  } else if (!done) { wg.textContent = "？"; wc.textContent = "？"; }
  fitWheel(wg); fitWheel(wc);
  const box = document.getElementById("dfCands");
  if (state.pending && !spinning) {
    const bucket = pendingBucket();
    const ids = (bucket ? bucket.memberIds : []).filter(id => !state.acquired.includes(id));
    box.innerHTML = ids.map(id => {
      const m = member(id), url = photoOf(id);
      const ph = url ? `<img loading="lazy" src="${esc(url)}" alt="">` : `<span class="fm-initial" style="background:${GCOL_D[m.group]}">${esc(m.name.slice(0, 1))}</span>`;
      return `<button type="button" class="fm-cand${selCand === id ? " sel" : ""}" data-id="${id}"><span class="mb-photo">${ph}</span><span class="fm-name">${esc(m.name)}</span><span class="fm-sub">${GLABEL[m.group]}${m.generation ? "・" + m.generation + "期" : "・交換留学生"}${m.graduated ? "・卒業" : ""}</span></button>`;
    }).join("") || `<p style="color:var(--muted)">この条件で指名できるメンバーはいません。パスしてください。</p>`;
    box.querySelectorAll(".fm-cand").forEach(c => c.addEventListener("click", () => { selCand = c.dataset.id; renderSlot(); }));
  } else box.innerHTML = "";
  renderActionBar();
}
function spin() {
  if (state.pending || spinning) return;
  const choices = combos();
  if (!choices.length) { msg("選べる組み合わせがありません。条件や重複設定を変えてください。"); return; }
  const chosen = R.choose(choices);
  spinning = true; selCand = null; renderSlot();
  const groups = [...new Set(choices.map(x => x.group))];
  const conds = [...new Set(choices.filter(x => x.group === chosen.group && x.mode === chosen.mode).map(x => R.conditionLabel(x.mode, x.value)))];
  const wg = document.getElementById("dfWheelGroup"), wc = document.getElementById("dfWheelCond");
  let step = 0;
  const iv = setInterval(() => {
    wg.textContent = GLABEL[groups[Math.floor(Math.random() * groups.length)]];
    wc.textContent = conds[Math.floor(Math.random() * conds.length)] || "…";
    fitWheel(wg); fitWheel(wc);
    if (++step > 14) {
      clearInterval(iv);
      state.pending = { group: chosen.group, mode: chosen.mode, value: chosen.value };
      spinning = false; save(); renderSlot();
      const bucket = pendingBucket();
      msg(`${comboText(chosen)} が出ました。対象は ${bucket ? bucket.memberIds.length : 0} 人です。指名するメンバーを選んでください。`);
    }
  }, 70);
}
function doPass() {
  if (!state.pending || spinning) return;
  if (state.settings.passLimit >= 0 && state.passCount >= state.settings.passLimit) return;
  snapshot();
  const p = state.pending;
  state.history.unshift({ result: "pass", group: p.group, mode: p.mode, value: p.value });
  if (!state.settings.repeat) state.used.push(R.key(p));
  state.passCount++; state.pending = null; selCand = null;
  save(); renderAll();
  msg(`${comboText(p)} をパスしました。次のスロットを回せます。`);
}
function doPick() {
  if (!state.pending || !selCand || spinning) return;
  snapshot();
  const p = state.pending, id = selCand;
  state.acquired.push(id);
  state.history.unshift({ result: "pick", group: p.group, mode: p.mode, value: p.value, memberId: id });
  if (!state.settings.repeat) state.used.push(R.key(p));
  state.pending = null; selCand = null;
  if (state.settings.placement === "now") {
    placingId = id;
    msg(`${member(id).name} を指名しました。配置する枠をタップしてください（未配置のままにもできます）。`);
  } else msg(`${member(id).name} を指名しました。`);
  if (state.acquired.length >= total()) msg("選抜が完成しました！配置を整えて、画像で保存できます。");
  save(); renderAll();
}

/* ---------- 配置ボード ---------- */
function slotIndex(rowIdxFrontFirst, col) {
  let base = 0;
  for (let r = 0; r < rowIdxFrontFirst; r++) base += state.settings.rows[r];
  return base + col;
}
function isCenterSlot(rowFront, col, count) {
  if (!state.settings.showCenter || rowFront !== 0) return false;
  if (count % 2 === 1) return col === (count - 1) / 2;
  return col === count / 2 - 1 || col === count / 2;
}
function renderBoard() {
  const rows = state.settings.rows;
  const board = document.getElementById("dfBoard");
  let html = "";
  for (let v = rows.length - 1; v >= 0; v--) {
    const count = rows[v];
    html += `<div class="fm-row" data-row="${v}">`;
    for (let c = 0; c < count; c++) {
      const gi = slotIndex(v, c);
      const id = state.positions[gi];
      const m = id ? member(id) : null;
      const url = id ? photoOf(id) : "";
      const ctr = isCenterSlot(v, c, count);
      const ph = m ? (url ? `<img src="${esc(url)}" alt="">` : `<span class="fm-initial" style="background:${GCOL_D[m.group]}">${esc(m.name.slice(0, 1))}</span>`) : "";
      html += `<button type="button" class="fm-tile${m ? " filled" : ""}${ctr ? " ctr" : ""}${selSlot === gi ? " sel" : ""}" data-slot="${gi}">${ph}<span class="fm-name">${m ? esc(m.name) : "―"}</span>${ctr ? `<span class="fm-star">★</span>` : ""}</button>`;
    }
    html += `</div>`;
  }
  board.innerHTML = html;
  board.querySelectorAll(".fm-tile").forEach(t => t.addEventListener("click", () => onSlotTap(+t.dataset.slot)));
  const placed = state.positions.filter(Boolean).length;
  document.getElementById("dfCounts").textContent = `指名 ${state.acquired.length}/${total()}人 ・ 配置 ${placed}/${total()}人`;
  const poolIds = state.acquired.filter(id => !state.positions.includes(id));
  document.getElementById("dfPoolCount").textContent = `${poolIds.length}人`;
  const pool = document.getElementById("dfPool");
  pool.innerHTML = poolIds.map(id => {
    const m = member(id), url = photoOf(id);
    const ph = url ? `<img loading="lazy" src="${esc(url)}" alt="">` : `<span class="fm-initial" style="background:${GCOL_D[m.group]}">${esc(m.name.slice(0, 1))}</span>`;
    return `<button type="button" class="fm-cand${selPool === id ? " sel" : ""}${placingId === id ? " placing" : ""}" data-id="${id}"><span class="mb-photo">${ph}</span><span class="fm-name">${esc(m.name)}</span><span class="fm-sub">${GLABEL[m.group]}</span></button>`;
  }).join("") || `<p style="color:var(--muted)">未配置のメンバーはいません。</p>`;
  pool.querySelectorAll(".fm-cand").forEach(c => c.addEventListener("click", () => onPoolTap(c.dataset.id)));
}
function onSlotTap(gi) {
  if (placingId) {
    snapshot();
    const occ = state.positions[gi];
    const cur = state.positions.indexOf(placingId);
    if (cur >= 0) state.positions[cur] = occ || null;
    state.positions[gi] = placingId;
    placingId = null; selSlot = null; selPool = null;
    save(); renderAll(); return;
  }
  if (selPool) {
    snapshot();
    const occ = state.positions[gi];
    state.positions[gi] = selPool;
    selPool = null; selSlot = null;
    save(); renderAll(); return;
  }
  if (selSlot !== null && selSlot !== gi) {
    snapshot();
    const t = state.positions[selSlot];
    state.positions[selSlot] = state.positions[gi];
    state.positions[gi] = t;
    selSlot = null; save(); renderAll(); return;
  }
  selSlot = selSlot === gi ? null : gi;
  renderBoard();
}
function onPoolTap(id) {
  if (selSlot !== null && !state.positions[selSlot]) {
    snapshot();
    state.positions[selSlot] = id;
    selSlot = null; selPool = null;
    if (placingId === id) placingId = null;
    save(); renderAll(); return;
  }
  selPool = selPool === id ? null : id;
  if (selPool) selSlot = null;
  renderBoard();
}
function renderHistory() {
  document.getElementById("dfHistCount").textContent = `${state.history.length}件`;
  const box = document.getElementById("dfHistory");
  box.innerHTML = state.history.slice(0, 60).map(h => {
    const label = comboText(h);
    return h.result === "pick"
      ? `<p class="df-hist">指名：${esc(member(h.memberId)?.name || "")}（${esc(label)}）</p>`
      : `<p class="df-hist" style="color:var(--muted)">パス：${esc(label)}</p>`;
  }).join("") || `<p style="color:var(--muted)">まだ履歴はありません。</p>`;
}
function renderAll() { renderSettings(); renderSlot(); renderBoard(); renderHistory(); }

/* ---------- 画像出力 ---------- */
let imgBlob = null;
async function buildImage() {
  const rows = state.settings.rows;
  const W = 960, tileW = 150, tileH = 216, gap = 12, top = 120, rowGap = 26;
  const H = top + rows.length * (tileH + rowGap) + 30;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#faf9fb"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#2b2430"; ctx.font = "700 44px sans-serif"; ctx.textAlign = "center";
  ctx.fillText((state.title || "マイ坂道選抜").slice(0, 24), W / 2, 72);
  const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  for (let v = rows.length - 1; v >= 0; v--) {
    const count = rows[v];
    const y = top + (rows.length - 1 - v) * (tileH + rowGap);
    const x0 = (W - (count * tileW + (count - 1) * gap)) / 2;
    for (let c = 0; c < count; c++) {
      const id = state.positions[slotIndex(v, c)];
      const x = x0 + c * (tileW + gap);
      ctx.fillStyle = "#fff"; ctx.strokeStyle = isCenterSlot(v, c, count) ? "#e77a9b" : "#e3dde8";
      ctx.lineWidth = isCenterSlot(v, c, count) ? 4 : 2;
      ctx.beginPath(); ctx.roundRect(x, y, tileW, tileH, 14); ctx.fill(); ctx.stroke();
      if (!id) continue;
      const m = member(id), url = photoOf(id);
      const im = url ? await load(url) : null;
      if (im) {
        ctx.save(); ctx.beginPath(); ctx.roundRect(x + 6, y + 6, tileW - 12, tileW - 12, 10); ctx.clip();
        const s = Math.max((tileW - 12) / im.width, (tileW - 12) / im.height);
        ctx.drawImage(im, x + 6 + (tileW - 12 - im.width * s) / 2, y + 6, im.width * s, im.height * s);
        ctx.restore();
      } else {
        ctx.fillStyle = GCOL_D[m.group]; ctx.font = "700 52px sans-serif";
        ctx.fillText(m.name.slice(0, 1), x + tileW / 2, y + 92);
      }
      ctx.fillStyle = "#2b2430"; ctx.font = "600 21px sans-serif";
      ctx.fillText(m.name, x + tileW / 2, y + tileH - 14);
    }
  }
  return new Promise(res => cv.toBlob(res, "image/png"));
}

/* ---------- 初期化 ---------- */
async function init() {
  await DraftData.load();
  await DraftData.loadScript(BASE + "assets/js/solo-engine.js");
  await DraftData.loadScript(BASE + "assets/js/draft-engine.js");
  R = window.SakamichiSoloEngine;
  MEMBERS = window.SakamichiMembersData || [];
  META = window.SakamichiSoloMeta || {};
  BYID = window.DraftMemberById;
  state = load();
  const withB = Object.values(META).filter(v => v.birthday).length;
  const withH = Object.values(META).filter(v => v.hometown).length;
  document.getElementById("dfDataStatus").textContent = `対象 ${MEMBERS.length}人 ／ 誕生日データ ${withB}人 ・ 出身地データ ${withH}人`;
  const S = () => state.settings;
  document.getElementById("dfMode").addEventListener("input", e => { S().mode = e.target.value; save(); renderSettings(); });
  document.getElementById("dfStatus").addEventListener("input", e => { S().status = e.target.value; save(); renderSettings(); });
  document.getElementById("dfRepeat").addEventListener("input", e => { S().repeat = e.target.value === "yes"; save(); renderSettings(); });
  document.getElementById("dfPassLimit").addEventListener("input", e => { S().passLimit = +e.target.value; save(); renderSlot(); });
  document.getElementById("dfPlacement").addEventListener("input", e => { S().placement = e.target.value; save(); renderSettings(); });
  document.getElementById("dfCenter").addEventListener("input", e => { S().showCenter = e.target.checked; save(); renderBoard(); renderSettings(); });
  document.getElementById("dfCols").addEventListener("input", e => {
    const n = +e.target.value, cur = S().rows;
    if (n === cur.length) return;
    const rows = Array.from({ length: n }, (_, i) => cur[i] ?? 6);
    changeRows(rows);
  });
  document.getElementById("dfTitle").addEventListener("input", e => { state.title = e.target.value; save(); });
  window.addEventListener("resize", () => { fitWheel(document.getElementById("dfWheelGroup")); fitWheel(document.getElementById("dfWheelCond")); });
  document.getElementById("dfSpin").addEventListener("click", spin);
  document.getElementById("dfPass").addEventListener("click", doPass);
  document.getElementById("dfPick").addEventListener("click", doPick);
  document.getElementById("dfUndo").addEventListener("click", () => {
    const prev = undoStack.pop();
    if (!prev) return;
    state = JSON.parse(prev);
    selCand = selSlot = selPool = placingId = null;
    save(); renderAll();
  });
  document.getElementById("dfRemove").addEventListener("click", () => {
    if (selSlot !== null && state.positions[selSlot]) {
      snapshot();
      state.positions[selSlot] = null; selSlot = null;
      save(); renderAll();
    }
  });
  document.getElementById("dfReset").addEventListener("click", () => {
    if (!confirm("指名・配置・履歴をすべて消して、最初から始めますか？")) return;
    const keep = state.settings;
    state = defaultState(); state.settings = keep;
    state.positions = Array(total()).fill(null);
    undoStack = []; selCand = selSlot = selPool = placingId = null;
    save(); renderAll(); msg("リセットしました。スロットを回してください。");
  });
  const dlg = document.getElementById("dfImgDlg");
  document.getElementById("dfImg").addEventListener("click", async () => {
    imgBlob = await buildImage();
    const box = document.getElementById("dfImgPreview");
    box.innerHTML = "";
    if (imgBlob) {
      const im = document.createElement("img");
      im.src = URL.createObjectURL(imgBlob);
      im.style.maxWidth = "100%";
      box.appendChild(im);
    }
    dlg.showModal();
  });
  document.getElementById("dfImgClose").addEventListener("click", () => dlg.close());
  document.getElementById("dfImgDl").addEventListener("click", () => {
    if (!imgBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(imgBlob); a.download = "sakamichia-solo-draft.png"; a.click();
  });
  document.getElementById("dfImgShare").addEventListener("click", async () => {
    if (!imgBlob) return;
    const file = new File([imgBlob], "sakamichia-solo-draft.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch (e) {}
    } else document.getElementById("dfImgDl").click();
  });
  renderAll();
  if (state.pending) msg(`${comboText(state.pending)} が出ています。指名するメンバーを選んでください。`);
  else if (state.acquired.length) msg("前回の続きから再開しました。");
}
init();
