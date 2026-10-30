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
    {label:"調べる", keys:["songs/","live/","blog/","members/","matome/"]},
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
