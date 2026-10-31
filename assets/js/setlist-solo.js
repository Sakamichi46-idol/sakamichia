// ソロ・セトリドラフト（1人用）：スロットで決まる「グループ × 条件」に合う曲を指名してセトリを作る。
const KEY = "sakamichia-setlist-solo-v1";
const GORDER = ["乃木坂46", "櫻坂46", "日向坂46", "欅坂46", "けやき坂46", "坂道AKB", "坂道選抜"];
const GCOL = { "乃木坂46": "#7e57c2", "櫻坂46": "#e77a9b", "日向坂46": "#5aa9d6", "欅坂46": "#5eba53", "けやき坂46": "#a4c639", "坂道AKB": "#d24a43", "坂道選抜": "#2f9e8f" };
const TYPE_BUCKETS = [
  ["シングル表題曲", s => s.type === "表題曲"],
  ["カップリング", s => s.type.startsWith("カップリング")],
  ["アンダー曲", s => s.type === "アンダー曲"],
  ["ユニット曲", s => s.type === "ユニット曲"],
  ["ソロ曲", s => s.type === "ソロ曲"],
  ["期別曲", s => s.type === "期別曲"],
  ["BACKS曲", s => s.type === "BACKS曲"]
];
const ERAS = [[2012, 2014], [2015, 2017], [2018, 2020], [2021, 2023], [2024, 2026]]
  .map(([a, b]) => [`${a}〜${b}年`, s => s.year >= a && s.year <= b]);
const CENTERS = [["センター曲", s => !!s.center], ["センターなしの曲", s => !s.center]];
const AXES = { type: TYPE_BUCKETS, era: ERAS, center: CENTERS };
const MODE_LABEL = { type: "種別", era: "年代", center: "センター", random: "おまかせ" };
let SONGS = [], BYID = new Map();
let state = null, selCand = null, spinning = false, undoStack = [], imgBlob = null;

const $ = id => document.getElementById(id);
const song = id => BYID.get(id);
function defaultState() {
  return { settings: { groups: [...GORDER], mode: "type", count: 20, passLimit: 3, repeat: true },
    acquired: [], used: [], pending: null, passCount: 0, history: [],
    order: [], encAt: null, title: "マイセットリスト" };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.settings && Array.isArray(s.order)) return Object.assign(defaultState(), s);
  } catch (e) {}
  return defaultState();
}
function snapshot() { undoStack.push(JSON.stringify(state)); if (undoStack.length > 25) undoStack.shift(); }
function msg(t) { $("ssMsg").textContent = t; }
function axisOf(mode) { return AXES[mode].map(([value, fn]) => ({ value, fn })); }
function combos() {
  const st = state.settings;
  const modes = st.mode === "random" ? Object.keys(AXES) : [st.mode];
  const out = [];
  for (const mode of modes) {
    for (const group of st.groups) {
      for (const { value, fn } of axisOf(mode)) {
        const key = `${group}|${mode}|${value}`;
        if (!st.repeat && state.used.includes(key)) continue;
        const ids = SONGS.filter(s => s.group === group && fn(s) && !state.acquired.includes(s.id)).map(s => s.id);
        if (ids.length) out.push({ group, mode, value, key, ids });
      }
    }
  }
  return out;
}
function pendingCombo() {
  if (!state.pending) return null;
  return combos().find(c => c.key === state.pending.key) || { ...state.pending, ids: [] };
}
const comboText = c => `${c.group} × ${c.value}`;
const encStart = () => state.encAt === null ? state.order.length : Math.min(state.encAt, state.order.length);
function numLabel(i) {
  const st = encStart();
  return i < st ? `M${String(i + 1).padStart(2, "0")}` : `EN${i - st + 1}`;
}

/* ---------- 設定 ---------- */
function renderSettings() {
  const s = state.settings;
  $("ssMode").value = s.mode;
  if (document.activeElement !== $("ssCount")) $("ssCount").value = String(s.count);
  $("ssRepeat").value = s.repeat ? "yes" : "no";
  $("ssPassLimit").value = String(s.passLimit);
  $("ssTitle").value = state.title || "マイセットリスト";
  const gbox = $("ssGroups");
  gbox.innerHTML = GORDER.map(g => `<button type="button" class="ychip${s.groups.includes(g) ? " on" : ""}" data-g="${g}">${g}</button>`).join("");
  gbox.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    const g = b.dataset.g;
    if (s.groups.includes(g)) { if (s.groups.length > 1) s.groups = s.groups.filter(x => x !== g); }
    else s.groups = [...s.groups, g];
    save(); renderSettings(); renderSlot();
  }));
  $("ssConfigSummary").textContent = `${MODE_LABEL[s.mode]}・${s.count}曲・${s.groups.length}グループ`;
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
    const s = song(selCand);
    actionBar.querySelector(".df-actionbar-title").textContent = s ? `「${s.title}」` : "";
    actionBar.classList.add("on");
    document.body.classList.add("dfbar-on");
  } else {
    actionBar.classList.remove("on");
    document.body.classList.remove("dfbar-on");
  }
}
function renderSlot() {
  const s = state.settings;
  const done = state.acquired.length >= s.count;
  $("ssRound").textContent = done ? "完成！" : `指名 ${state.acquired.length}/${s.count}曲`;
  const passLeft = s.passLimit < 0 ? "∞" : Math.max(0, s.passLimit - state.passCount);
  $("ssPass").textContent = `パス（残り${passLeft}）`;
  $("ssPass").disabled = !state.pending || spinning || (s.passLimit >= 0 && state.passCount >= s.passLimit);
  $("ssSpin").disabled = !!state.pending || spinning || done;
  $("ssPick").disabled = !state.pending || !selCand || spinning;
  const wg = $("ssWheelGroup"), wc = $("ssWheelCond");
  if (state.pending) {
    wg.textContent = state.pending.group;
    wc.textContent = state.pending.value;
    wg.parentElement.style.setProperty("--page", GCOL[state.pending.group]);
  } else if (!done) { wg.textContent = "？"; wc.textContent = "？"; }
  fitWheel(wg); fitWheel(wc);
  const box = $("ssCands");
  if (state.pending && !spinning) {
    const bucket = pendingCombo();
    const ids = bucket ? bucket.ids : [];
    box.innerHTML = ids.map(id => {
      const x = song(id);
      return `<button type="button" class="sg-row${selCand === id ? " sel" : ""}" data-id="${id}"><span class="sg-bar" style="background:${GCOL[x.group]}"></span><span class="sg-main"><span class="sg-title">${esc(x.title)}</span><span class="sg-sub">${esc(x.group)} ・ ${esc(x.type)} ・ ${x.year}年${x.center ? " ・ C：" + esc(x.center) : ""} ・ ${esc(x.release || "")}</span></span></button>`;
    }).join("") || `<p style="color:var(--muted)">この条件で指名できる曲はありません。パスしてください。</p>`;
    box.querySelectorAll(".sg-row").forEach(c => c.addEventListener("click", () => { selCand = c.dataset.id; renderSlot(); }));
  } else box.innerHTML = "";
  renderActionBar();
}
function spin() {
  if (state.pending || spinning) return;
  const choices = combos();
  if (!choices.length) { msg("選べる組み合わせがありません。条件や重複設定を変えてください。"); return; }
  const chosen = choices[Math.floor(Math.random() * choices.length)];
  spinning = true; selCand = null; renderSlot();
  const groups = [...new Set(choices.map(x => x.group))];
  const conds = [...new Set(choices.filter(x => x.group === chosen.group && x.mode === chosen.mode).map(x => x.value))];
  const wg = $("ssWheelGroup"), wc = $("ssWheelCond");
  let step = 0;
  const iv = setInterval(() => {
    wg.textContent = groups[Math.floor(Math.random() * groups.length)];
    wc.textContent = conds[Math.floor(Math.random() * conds.length)] || "…";
    fitWheel(wg); fitWheel(wc);
    if (++step > 14) {
      clearInterval(iv);
      state.pending = { group: chosen.group, mode: chosen.mode, value: chosen.value, key: chosen.key };
      spinning = false; save(); renderSlot();
      const bucket = pendingCombo();
      msg(`${comboText(chosen)} が出ました。対象は ${bucket ? bucket.ids.length : 0} 曲です。指名する曲を選んでください。`);
    }
  }, 70);
}
function doPass() {
  if (!state.pending || spinning) return;
  if (state.settings.passLimit >= 0 && state.passCount >= state.settings.passLimit) return;
  snapshot();
  const p = state.pending;
  state.history.unshift({ result: "pass", group: p.group, mode: p.mode, value: p.value });
  if (!state.settings.repeat) state.used.push(p.key);
  state.passCount++; state.pending = null; selCand = null;
  save(); renderAll();
  msg(`${comboText(p)} をパスしました。次のスロットを回せます。`);
}
function doPick() {
  if (!state.pending || !selCand || spinning) return;
  snapshot();
  const p = state.pending, id = selCand;
  state.acquired.push(id);
  state.order.push(id);
  state.history.unshift({ result: "pick", group: p.group, mode: p.mode, value: p.value, songId: id });
  if (!state.settings.repeat) state.used.push(p.key);
  state.pending = null; selCand = null;
  msg(`「${song(id).title}」を指名しました。`);
  if (state.acquired.length >= state.settings.count) msg("セットリストが完成しました！曲順を整えて、画像で保存できます。");
  save(); renderAll();
}

/* ---------- セットリスト ---------- */
function renderList() {
  $("ssCounts").textContent = `指名 ${state.acquired.length}/${state.settings.count}曲`;
  const list = state.order;
  const encSel = $("ssEncore");
  encSel.innerHTML = `<option value="">アンコールなし</option>` +
    Array.from({ length: Math.max(0, list.length - 1) }, (_, i) => i + 1).map(i =>
      `<option value="${i}" ${state.encAt === i ? "selected" : ""}>${i + 1}曲目からアンコール</option>`).join("");
  encSel.value = state.encAt === null ? "" : String(state.encAt);
  let html = "";
  list.forEach((sid, i) => {
    const s = song(sid);
    if (state.encAt !== null && i === encStart() && encStart() < list.length) html += `<div class="sl-encore-band">― アンコール ―</div>`;
    html += `<div class="sl-row"><span class="sl-num">${numLabel(i)}</span><span class="sl-title">${esc(s.title)}<span class="sl-sub"> ／ ${esc(s.group)}${s.center ? " ・ C：" + esc(s.center) : ""}</span></span><button type="button" class="sl-mv" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="上へ">↑</button><button type="button" class="sl-mv" data-i="${i}" data-d="1" ${i === list.length - 1 ? "disabled" : ""} aria-label="下へ">↓</button></div>`;
  });
  $("ssList").innerHTML = html || `<p style="color:var(--muted)">まだ曲がありません。スロットを回して指名してください。</p>`;
  $("ssList").querySelectorAll(".sl-mv").forEach(b => b.addEventListener("click", () => {
    snapshot();
    const i = +b.dataset.i, j = i + (+b.dataset.d);
    [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
    save(); renderList();
  }));
}
function renderHistory() {
  $("ssHistCount").textContent = `${state.history.length}件`;
  $("ssHistory").innerHTML = state.history.slice(0, 60).map(h =>
    h.result === "pick"
      ? `<p class="df-hist">指名：「${esc(song(h.songId)?.title || "")}」（${esc(h.group)} × ${esc(h.value)}）</p>`
      : `<p class="df-hist" style="color:var(--muted)">パス：${esc(h.group)} × ${esc(h.value)}</p>`
  ).join("") || `<p style="color:var(--muted)">まだ履歴はありません。</p>`;
}
function renderAll() { renderSettings(); renderSlot(); renderList(); renderHistory(); }

/* ---------- 画像出力 ---------- */
async function buildImage() {
  const W = 960, list = state.order;
  const H = 150 + list.length * 32 + (state.encAt !== null && encStart() < list.length ? 30 : 0) + 30;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#faf9fb"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#2b2430"; ctx.font = "700 40px sans-serif"; ctx.textAlign = "center";
  ctx.fillText((state.title || "マイセットリスト").slice(0, 30), W / 2, 62);
  ctx.font = "500 19px sans-serif"; ctx.fillStyle = "#8a7f96";
  ctx.fillText("ソロ・セトリドラフト（サカミチア）", W / 2, 96);
  ctx.textAlign = "left";
  let y = 140;
  list.forEach((sid, i) => {
    const s = song(sid);
    if (state.encAt !== null && i === encStart() && encStart() < list.length) {
      ctx.fillStyle = "#8a7f96"; ctx.font = "700 17px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("― アンコール ―", W / 2, y + 6);
      ctx.textAlign = "left"; y += 30;
    }
    ctx.fillStyle = GCOL[s.group] || "#999";
    ctx.fillRect(56, y - 14, 7, 22);
    ctx.fillStyle = "#2b2430"; ctx.font = "800 19px sans-serif";
    ctx.fillText(numLabel(i), 76, y + 4);
    ctx.font = "600 20px sans-serif";
    ctx.fillText(s.title.slice(0, 30), 150, y + 4);
    ctx.fillStyle = "#8a7f96"; ctx.font = "15px sans-serif";
    ctx.fillText(s.group, 700, y + 4);
    y += 32;
  });
  return new Promise(res => cv.toBlob(res, "image/png"));
}

/* ---------- 初期化 ---------- */
async function init() {
  SONGS = await loadJSON("songs.json");
  BYID = new Map(SONGS.map(s => [s.id, s]));
  state = load();
  $("ssDataStatus").textContent = `対象 ${SONGS.length}曲`;
  $("ssMode").addEventListener("input", e => { state.settings.mode = e.target.value; save(); renderSettings(); });
  $("ssCount").addEventListener("input", e => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v) && v >= 1 && v <= 100) { state.settings.count = v; save(); renderSettings(); renderSlot(); renderList(); } });
  $("ssRepeat").addEventListener("input", e => { state.settings.repeat = e.target.value === "yes"; save(); renderSettings(); });
  $("ssPassLimit").addEventListener("input", e => { state.settings.passLimit = +e.target.value; save(); renderSlot(); });
  $("ssTitle").addEventListener("input", e => { state.title = e.target.value; save(); });
  $("ssEncore").addEventListener("input", e => { state.encAt = e.target.value === "" ? null : +e.target.value; save(); renderList(); });
  window.addEventListener("resize", () => { fitWheel($("ssWheelGroup")); fitWheel($("ssWheelCond")); });
  $("ssSpin").addEventListener("click", spin);
  $("ssPass").addEventListener("click", doPass);
  $("ssPick").addEventListener("click", doPick);
  $("ssUndo").addEventListener("click", () => {
    const prev = undoStack.pop();
    if (!prev) return;
    state = JSON.parse(prev);
    selCand = null;
    save(); renderAll();
  });
  $("ssReset").addEventListener("click", () => {
    if (!confirm("指名・並び・履歴をすべて消して、最初から始めますか？")) return;
    const keep = state.settings;
    state = defaultState(); state.settings = keep;
    undoStack = []; selCand = null;
    save(); renderAll(); msg("リセットしました。スロットを回してください。");
  });
  const dlg = $("ssImgDlg");
  $("ssImg").addEventListener("click", async () => {
    imgBlob = await buildImage();
    const box = $("ssImgPreview");
    box.innerHTML = "";
    if (imgBlob) {
      const im = document.createElement("img");
      im.src = URL.createObjectURL(imgBlob);
      im.style.maxWidth = "100%";
      box.appendChild(im);
    }
    dlg.showModal();
  });
  $("ssImgClose").addEventListener("click", () => dlg.close());
  $("ssImgDl").addEventListener("click", () => {
    if (!imgBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(imgBlob); a.download = "sakamichia-setlist-solo.png"; a.click();
  });
  $("ssImgShare").addEventListener("click", async () => {
    if (!imgBlob) return;
    const file = new File([imgBlob], "sakamichia-setlist-solo.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch (e) {}
    } else $("ssImgDl").click();
  });
  renderAll();
  if (state.pending) msg(`${comboText(state.pending)} が出ています。指名する曲を選んでください。`);
  else if (state.acquired.length) msg("前回の続きから再開しました。");
}
init();
