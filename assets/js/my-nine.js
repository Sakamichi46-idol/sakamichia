// 私を構成する9人・9曲：9枠を選んで 1200×1200 の画像にする。選択は端末の localStorage に保存。
const NINE_KEY = "sakamichia-my-nine";
const GROUP_COLOR = { "乃木坂46": "#7e57c2", "櫻坂46": "#e77a9b", "欅坂46": "#5eba53", "日向坂46": "#5aa9d6", "けやき坂46": "#8bc34a", "その他": "#90a4ae" };
let NINE_MEMBERS = [], NINE_SONGS = [], NINE_PHOTOS = {};
let nineMode = "m"; // m=メンバー, s=楽曲
let nineSel = { m: [], s: [] };
let nineQuery = "";
function nineLoadState() {
  try {
    const v = JSON.parse(localStorage.getItem(NINE_KEY) || "{}");
    if (Array.isArray(v.m)) nineSel.m = v.m.filter(x => typeof x === "string");
    if (Array.isArray(v.s)) nineSel.s = v.s.filter(x => typeof x === "string");
  } catch (e) {}
}
function nineSaveState() { try { localStorage.setItem(NINE_KEY, JSON.stringify(nineSel)); } catch (e) {} }
function ninePhotoURL(name) { const f = NINE_PHOTOS[name]; return f ? BASE + "assets/member-photos/" + f : ""; }
function nineMember(name) { return NINE_MEMBERS.find(m => m.name === name); }
function nineSong(id) { return NINE_SONGS.find(s => s.id === id); }
function nineRenderSlots() {
  const wrap = document.getElementById("nineSlots");
  const sel = nineSel[nineMode];
  let html = "";
  for (let i = 0; i < 9; i++) {
    const v = sel[i];
    if (nineMode === "m") {
      const photo = v ? ninePhotoURL(v) : "";
      html += `<button type="button" class="nine-cell ${v ? "filled" : ""}" data-slot="${i}">
        <span class="nine-num">${i + 1}</span>
        ${v ? `${photo ? `<img src="${esc(photo)}" alt="">` : ""}<span class="nine-name">${esc(v)}</span>` : `<span class="nine-empty">タップで追加</span>`}</button>`;
    } else {
      const s = v ? nineSong(v) : null;
      html += `<button type="button" class="nine-cell ${s ? "filled" : ""}" data-slot="${i}">
        <span class="nine-num">${i + 1}</span>
        ${s ? `<span class="nine-songtitle">${esc(s.title)}</span><span class="nine-name" style="font-weight:400;color:var(--muted)">${esc(s.group)}／${esc(s.release || "")}</span>` : `<span class="nine-empty">タップで追加</span>`}</button>`;
    }
  }
  wrap.innerHTML = html;
  wrap.querySelectorAll(".nine-cell").forEach(c => c.addEventListener("click", () => {
    const i = +c.dataset.slot;
    if (nineSel[nineMode][i]) { nineSel[nineMode].splice(i, 1); nineSaveState(); nineRenderAll(); }
  }));
  document.getElementById("nineStatus").textContent = `${sel.length}／9 選択中${sel.length === 9 ? "（完成！「画像を作る」を押してください）" : ""}`;
  document.getElementById("nineTabM").classList.toggle("on", nineMode === "m");
  document.getElementById("nineTabS").classList.toggle("on", nineMode === "s");
}
function nineRenderPick() {
  const q = kanaNorm(nineQuery.trim().toLowerCase());
  const box = document.getElementById("ninePick");
  const sel = nineSel[nineMode];
  if (nineMode === "m") {
    const list = NINE_MEMBERS.filter(m => !q || kanaNorm((m.name + " " + (m.reading || "")).toLowerCase()).includes(q)).slice(0, 60);
    box.innerHTML = list.map(m => {
      const on = sel.includes(m.name);
      const photo = ninePhotoURL(m.name);
      return `<button type="button" class="nine-pick ${on ? "on" : ""}" data-v="${esc(m.name)}">
        ${photo ? `<img src="${esc(photo)}" alt="" loading="lazy">` : ""}
        <span style="flex:1"><b>${esc(m.name)}</b> <span style="color:var(--muted);font-size:12.5px">${esc(m.group)}${m.gen ? " " + esc(m.gen) + "期" : ""}${m.graduated ? "（卒業）" : ""}</span></span>
        <span>${on ? "選択中" : "＋"}</span></button>`;
    }).join("") || `<p style="color:var(--muted)">該当するメンバーがいません。</p>`;
  } else {
    const list = NINE_SONGS.filter(s => s.group !== "その他" && (!q || kanaNorm((s.title + " " + (s.yomi || "")).toLowerCase()).includes(q))).slice(0, 60);
    box.innerHTML = list.map(s => {
      const on = sel.includes(s.id);
      return `<button type="button" class="nine-pick ${on ? "on" : ""}" data-v="${esc(s.id)}">
        <span style="flex:1"><b>${esc(s.title)}</b> <span style="color:var(--muted);font-size:12.5px">${esc(s.group)}／${esc(s.release || "")}／${esc(s.type || "")}</span></span>
        <span>${on ? "選択中" : "＋"}</span></button>`;
    }).join("") || `<p style="color:var(--muted)">該当する楽曲がありません。</p>`;
  }
  box.querySelectorAll(".nine-pick").forEach(b => b.addEventListener("click", () => {
    const v = b.dataset.v;
    const arr = nineSel[nineMode];
    const ix = arr.indexOf(v);
    if (ix >= 0) arr.splice(ix, 1);
    else if (arr.length < 9) arr.push(v);
    else { alert("9つまでです。枠をタップすると外せます。"); return; }
    nineSaveState(); nineRenderAll();
  }));
}
function nineRenderAll() { nineRenderSlots(); nineRenderPick(); }
function nineLoadImage(src) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}
function nineDrawCover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height, r = w / h;
  let sw, sh, sx, sy;
  if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0; }
  else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}
function nineWrap(ctx, text, maxW, maxLines) {
  const lines = [];
  let line = "";
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; if (lines.length >= maxLines) return lines; }
    else line += ch;
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}
async function nineMakeImage() {
  const sel = nineSel[nineMode];
  if (sel.length !== 9) { alert("9つ選んでから画像を作ってください。"); return; }
  const W = 1200, H = 1200, M = 48, GAP = 18;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#faf7fc"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#38304a"; ctx.textAlign = "center";
  ctx.font = "700 52px 'Hiragino Sans','Noto Sans JP',sans-serif";
  ctx.fillText(nineMode === "m" ? "私を構成する9人のメンバー" : "私を構成する9曲", W / 2, 108);
  const gridY = 150, cellW = (W - M * 2 - GAP * 2) / 3, cellH = (H - gridY - 96 - GAP * 2) / 3;
  if (nineMode === "m") {
    const imgs = await Promise.all(sel.map(n => nineLoadImage(ninePhotoURL(n))));
    for (let i = 0; i < 9; i++) {
      const x = M + (i % 3) * (cellW + GAP), y = gridY + Math.floor(i / 3) * (cellH + GAP);
      ctx.fillStyle = "#fff"; ctx.fillRect(x, y, cellW, cellH);
      const img = imgs[i];
      if (img) nineDrawCover(ctx, img, x, y, cellW, cellH - 52);
      else { ctx.fillStyle = "#e8e2f2"; ctx.fillRect(x, y, cellW, cellH - 52); }
      ctx.fillStyle = "#38304a"; ctx.font = "700 30px 'Hiragino Sans','Noto Sans JP',sans-serif";
      ctx.fillText(sel[i], x + cellW / 2, y + cellH - 16);
      ctx.strokeStyle = "#ddd3ee"; ctx.strokeRect(x, y, cellW, cellH);
    }
  } else {
    for (let i = 0; i < 9; i++) {
      const s = nineSong(sel[i]);
      const x = M + (i % 3) * (cellW + GAP), y = gridY + Math.floor(i / 3) * (cellH + GAP);
      ctx.fillStyle = "#fff"; ctx.fillRect(x, y, cellW, cellH);
      ctx.fillStyle = GROUP_COLOR[s.group] || "#90a4ae"; ctx.fillRect(x, y, cellW, 14);
      ctx.fillStyle = "#38304a"; ctx.font = "700 40px 'Hiragino Sans','Noto Sans JP',sans-serif";
      const lines = nineWrap(ctx, s.title, cellW - 28, 3);
      lines.forEach((ln, li) => ctx.fillText(ln, x + cellW / 2, y + 96 + li * 52));
      ctx.fillStyle = "#8a819c"; ctx.font = "400 26px 'Hiragino Sans','Noto Sans JP',sans-serif";
      ctx.fillText(`${s.group}／${s.release || ""}`, x + cellW / 2, y + cellH - 24);
      ctx.strokeStyle = "#ddd3ee"; ctx.strokeRect(x, y, cellW, cellH);
    }
  }
  ctx.fillStyle = "#8a819c"; ctx.font = "400 28px 'Hiragino Sans','Noto Sans JP',sans-serif";
  ctx.fillText("サカミチア sakamichia.pages.dev", W / 2, H - 34);
  const out = document.getElementById("nineOut");
  const url = cv.toDataURL("image/png");
  out.innerHTML = `<img src="${url}" alt="私を構成する9${nineMode === "m" ? "人" : "曲"}の画像"><div class="gacha-btns" style="justify-content:center;margin-top:10px"><a class="btn" href="${url}" download="my-nine.png">画像を保存する</a><button type="button" class="btn sub" id="nineShare">結果を共有する</button></div>`;
  document.getElementById("nineShare").addEventListener("click", e => {
    shareContent({ title: document.title, text: nineMode === "m" ? `私を構成する9人のメンバーは ${sel.join("、")} です。` : `私を構成する9曲は ${sel.map(id => nineSong(id).title).join("、")} です。`, url: location.href }, e.target);
  });
  out.scrollIntoView({ behavior: "smooth", block: "center" });
}
async function init() {
  nineLoadState();
  const [members, songs, photos] = await Promise.all([loadJSON("members.json"), loadJSON("songs.json"), loadJSON("member-photos.json")]);
  NINE_MEMBERS = members || [];
  NINE_SONGS = songs || [];
  NINE_PHOTOS = photos || {};
  nineSel.m = nineSel.m.filter(n => nineMember(n));
  nineSel.s = nineSel.s.filter(id => nineSong(id));
  document.getElementById("nineTabM").addEventListener("click", () => { nineMode = "m"; document.getElementById("nineOut").innerHTML = ""; nineRenderAll(); });
  document.getElementById("nineTabS").addEventListener("click", () => { nineMode = "s"; document.getElementById("nineOut").innerHTML = ""; nineRenderAll(); });
  document.getElementById("nineQuery").addEventListener("input", e => { nineQuery = e.target.value; nineRenderPick(); });
  document.getElementById("nineClear").addEventListener("click", () => { nineSel[nineMode] = []; nineSaveState(); nineRenderAll(); });
  document.getElementById("nineMake").addEventListener("click", nineMakeImage);
  nineRenderAll();
}
init();
