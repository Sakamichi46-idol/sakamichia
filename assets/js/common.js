// サカミチア 共通処理：データ読み込み・カード描画・絞り込み
const BASE = document.body.dataset.base || "./";
async function loadJSON(name){
  const r = await fetch(BASE + "data/" + name);
  if(!r.ok) return [];
  return r.json();
}
function esc(s){return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function groupChip(g){return g ? `<span class="chip g-${esc(g)}">${esc(g)}</span>` : "";}
function tags(list){return (list||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("");}
function includesAll(hay, q){
  if(!q) return true;
  return hay.toLowerCase().includes(q.toLowerCase());
}
function itemText(parts){return parts.flat(Infinity).filter(Boolean).join(" ");}

// 共有：対応環境では共有シートを開き、なければクリップボードへコピーする
async function shareContent(data, btn){
  const payload={title:data.title||document.title, text:data.text||"", url:data.url||location.href};
  if(navigator.share){
    try{ await navigator.share(payload); }catch(e){ /* キャンセル時は何もしない */ }
    return;
  }
  try{
    await navigator.clipboard.writeText((payload.text?payload.text+" ":"")+payload.url);
    if(btn){ const t=btn.textContent; btn.textContent="コピーしました"; setTimeout(()=>{btn.textContent=t;},1800); }
  }catch(e){ if(btn){ const t=btn.textContent; btn.textContent="コピーできませんでした"; setTimeout(()=>{btn.textContent=t;},1800); } }
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
