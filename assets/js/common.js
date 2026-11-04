// サカミチア 共通処理：データ読み込み・カード描画・絞り込み
const BASE = document.body.dataset.base || "./";
// ダークモード：保存済みの選択を即時適用（切替はドロワー内のボタン）
const THEME_KEY = "sakamichia-theme";
function applyTheme(t) {
  if (t === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
}
try { if (localStorage.getItem(THEME_KEY) === "dark") document.documentElement.dataset.theme = "dark"; } catch (e) {}
// 軽量モード：写真を小さく・アニメーションと先読みを止める（切替はドロワー内、切替時に再読み込み）
const LITE_KEY = "sakamichia-lite";
function applyLite(on) {
  if (on) document.documentElement.dataset.lite = "1";
  else delete document.documentElement.dataset.lite;
  try { localStorage.setItem(LITE_KEY, on ? "1" : "0"); } catch (e) {}
}
try { if (localStorage.getItem(LITE_KEY) === "1") document.documentElement.dataset.lite = "1"; } catch (e) {}
// 軽量版では、data-lite-text 属性のある要素を「簡潔で短い専用の文章」に差し替える。
// 文章量を減らす分、その短い文だけで内容が分かるようにするための仕組み。
// ※属性名は data-lite-text にすること（data-lite は <html> の dataset.lite と衝突する）
function applyLiteCopy() {
  if (document.documentElement.dataset.lite !== "1") return;
  document.querySelectorAll("[data-lite-text]").forEach(el => { el.textContent = el.getAttribute("data-lite-text"); });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyLiteCopy);
else applyLiteCopy();
let loadFailShown = false;
function showLoadFail(){
  if(loadFailShown) return; loadFailShown = true;
  const el = document.createElement("div");
  el.className = "load-fail";
  el.textContent = "データを読み込めませんでした。通信環境を確認して、ページを再読み込みしてください。";
  document.body.appendChild(el);
}
async function loadJSON(name){
  try{
    const r = await fetch(BASE + "data/" + name);
    if(!r.ok){ showLoadFail(); return []; }
    return await r.json();
  }catch(e){ showLoadFail(); return []; }
}
// お知らせの年別シャード（data/news/index.json + y<year>.json）を新しい年から順に読み、
// 各年が揃うたびに onBatch(蓄積済みの全件) を呼ぶ。全期間版 news.json（6MB超）を
// 丸ごと読まずに段階的に表示・検索できるようにするための共通ローダー。
// シャードが無い場合は null を返す（呼び出し側で news.json にフォールバックする）。
async function loadNewsShards(onBatch){
  const idx = await loadJSON("news/index.json");
  if(!idx || !Array.isArray(idx.years) || !idx.years.length) return null;
  let all = [];
  for(const y of idx.years){
    const d = await loadJSON("news/y" + y + ".json");
    if(d && d.items && d.items.length){
      all = all.concat(d.items);
      if(onBatch) onBatch(all);
    }
  }
  return all;
}
function esc(s){return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function groupChip(g){return g ? `<span class="chip g-${esc(g)}">${esc(g)}</span>` : "";}
function tags(list){return (list||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("");}
// カタカナをひらがなに寄せる（「アイシー」⇔「あいしー」のような表記ゆれを吸収する）。
// NFKCで半角カナ・全角英数も寄せる（ｱｲｼｰ／Ｉ などでも当たるように）
function kanaNorm(s){ return String(s ?? "").normalize("NFKC").replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)); }
// リリースコードはデータ上の分類用に接頭辞が付く（K=欅坂46、S=櫻坂46、HK=けやき坂46）。
// ユーザーに見せる表示では接頭辞を外す（ユーザー要望 2026-11-03）。データ自体は変えない。
function relLabel(code){ return String(code || "").replace(/^(?:HK|K|S)(?=\d|Digital|BestAL|Unreleased)/, ""); }
function includesAll(hay, q){
  if(!q) return true;
  return kanaNorm(hay.toLowerCase()).includes(kanaNorm(q.toLowerCase()));
}
function itemText(parts){return parts.flat(Infinity).filter(Boolean).join(" ");}

// おみくじ（共通ロジック）：トップページとおみくじページで同じ結果になるよう共通化。
// 1日1回・結果は日付シードで決まり、localStorage に保存して両ページで共有する。
const OMIKUJI_RANKS = ["大吉", "中吉", "小吉", "吉", "末吉", "凶", "大凶"];
// 出現ウェイト（合計100）：凶はたまに、大凶は滅多に出ない
const OMIKUJI_WEIGHTS = [16, 24, 24, 20, 10, 5, 1];
const OMIKUJI_MSGS = {
  "大吉": ["推しのブログ更新が早そう。通知の見逃しに注意。", "ライブ運も絶好調。チケット運が上がっています。", "推しの笑顔にたくさん出会える一日。"],
  "中吉": ["推しの懐かしい写真との出会いがありそう。写真ガチャがおすすめ。", "楽曲図鑑で新しい発見がありそう。", "推しの誕生日カウントダウンをチェックしてみて。"],
  "小吉": ["まったり推し活日和。ブログアーカイブの旅が吉。", "好きな曲を聴き返すと運気アップ。", "推しのセンター曲を聴くと良いことがありそう。"],
  "吉": ["焦らずマイペースに。推しは逃げません。", "年表を眺めると懐かしい記憶がよみがえりそう。", "今日は情報を集める日。お知らせチェックが吉。"],
  "末吉": ["運気はこれから上昇。モザイククイズで腕試しを。", "見逃しは明日取り戻せます。無理せず休息も大事。", "小さな幸運は夕方から。ブログの新着を待ってみて。"],
  "凶": ["今日は静かに推す日。無理せず、好きな曲を聴いて過ごして。", "見逃しがあっても大丈夫。アーカイブが待っています。", "運気は底打ち間近。明日に期待しましょう。"],
  "大凶": ["今日はお休みモードで。推し活は明日から本気出す。", "何をやっても裏目な日かも。懐かしいブログ記事でのんびりと。", "レアな大凶を引きました。逆に記念日です。"]
};
const OMIKUJI_KEY = "sakamichia-omikuji";
function omikujiTodayStr() { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; }
function omikujiLoad() {
  try { const v = JSON.parse(localStorage.getItem(OMIKUJI_KEY) || "null"); return (v && v.date === omikujiTodayStr() && v.name) ? v : null; } catch (e) { return null; }
}
function omikujiDraw(members) {
  let favs = [];
  try { const v = JSON.parse(localStorage.getItem("sakamichia-favs") || "[]"); if (Array.isArray(v)) favs = v.filter(x => typeof x === "string"); } catch (e) {}
  let pool = (members || []).filter(m => favs.includes(m.name));
  if (!pool.length) pool = (members || []).filter(m => !m.graduated);
  if (!pool.length) return null;
  // 端末ごとにランダムに引く（引いた結果はその日その端末に保存され、引き直しはできない）
  const m = pool[Math.floor(Math.random() * pool.length)];
  let rank = "吉";
  { let x = Math.random() * 100, acc = 0; for (let i = 0; i < OMIKUJI_RANKS.length; i++) { acc += OMIKUJI_WEIGHTS[i]; if (x < acc) { rank = OMIKUJI_RANKS[i]; break; } } }
  const msgs = OMIKUJI_MSGS[rank] || OMIKUJI_MSGS["吉"];
  return { date: omikujiTodayStr(), name: m.name, group: m.group, rank, msg: msgs[Math.floor(Math.random() * msgs.length)] };
}
function omikujiSave(res) { try { localStorage.setItem(OMIKUJI_KEY, JSON.stringify(res)); } catch (e) {} }

// クイズの自己ベスト（端末に保存）。quizBestSave は新記録のとき true を返す
function quizBest(key) { try { return +localStorage.getItem("sakamichia-best-" + key) || 0; } catch (e) { return 0; } }
function quizBestSave(key, score) { try { if (score > quizBest(key)) { localStorage.setItem("sakamichia-best-" + key, String(score)); return true; } } catch (e) {} return false; }

// 出題の重複回避（端末ごとの記録）：出題済みのIDを古い順に localStorage へ持ち、
// 未出題のものを優先して引く。未出題が足りない場合は、最も昔に出たものから補う
// （直近に出たものは最後まで避ける）。サーバーは使わず端末内だけで完結する。
function quizSeenGet(key) { try { const v = JSON.parse(localStorage.getItem("sakamichia-seen-" + key) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function quizSeenSave(key, arr) { try { localStorage.setItem("sakamichia-seen-" + key, JSON.stringify(arr.slice(-3000))); } catch (e) {} }
function quizSeenTouch(key, ids) {
  if (!ids || !ids.length) return;
  const uniq = [...new Set(ids)];
  quizSeenSave(key, quizSeenGet(key).filter(id => !uniq.includes(id)).concat(uniq));
}
// pool から n 件を重複回避つきで引く。idFn(item) が各 item の一意なIDを返す。
// 戻り値はランダム順で、引いた item は出題済みとして記録される。
function quizPick(key, pool, n, idFn) {
  const seen = quizSeenGet(key), seenSet = new Set(seen);
  const fresh = pool.filter(it => !seenSet.has(idFn(it)));
  const shuf = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let picks;
  if (fresh.length >= n) {
    picks = shuf(fresh).slice(0, n);
  } else {
    picks = [...fresh];
    const byId = new Map(pool.map(it => [idFn(it), it]));
    for (const id of seen) { // 記録は古い順：最も昔に出たものから補う
      if (picks.length >= n) break;
      const it = byId.get(id);
      if (it && !picks.includes(it)) picks.push(it);
    }
    if (picks.length < n) picks = picks.concat(shuf(pool.filter(it => !picks.includes(it))).slice(0, n - picks.length));
    picks = shuf(picks);
  }
  quizSeenTouch(key, picks.map(idFn));
  return picks;
}

// ゲーム結果の画像共有（共通）：結果カード画像（1200x630）を作って共有/保存する
async function shareScoreImage(opts, btn) {
  const cv = document.createElement("canvas"); cv.width = 1200; cv.height = 630;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#faf9fb"; ctx.fillRect(0, 0, 1200, 630);
  // ロゴの三色（縦分割・単色のみ、グラデーションなし）
  ["#7e57c2", "#e77a9b", "#5aa9d6"].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(64 + i * 26, 56, 26, 74); });
  ctx.fillStyle = "#2b2430"; ctx.textBaseline = "alphabetic";
  ctx.font = "900 44px 'Hiragino Maru Gothic ProN','Hiragino Sans',sans-serif";
  ctx.fillText("サカミチア", 172, 112);
  ctx.font = "700 40px 'Hiragino Maru Gothic ProN','Hiragino Sans',sans-serif";
  ctx.fillText(opts.game || "", 64, 208);
  ctx.font = "900 92px 'Hiragino Maru Gothic ProN','Hiragino Sans',sans-serif";
  ctx.fillStyle = "#7e57c2";
  ctx.fillText(opts.score || "", 64, 322);
  ctx.fillStyle = "#2b2430"; ctx.font = "400 30px 'Hiragino Sans',sans-serif";
  (opts.lines || []).slice(0, 6).forEach((ln, i) => ctx.fillText(String(ln), 64, 392 + i * 40));
  ctx.fillStyle = "#7a7080"; ctx.font = "400 26px 'Hiragino Sans',sans-serif";
  ctx.fillText("sakamichia.pages.dev", 64, 586);
  const blob = await new Promise(r => cv.toBlob(r, "image/png"));
  const fileName = "sakamichia-result.png";
  if (blob && navigator.canShare) {
    const file = new File([blob], fileName, { type: "image/png" });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "サカミチア", text: withShareTag("") }); return; } catch (e) { /* キャンセル時は何もしない */ return; }
    }
  }
  if (blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = fileName; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    if (btn) { const t = btn.textContent; btn.textContent = "画像を保存しました"; setTimeout(() => { btn.textContent = t; }, 1800); }
    return;
  }
  shareContent({ text: `${opts.game}：${opts.score}` }, btn);
}

// 検索サジェスト共通部品：入力の下に候補ドロップダウンを出す（Google式）。
// attachSuggest(input, provider, onPick)
//   provider(q) -> [{label, sub, kind, cls}]（最大8件まで表示）
//   onPick(item, input) -> 候補を選んだときの処理
// 日本語入力の変換中（composition中）は候補を更新せず、変換確定後にだけ出す。
function attachSuggest(input, provider, onPick){
  if(!input || input.dataset.sgAttached) return;
  input.dataset.sgAttached="1";
  input.setAttribute("autocomplete","off");
  const wrap=document.createElement("span"); wrap.className="sg-wrap";
  input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
  const box=document.createElement("div"); box.className="suggest sg-box"; box.hidden=true; wrap.appendChild(box);
  let items=[], active=-1, composing=false;
  function close(){ box.hidden=true; items=[]; active=-1; }
  function render(){
    if(composing) return;
    const q=input.value.trim();
    if(!q){ close(); return; }
    items=(provider(q)||[]).slice(0,8);
    if(!items.length){ close(); return; }
    box.innerHTML=items.map((it,i)=>`<button type="button" class="sg-row sg-item${i===active?" on":""}" data-i="${i}">${it.kind?`<span class="sg-kind sg-${esc(it.cls||"member")}">${esc(it.kind)}</span>`:""}<span class="sg-label">${esc(it.label)}</span>${it.sub?`<span class="sg-sub">${esc(it.sub)}</span>`:""}</button>`).join("");
    box.hidden=false;
    box.querySelectorAll(".sg-item").forEach(b=>b.addEventListener("mousedown",e=>{ e.preventDefault(); pick(+b.dataset.i); }));
  }
  function pick(i){ const it=items[i]; if(!it) return; close(); onPick(it, input); }
  input.addEventListener("input", render);
  input.addEventListener("focus", render);
  input.addEventListener("compositionstart", ()=>{ composing=true; });
  input.addEventListener("compositionend", ()=>{ composing=false; render(); });
  input.addEventListener("keydown", e=>{
    if(box.hidden || !items.length) return;
    if(e.key==="ArrowDown"){ e.preventDefault(); active=Math.min(active+1, items.length-1); render(); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); active=Math.max(active-1, 0); render(); }
    else if(e.key==="Enter"){ if(active>=0){ e.preventDefault(); pick(active); } }
    else if(e.key==="Escape"){ close(); }
  });
  input.addEventListener("blur", ()=>setTimeout(close, 120));
}

// 共有文には必ずハッシュタグ「#サカミチア」を末尾に付ける（既に含まれていれば二重に付けない）
function withShareTag(text){
  const t=(text||"").trim();
  if(!t) return "#サカミチア";
  return t.includes("#サカミチア") ? t : t+" #サカミチア";
}

// 共有：対応環境では共有シートを開き、なければクリップボードへコピーする
async function shareContent(data, btn){
  const payload={title:data.title||document.title, text:withShareTag(data.text||""), url:data.url||location.href};
  if(navigator.share){
    try{ await navigator.share(payload); }catch(e){ /* キャンセル時は何もしない */ }
    return;
  }
  try{
    await navigator.clipboard.writeText((payload.text?payload.text+" ":"")+payload.url);
    if(btn){ const t=btn.textContent; btn.textContent="コピーしました"; setTimeout(()=>{btn.textContent=t;},1800); }
  }catch(e){ if(btn){ const t=btn.textContent; btn.textContent="コピーできませんでした"; setTimeout(()=>{btn.textContent=t;},1800); } }
}

// 複数選択プルダウン（フィルター用共通部品）：ボタン風トリガーを押すとチェックボックス一覧が開く。
// 閉じた状態では「すべて（allLabel）」「（1件だけならその名前）」「◯件選択中」の要約を出す。
// 選択は selected（Set、値は文字列）で保持し、空＝すべて扱い。項目同士は OR 条件で使う想定。
// チェック操作と「選択をクリア」は onChange を発火するが、setOptions / clear / setValues は
// 発火しない（選択の復元やリセットはページ側の描画フローに委ねるため）。
let MSEL_OPEN = null;
function createMultiSelect(mount, cfg){
  if(!mount) return null;
  cfg = cfg || {};
  const allLabel = cfg.allLabel || "すべて";
  const selected = cfg.selected || new Set();
  let options = [];
  mount.classList.add("msel");
  mount.innerHTML =
    `<button type="button" class="msel-btn" aria-haspopup="true" aria-expanded="false"><span class="msel-sum"></span><span class="msel-caret">▼</span></button>`
    + `<div class="msel-pop" hidden><div class="msel-pop-head"><span class="msel-state"></span><button type="button" class="msel-clear">選択をクリア</button></div><div class="msel-list"></div></div>`;
  const btn = mount.querySelector(".msel-btn"), pop = mount.querySelector(".msel-pop"),
        list = mount.querySelector(".msel-list"), sum = mount.querySelector(".msel-sum"),
        state = mount.querySelector(".msel-state");
  if(cfg.ariaLabel) btn.setAttribute("aria-label", cfg.ariaLabel);
  function refresh(){
    if(!selected.size) sum.textContent = allLabel;
    else if(selected.size === 1){
      const v = [...selected][0], o = options.find(x => String(x.value) === v);
      sum.textContent = o ? o.label : v;
    } else sum.textContent = `${selected.size}件選択中`;
    btn.classList.toggle("has", selected.size > 0);
    state.textContent = selected.size ? `${selected.size}件選択中` : "すべて（未選択）";
    list.querySelectorAll(".msel-opt").forEach(lab => {
      const on = selected.has(lab.dataset.v);
      lab.classList.toggle("on", on);
      const cb = lab.querySelector("input"); if(cb) cb.checked = on;
    });
  }
  function buildList(){
    list.innerHTML = options.map(o =>
      `<label class="msel-opt" data-v="${esc(String(o.value))}"><input type="checkbox" value="${esc(String(o.value))}"><span>${esc(o.label)}</span></label>`).join("");
    list.querySelectorAll("input").forEach(cb => cb.addEventListener("change", () => {
      if(cb.checked) selected.add(cb.value); else selected.delete(cb.value);
      refresh();
      if(cfg.onChange) cfg.onChange();
    }));
    refresh();
  }
  function close(){
    if(pop.hidden) return;
    pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if(MSEL_OPEN === api) MSEL_OPEN = null;
  }
  function open(){
    if(MSEL_OPEN && MSEL_OPEN !== api) MSEL_OPEN.close();
    pop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    MSEL_OPEN = api;
    // 画面右端ではみ出す場合はポップオーバーを右寄せに切り替える
    pop.classList.remove("right");
    const r = pop.getBoundingClientRect();
    if(r.right > window.innerWidth - 8) pop.classList.add("right");
  }
  btn.addEventListener("click", e => { e.stopPropagation(); if(pop.hidden) open(); else close(); });
  pop.addEventListener("click", e => e.stopPropagation());
  mount.querySelector(".msel-clear").addEventListener("click", () => {
    if(!selected.size) return;
    selected.clear(); refresh();
    if(cfg.onChange) cfg.onChange();
  });
  document.addEventListener("click", close);
  document.addEventListener("keydown", e => { if(e.key === "Escape") close(); });
  const api = { el: mount, selected, refresh, close,
    setOptions(opts){
      options = opts || [];
      const ok = new Set(options.map(o => String(o.value)));
      [...selected].forEach(v => { if(!ok.has(v)) selected.delete(v); });
      buildList();
    },
    clear(){ selected.clear(); refresh(); },
    setValues(vals){ selected.clear(); (vals || []).forEach(v => selected.add(String(v))); refresh(); }
  };
  api.setOptions(cfg.options || []);
  return api;
}

// グループ絞り込みに連動して、ページの差し色をそのグループの色に切り替える
document.addEventListener("DOMContentLoaded",()=>{
  const sel=document.getElementById("group");
  if(!sel) return;
  const apply=()=>{document.body.dataset.group=sel.value||"";};
  sel.addEventListener("input",apply);
  sel.addEventListener("change",apply);
  apply();
});

// PWA：マニフェストを差し込み、サービスワーカーを登録する（全ページ共通）
(function(){
  if(!document.querySelector('link[rel="manifest"]')){
    const l=document.createElement("link");
    l.rel="manifest";l.href=BASE+"manifest.webmanifest";
    document.head.appendChild(l);
  }
  if("serviceWorker" in navigator){
    // 更新版のSWが有効になったら知らせる。JS/CSSは stale-while-revalidate のため、
    // 開いているページは旧版のまま動き続ける（「直したのに見えない」の一因）。
    // 初回登録時は controller が無いので通知しない。
    const hadController = !!navigator.serviceWorker.controller;
    let updateShown = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || updateShown) return;
      updateShown = true;
      const bar = document.createElement("div");
      bar.className = "update-toast";
      bar.innerHTML = `<span>サイトが更新されました</span><button type="button">再読み込み</button>`;
      bar.querySelector("button").addEventListener("click", () => location.reload());
      document.body.appendChild(bar);
    });
    window.addEventListener("load",()=>{
      navigator.serviceWorker.register(BASE+"sw.js").catch(()=>{});
    });
  }
})();

// スマホ用ボトムナビ（画面下の固定タブバー。表示はCSS側でモバイル幅のみ）
document.addEventListener("DOMContentLoaded",()=>{
  if(document.querySelector(".bottomnav")) return;
  const seg=(location.pathname.split("/").filter(Boolean)[0]||"");
  const activeKey = seg==="" ? "home"
    : seg==="blog" ? "blog"
    : seg==="members" ? "members"
    : seg==="live" ? "live"
    : (seg==="games"||seg==="formation"||seg==="setlist") ? "games"
    : "";
  const ICONS={
    home:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M9.5 19.5v-5h5v5"/></svg>',
    blog:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 1 6.5 18H19v3H6.5"/><path d="M9 7.5h6.5M9 11h6.5"/></svg>',
    members:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.4 3.6-5 7-5s6.2 1.6 7 5"/></svg>',
    live:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v2a2.5 2.5 0 0 0 0 5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-2a2.5 2.5 0 0 0 0-5z"/><path d="M13.5 7v2M13.5 11v2M13.5 15v2" stroke-dasharray="0.5 2.6"/></svg>',
    games:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="0.6" fill="currentColor"/><circle cx="15" cy="9" r="0.6" fill="currentColor"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/><circle cx="9" cy="15" r="0.6" fill="currentColor"/><circle cx="15" cy="15" r="0.6" fill="currentColor"/></svg>'
  };
  const ITEMS=[
    {key:"home", label:"ホーム", href:BASE},
    {key:"blog", label:"ブログ", href:BASE+"blog/"},
    {key:"members", label:"メンバー", href:BASE+"members/"},
    {key:"live", label:"ライブ", href:BASE+"live/"},
    {key:"games", label:"遊ぶ・作る", href:BASE+"games/"}
  ];
  const nav=document.createElement("nav");
  nav.className="bottomnav";nav.setAttribute("aria-label","メインナビゲーション");
  nav.innerHTML=ITEMS.map(it=>
    `<a href="${it.href}"${it.key===activeKey?' class="on" aria-current="page"':""}>${ICONS[it.key]}<span>${it.label}</span></a>`
  ).join("");
  document.body.appendChild(nav);
  document.body.classList.add("has-bnav");
  // トップへ戻るボタン（長くスクロールしたときだけ出す）
  const toTop = document.createElement("button");
  toTop.type = "button"; toTop.className = "toTop"; toTop.textContent = "↑"; toTop.setAttribute("aria-label", "トップへ戻る");
  toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: document.documentElement.dataset.lite === "1" ? "auto" : "smooth" }));
  document.body.appendChild(toTop);
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => { toTop.classList.toggle("show", window.scrollY > 700); ticking = false; });
  }, { passive: true });
});

// 推しフローティングボタン：推し登録（localStorage "sakamichia-favs"）があるときだけ、
// スマホ右下に推しの丸い写真を出す（日向坂公式のポカアイコン寄り：大きめ・枠なし・影なし）。
// ページ表示の約1秒後に下からぴょこっと弾んで現れ、写真タップでメニュー
// （最新ブログ／ブログ一覧／写真一覧／参加曲／メンバー詳細／次の推しへ／非表示にする）を開く。非表示は誤タップ
// 防止のためメニュー内からのみ行い、セッション内は再表示しない。45秒ローテーションは
// 従来どおり。表示範囲（768px以下だけ）・登場アニメ・ボトムナビとの重なり・
// ドラフト指名バー表示中の退避は style.css 側で制御する。
document.addEventListener("DOMContentLoaded",()=>{
  if (document.documentElement.dataset.lite === "1") return;  // 軽量モードでは推しフローティングを出さない
  let favs=[];
  try{
    const v=JSON.parse(localStorage.getItem("sakamichia-favs")||"[]");
    if(Array.isArray(v)) favs=v.filter(x=>typeof x==="string"&&x);
  }catch(e){}
  if(!favs.length) return;  // 推し未登録の訪問者にはデータを読ませない
  const DISMISS_KEY="sakamichia-favfloat-dismissed";
  try{ if(sessionStorage.getItem(DISMISS_KEY)) return; }catch(e){}
  Promise.all([loadJSON("member-photos.json"),loadJSON("member-latest.json")]).then(([photos,latest])=>{
    // 推し写真：歴代アー写から選んだ1枚（localStorage "sakamichia-fav-photos"：{名前: ギャラリーのファイル名}）。
    // 設定があるメンバーは、プロフィール写真ではなくギャラリーのその写真を出す（members.js の galURL と同じ組み立て）。
    let favPhotos={};
    try{
      const v=JSON.parse(localStorage.getItem("sakamichia-fav-photos")||"{}");
      if(v&&typeof v==="object"&&!Array.isArray(v))
        for(const k of Object.keys(v)) if(typeof v[k]==="string"&&v[k]) favPhotos[k]=v[k];
    }catch(e){}
    const photosMap=(photos&&!Array.isArray(photos))?photos:{};
    const profileOf=name=>{
      const f=photosMap[name];
      return f?BASE+"assets/member-photos/"+f:"";
    };
    const latestOf=name=>{
      const arr=(latest&&!Array.isArray(latest))?latest[name]:null;
      return (Array.isArray(arr)&&arr.length)?arr[0]:null;
    };
    // 写真のある推しを登録順に候補化する（推し写真が設定されていればギャラリー写真を優先）
    const cands=[];
    for(const name of favs){
      const prof=profileOf(name);
      if(!prof) continue;
      const setF=favPhotos[name];
      const galSrc=setF?BASE+"assets/member-gallery/"+photosMap[name].replace(/\.jpg$/,"")+"/"+setF:"";
      cands.push({name, prof, galSrc, article:latestOf(name)});
    }
    if(!cands.length) return;  // 写真のある推しがいない場合は出さない
    const srcOf=c=>c.galSrc||c.prof;
    const hrefOf=c=>c.article
      ? BASE+"blog/?open="+encodeURIComponent(c.article.id)
      : BASE+"blog/?member="+encodeURIComponent(c.name);
    const memberHrefOf=c=>BASE+"members/?member="+encodeURIComponent(c.name);
    const blogListHrefOf=c=>BASE+"blog/?member="+encodeURIComponent(c.name);
    // 写真一覧はブログの写真ウォール（blog.js の ?view=photos 深リンク）をそのメンバーで絞って開く
    const photosHrefOf=c=>blogListHrefOf(c)+"&view=photos";
    // 参加曲は楽曲図鑑の ?member= 深リンク（songs.js が formations の参加メンバーで絞る）
    const songsHrefOf=c=>BASE+"songs/?member="+encodeURIComponent(c.name);
    // 初期表示は現行ルール：最新記事が最も新しい推し（同点・記事なしは登録順を優先）
    let cur=cands[0];
    for(const c of cands){
      if(c.article&&(!cur.article||String(c.article.date)>String(cur.article.date))) cur=c;
    }
    const wrap=document.createElement("div");
    wrap.className="favfloat";
    wrap.innerHTML=
      `<div class="favfloat-menu">`
      +`<a class="favfloat-item" data-act="blog" href="">最新ブログ</a>`
      +`<a class="favfloat-item" data-act="blogs" href="">ブログ一覧</a>`
      +`<a class="favfloat-item" data-act="photos" href="">写真一覧</a>`
      +`<a class="favfloat-item" data-act="songs" href="">参加曲</a>`
      +`<a class="favfloat-item" data-act="member" href="">メンバー詳細</a>`
      +(cands.length>=2?`<button type="button" class="favfloat-item" data-act="next">次の推しへ</button>`:"")
      +`<button type="button" class="favfloat-item" data-act="hide">非表示にする</button>`
      +`</div>`
      +`<button type="button" class="favfloat-main" aria-label="" aria-haspopup="true" aria-expanded="false"><img src="" alt=""></button>`;
    const mainBtn=wrap.querySelector(".favfloat-main");
    const img=wrap.querySelector("img");
    const blogItem=wrap.querySelector('[data-act="blog"]');
    const blogsItem=wrap.querySelector('[data-act="blogs"]');
    const photosItem=wrap.querySelector('[data-act="photos"]');
    const songsItem=wrap.querySelector('[data-act="songs"]');
    const memberItem=wrap.querySelector('[data-act="member"]');
    const nextItem=wrap.querySelector('[data-act="next"]');
    const show=c=>{
      cur=c;
      blogItem.href=hrefOf(c);
      blogsItem.href=blogListHrefOf(c);
      photosItem.href=photosHrefOf(c);
      songsItem.href=songsHrefOf(c);
      memberItem.href=memberHrefOf(c);
      mainBtn.setAttribute("aria-label",c.name+"のメニューを開く");
      // 推し写真のファイルが見つからない場合はプロフィール写真にフォールバックする
      img.onerror=()=>{ if(c.galSrc){ c.galSrc=""; img.src=c.prof; } };
      img.src=srcOf(c);
    };
    show(cur);
    // 交代に備えて全候補の写真を先読みしておく
    for(const c of cands){ const pre=new Image(); pre.src=srcOf(c); }
    // ローテーション：推しが2人以上いれば45秒ごとにフェードで交代する。
    // 全員を一巡してからシャッフルし直し、同じ人が連続しないようにする。
    let closed=false, menuOpen=false, timer=null, fadeTimer=null, enterTimer=null, cycle=[], idx=0;
    const shuffled=a=>{ const r=a.slice(); for(let i=r.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [r[i],r[j]]=[r[j],r[i]]; } return r; };
    cycle=[cur].concat(shuffled(cands.filter(c=>c!==cur)));  // 最初の巡回は初期表示の人から始める
    idx=1;
    const pickNext=()=>{
      if(idx>=cycle.length){
        cycle=shuffled(cands);
        if(cycle.length>1&&cycle[0]===cur){ const t=cycle[0]; cycle[0]=cycle[1]; cycle[1]=t; }
        idx=0;
      }
      return cycle[idx++];
    };
    const swapTo=nxt=>{
      if(!nxt||nxt===cur) return;
      wrap.style.opacity="0";
      if(fadeTimer) clearTimeout(fadeTimer);
      fadeTimer=setTimeout(()=>{ if(!closed){ show(nxt); wrap.style.opacity="1"; } },460);
    };
    const advance=()=>{
      if(closed||menuOpen) return;
      swapTo(pickNext());
    };
    const startTimer=()=>{ if(!closed&&!menuOpen&&!document.hidden&&cands.length>=2&&!timer) timer=setInterval(advance,45000); };
    const stopTimer=()=>{ if(timer){ clearInterval(timer); timer=null; } };
    // メニューの開閉：開いている間はローテーションを一時停止する
    const setMenu=open=>{
      if(closed) return;
      menuOpen=open;
      wrap.classList.toggle("open",open);
      mainBtn.setAttribute("aria-expanded",String(open));
      if(open) stopTimer(); else startTimer();
    };
    mainBtn.addEventListener("click",()=>setMenu(!menuOpen));
    // メニュー外をタップしたら閉じる
    document.addEventListener("click",e=>{
      if(menuOpen&&e.target&&!wrap.contains(e.target)) setMenu(false);
    });
    // 「次の推しへ」：その場で次の推しに切り替えてメニューを閉じ、ローテーションのタイマーをリセットする
    if(nextItem) nextItem.addEventListener("click",()=>{
      setMenu(false);
      swapTo(pickNext());
      stopTimer(); startTimer();
    });
    startTimer();
    // タブが非表示の間はタイマーを止め、戻ってきたら再開する
    document.addEventListener("visibilitychange",()=>{
      if(document.hidden) stopTimer(); else startTimer();
    });
    // 「非表示にする」：要素を消してセッション内は再表示しない（タイマー類も全て止める）
    wrap.querySelector('[data-act="hide"]').addEventListener("click",()=>{
      closed=true;
      stopTimer();
      if(fadeTimer){ clearTimeout(fadeTimer); fadeTimer=null; }
      if(enterTimer){ clearTimeout(enterTimer); enterTimer=null; }
      wrap.remove();
      try{ sessionStorage.setItem(DISMISS_KEY,"1"); }catch(e){}
    });
    document.body.appendChild(wrap);
    // 登場アニメーション：約1秒後に表示クラスを付けて下からぴょこっと弾ませる（アニメ自体はCSS側）
    enterTimer=setTimeout(()=>{ if(!closed) wrap.classList.add("favfloat-in"); },1000);
  }).catch(()=>{});
});

// ヘッダーのメニューを「≡ボタン＋右サイドドロワー」に置き換える（旧サイト『坂道日和』方式）
document.addEventListener("DOMContentLoaded",()=>{
  const bar=document.querySelector("header.site .nav");
  const nav=bar?bar.querySelector("nav"):null;
  if(!bar||!nav) return;
  const links=[...nav.querySelectorAll("a")];
  if(!links.length) return;
  const btn=document.createElement("button");
  btn.type="button";btn.className="menu-btn";btn.textContent="≡";
  btn.setAttribute("aria-label","メニューを開く");btn.setAttribute("aria-expanded","false");
  bar.appendChild(btn);
  const scrim=document.createElement("div");scrim.className="scrim";
  const drawer=document.createElement("aside");
  drawer.className="drawer";drawer.setAttribute("aria-label","サイトメニュー");drawer.setAttribute("aria-hidden","true");
  const logo=document.querySelector("header.site .logo");
  const head=document.createElement("div");head.className="drawer-head";
  if(logo){const l=document.createElement("a");l.className="logo";l.href=logo.getAttribute("href");l.innerHTML=logo.innerHTML;head.appendChild(l);}
  const close=document.createElement("button");
  close.type="button";close.className="drawer-close";close.textContent="×";close.setAttribute("aria-label","メニューを閉じる");
  head.appendChild(close);drawer.appendChild(head);
  const list=document.createElement("nav");list.className="drawer-links";
  // 案A（3カテゴリ型）の階層でドロワーを構成する：ホーム／調べる／遊ぶ・作る／お知らせ
  const NAV_GROUPS=[
    {label:"調べる", keys:["songs/","live/","blog/","members/"]},
    {label:"遊ぶ・作る", keys:["games/","formation/","setlist/"]},
  ];
  const items=links.map(a=>{
    let path="/";
    try{ path=new URL(a.getAttribute("href"), location.href).pathname; }catch(e){}
    return {a, path};
  });
  const keyOf=it=>it.path==="/"?"/":(it.path.replace(/\/$/,"").split("/").pop()+"/");
  const used=new Set();
  const appendLink=it=>{
    const c=document.createElement("a");
    c.href=it.a.getAttribute("href");c.textContent=it.a.textContent;
    if(it.a.classList.contains("on"))c.className="on";
    list.appendChild(c);used.add(it);
  };
  items.filter(it=>keyOf(it)==="/").forEach(appendLink);
  for(const g of NAV_GROUPS){
    const members=g.keys.map(k=>items.find(it=>keyOf(it)===k)).filter(Boolean);
    if(!members.length) continue;
    const h=document.createElement("div");h.className="drawer-glabel";h.textContent=g.label;
    list.appendChild(h);
    members.forEach(appendLink);
  }
  items.filter(it=>!used.has(it)).forEach(appendLink);
  drawer.appendChild(list);
  const shareBtn=document.createElement("button");
  shareBtn.type="button";shareBtn.className="btn sub drawer-share";shareBtn.textContent="このページを共有する";
  shareBtn.addEventListener("click",()=>shareContent({},shareBtn));
  drawer.appendChild(shareBtn);
  const contactLink=document.createElement("a");
  contactLink.className="drawer-contact";
  contactLink.href=BASE+"contact/";
  contactLink.textContent="データの誤り・ご要望";
  contactLink.style.cssText="display:block;text-align:center;margin:10px 0 2px;font-size:.85em;color:var(--accent,#7e57c2)";
  drawer.appendChild(contactLink);
  const xLink=document.createElement("a");
  xLink.className="drawer-x";
  xLink.href="https://x.com/sakamichia46";
  xLink.target="_blank";xLink.rel="noopener";
  xLink.textContent="X（お知らせ）";
  xLink.style.cssText="display:block;text-align:center;margin:2px 0 2px;font-size:.85em;color:var(--accent,#7e57c2)";
  drawer.appendChild(xLink);
  const themeBtn=document.createElement("button");
  themeBtn.type="button";themeBtn.className="btn sub drawer-share";
  const syncThemeBtn=()=>{ themeBtn.textContent=document.documentElement.dataset.theme==="dark"?"ライトモードに切り替え":"ダークモードに切り替え"; };
  themeBtn.addEventListener("click",()=>{ applyTheme(document.documentElement.dataset.theme==="dark"?"light":"dark"); syncThemeBtn(); });
  syncThemeBtn();
  drawer.appendChild(themeBtn);
  const liteBtn=document.createElement("button");
  liteBtn.type="button";liteBtn.className="btn sub drawer-share";
  const syncLiteBtn=()=>{ liteBtn.textContent=document.documentElement.dataset.lite==="1"?"簡易版（スタイリッシュ）：ON（タップで通常版）":"簡易版（スタイリッシュ）：OFF（タップでON）"; };
  liteBtn.addEventListener("click",()=>{ applyLite(document.documentElement.dataset.lite!=="1"); location.reload(); });
  syncLiteBtn();
  drawer.appendChild(liteBtn);
  const note=document.createElement("p");note.className="drawer-note";
  note.textContent="坂道ファンによる非公式ファンサイトです。公式運営とは関係ありません。";
  drawer.appendChild(note);
  document.body.append(scrim,drawer);
  document.body.classList.add("has-drawer");
  const setOpen=(open)=>{
    document.body.classList.toggle("drawer-open",open);
    btn.setAttribute("aria-expanded",String(open));
    btn.setAttribute("aria-label",open?"メニューを閉じる":"メニューを開く");
    drawer.setAttribute("aria-hidden",String(!open));
    if(open)close.focus({preventScroll:true});
    else btn.focus({preventScroll:true});
  };
  btn.addEventListener("click",()=>setOpen(!document.body.classList.contains("drawer-open")));
  close.addEventListener("click",()=>setOpen(false));
  scrim.addEventListener("click",()=>setOpen(false));
  list.addEventListener("click",()=>setOpen(false));
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&document.body.classList.contains("drawer-open"))setOpen(false);
  });
});
