let INDEX=null; const YEARS={}; const IMGS={};
let MEMBERS=[]; let VIEW="articles"; let WALL=[]; const WPHOTO=96;
let yearSel=null; let loadingYears=false; let apage=1, ppage=1; let ROWS=[];
let MEDIA=""; const GENMAP={};
function photoN(b){ return (b.media||0)||(b.imgn||0); }
function dtVal(b){ return b.date+"T"+(b.time||"00:00"); }
function dateTime(b){ return b.date+(b.time?" "+b.time:""); }
function resetPages(){ apage=1; ppage=1; }
const PAGE=48;
async function loadYear(y){
  if(YEARS[y]) return;
  YEARS[y]=await loadJSON(`blogs/y${y}.json`);
}
const SKEY="sakamichia-blog-state-v1";
function saveState(){
  try{ localStorage.setItem(SKEY, JSON.stringify({
    year:yearSel,
    q:document.getElementById("q").value,
    group:document.getElementById("group").value,
    member:document.getElementById("member").value,
    from:document.getElementById("from").value,
    to:document.getElementById("to").value,
    sort:document.getElementById("sort").value,
    gen:document.getElementById("gen").value,
    media:MEDIA,
    view:VIEW, aPage:apage, pPage:ppage })); }catch(e){}
}
function loadState(){ try{ return JSON.parse(localStorage.getItem(SKEY)||"null"); }catch(e){ return null; } }
async function init(){
  INDEX=await loadJSON("blogs/index.json");
  const years=Object.keys(INDEX.years).sort().reverse();
  const box=document.getElementById("years");
  box.innerHTML=`<button type="button" class="ychip" data-year="">全期間</button>`+years.map(y=>`<button type="button" class="ychip" data-year="${y}">${y}年（${INDEX.years[y]}件）</button>`).join("");
  box.querySelectorAll(".ychip").forEach(ch=>ch.addEventListener("click", async ()=>{
    const y=ch.dataset.year;
    yearSel = (!y || yearSel===y) ? null : y;
    if(yearSel) await loadYear(yearSel);
    syncChips(); resetPages(); render(); saveState();
  }));
  MEMBERS=await loadJSON("members.json");
  buildMemberOptions();
  buildGenOptions();
  document.getElementById("group").addEventListener("change",()=>{ buildMemberOptions(); resetPages(); render(); saveState(); });
  document.getElementById("viewArticles").addEventListener("click",()=>setView("articles"));
  document.getElementById("viewPhotos").addEventListener("click",()=>setView("photos"));
  const latest=years[0]; LATEST=latest;
  // 前回の状態を復元（再読み込みしても検索条件と表示モードを保持する）
  const saved=loadState();
  if(saved){
    if(saved.year&&INDEX.years[saved.year]) yearSel=saved.year;
    else if(Array.isArray(saved.years)&&saved.years.length===1&&INDEX.years[saved.years[0]]&&saved.years[0]!==latest) yearSel=saved.years[0];
  }
  await loadYear(latest);
  if(yearSel) await loadYear(yearSel);
  syncChips();
  // 全期間が対象なので、残りの年も裏で読み込んで順次反映する
  (async()=>{ loadingYears=true; syncChips();
    for(const y of years){ if(!YEARS[y]){ await loadYear(y); render(); } }
    loadingYears=false; syncChips(); render();
  })();
  if(saved){
    if(saved.group){ document.getElementById("group").value=saved.group; buildMemberOptions(); }
    if(saved.member) document.getElementById("member").value=saved.member;
    if(saved.q) document.getElementById("q").value=saved.q;
    if(saved.from) document.getElementById("from").value=saved.from;
    if(saved.to) document.getElementById("to").value=saved.to;
    if(saved.sort) document.getElementById("sort").value=saved.sort;
    if(saved.gen) document.getElementById("gen").value=saved.gen;
    if(saved.media){ MEDIA=saved.media; }
    if(saved.view==="photos"){
      VIEW="photos";
      document.getElementById("viewArticles").classList.remove("on");
      document.getElementById("viewPhotos").classList.add("on");
    }
    if(+saved.aPage>=1) apage=+saved.aPage;
    if(+saved.pPage>=1) ppage=+saved.pPage;
  }
  ["q","group","member","from","to","sort","gen"].forEach(id=>document.getElementById(id).addEventListener("input",()=>{resetPages();render();syncAdvBtn();saveState();}));
  document.querySelectorAll(".mchip").forEach(ch=>ch.addEventListener("click",()=>{ MEDIA=ch.dataset.media; syncMediaChips(); resetPages(); render(); syncAdvBtn(); saveState(); }));
  document.querySelectorAll("[data-preset]").forEach(ch=>ch.addEventListener("click",()=>applyPreset(ch.dataset.preset)));
  syncMediaChips();
  const adv=document.getElementById("advanced"), tog=document.getElementById("advToggle");
  tog.addEventListener("click",()=>{
    adv.hidden=!adv.hidden;
    tog.setAttribute("aria-expanded", String(!adv.hidden));
    syncAdvBtn();
  });
  const dlg=document.getElementById("dlg");
  document.getElementById("dlgClose").addEventListener("click",()=>dlg.close());
  dlg.addEventListener("click",e=>{
    const r=dlg.getBoundingClientRect();
    if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) dlg.close();
  });
  syncAdvBtn();
  render();
}
let LATEST="";
function advActive(){
  const f=document.getElementById("from").value, t=document.getElementById("to").value;
  return !!(f||t) || yearSel!==null || !!MEDIA
    || document.getElementById("sort").value!=="new"
    || !!document.getElementById("gen").value;
}
function syncMediaChips(){
  document.querySelectorAll(".mchip").forEach(ch=>ch.classList.toggle("on", ch.dataset.media===MEDIA));
}
function buildGenOptions(){
  for(const m of MEMBERS) for(const gr of (m.groups||[m.group])) GENMAP[gr+"|"+m.name]=m.gen;
  const pairs=[...new Set(MEMBERS.flatMap(m=>(m.groups||[m.group]).map(gr=>gr+"|"+m.gen)))];
  pairs.sort((a,b)=>{ const [ga,na]=a.split("|"), [gb,nb]=b.split("|");
    return (GORDER.indexOf(ga)-GORDER.indexOf(gb)) || ((+na===0?99:+na)-(+nb===0?99:+nb)); });
  document.getElementById("gen").innerHTML=`<option value="">すべての期生</option>`+pairs.map(p=>{
    const [gr,gn]=p.split("|");
    return `<option value="${p}">${gr}・${+gn>=1?gn+"期生":"その他"}</option>`;
  }).join("");
}
function ymd(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function applyPreset(k){
  const now=new Date(), F=document.getElementById("from"), T=document.getElementById("to");
  if(k==="d30"){ const s=new Date(now); s.setDate(s.getDate()-29); F.value=ymd(s); T.value=ymd(now); }
  else if(k==="thisyear"){ F.value=`${now.getFullYear()}-01-01`; T.value=`${now.getFullYear()}-12-31`; }
  else if(k==="lastyear"){ F.value=`${now.getFullYear()-1}-01-01`; T.value=`${now.getFullYear()-1}-12-31`; }
  else { F.value=""; T.value=""; }
  resetPages(); render(); syncAdvBtn(); saveState();
}
function syncAdvBtn(){
  const tog=document.getElementById("advToggle"); if(!tog) return;
  const open=!document.getElementById("advanced").hidden;
  tog.textContent=`詳細検索${!open&&advActive()?"（設定中）":""} ${open?"▲":"▼"}`;
}
function syncChips(){
  document.querySelectorAll(".ychip").forEach(ch=>ch.classList.toggle("on", (ch.dataset.year||null)===yearSel));
  syncAdvBtn();
  document.getElementById("yearHint").textContent = yearSel
    ? `${yearSel}年だけを表示中です。もう一度押すか「全期間」を押すと全期間に戻ります。`
    : (loadingYears ? `全期間が対象です（他の年を読み込み中…）。` : `全期間（${INDEX.total}件）が対象です。年を押すとその年だけに絞れます。`);
}
const GORDER=["乃木坂46","櫻坂46","日向坂46","欅坂46","けやき坂46"];
function buildMemberOptions(){
  const g=document.getElementById("group").value;
  const sel=document.getElementById("member");
  const prev=sel.value;
  let html=`<option value="">すべてのメンバー</option>`;
  const MC=(INDEX&&INDEX.memberCounts)||null;
  for(const gr of (g?[g]:GORDER)){
    const mem=MEMBERS.filter(m=>(m.groups||[m.group]).includes(gr) && (!MC || (MC[gr+"|"+m.name]||0)>0));
    const gens=[...new Set(mem.map(m=>m.gen))].sort((a,b)=>(a===0?99:a)-(b===0?99:b));
    for(const gen of gens){
      const label=(g?"":gr+"・")+(gen>=1?gen+"期生":"その他");
      const opts=mem.filter(m=>m.gen===gen).sort((a,b)=>String(a.reading).localeCompare(String(b.reading),"ja"))
        .map(m=>`<option value="${esc(m.name)}">${esc(m.name)}</option>`).join("");
      if(opts) html+=`<optgroup label="${label}">${opts}</optgroup>`;
    }
    const RELAYS={"乃木坂46":["3期生リレーブログ","4期生リレーブログ","新4期生リレーブログ","5期生リレーブログ","6期生リレーブログ"],"櫻坂46":["櫻坂46三期生リレーブログ","櫻坂46四期生リレーブログ"],"欅坂46":["欅坂46新二期生リレーブログ"],"日向坂46":["日向坂46新三期生リレーブログ","日向坂46四期生リレーブログ","日向坂46五期生リレーブログ"]};
    if(RELAYS[gr]){
      html+=`<optgroup label="${g?"":gr+"・"}リレーブログ">${RELAYS[gr].map(r=>`<option value="${r}">${r}</option>`).join("")}</optgroup>`;
    }
  }
  sel.innerHTML=html;
  sel.value=[...sel.options].some(o=>o.value===prev)?prev:"";
}
function setView(v){
  VIEW=v; saveState();
  document.getElementById("viewArticles").classList.toggle("on", v==="articles");
  document.getElementById("viewPhotos").classList.toggle("on", v==="photos");
  render();
}
function poolYears(){ return yearSel?[yearSel]:Object.keys(INDEX.years).sort().reverse(); }
function pool(){ return poolYears().flatMap(y=>YEARS[y]||[]); }
function filtered(){
  const q=document.getElementById("q").value, g=document.getElementById("group").value;
  const mv=document.getElementById("member").value;
  const from=document.getElementById("from").value, to=document.getElementById("to").value;
  const gv=document.getElementById("gen").value, sv=document.getElementById("sort").value;
  const arr=pool().filter(b=>{
      const mHit=mv&&(b.member===mv||b.series===mv);
      if(mv&&!mHit) return false;
      if(g&&b.group!==g&&!mHit) return false;
      if(gv){ const [gg,gn]=gv.split("|"); if(b.group!==gg||GENMAP[b.group+"|"+b.member]!==+gn) return false; }
      if(MEDIA==="photo"&&photoN(b)<=0) return false;
      if(MEDIA==="body"&&!b.body) return false;
      return (!from||b.date>=from)&&(!to||b.date<=to)&&includesAll(itemText([b.title,b.group,b.member,b.date,b.series||""]),q);
    });
  if(sv==="old") arr.sort((a,b)=>dtVal(a).localeCompare(dtVal(b)));
  else if(sv==="photos") arr.sort((a,b)=>photoN(b)-photoN(a)||dtVal(b).localeCompare(dtVal(a)));
  else arr.sort((a,b)=>dtVal(b).localeCompare(dtVal(a)));
  return arr;
}
const LOGOS={"乃木坂46":"nogi","櫻坂46":"sakura","欅坂46":"keyaki","日向坂46":"hinata","けやき坂46":"hiragana"};
function thumbHTML(b){
  if(b.thumb) return `<div class="bthumb" data-open="${b.id}"><img loading="lazy" src="${esc(b.thumb)}" alt=""></div>`;
  const logo=LOGOS[b.group]||"nogi";
  return `<div class="bthumb" data-open="${b.id}"><img class="logo-img" loading="lazy" src="${BASE}assets/blog-group-logos/${logo}.webp" alt="${esc(b.group)}"></div>`;
}
function cardHTML(b){
  const nphoto=photoN(b);
  const badges=[nphoto?`<span class="badge">写真${nphoto}枚</span>`:"", b.body?`<span class="badge">本文あり</span>`:""].join("");
  return `<div class="card blog-card">${thumbHTML(b)}${groupChip(b.group)}
    <h3 data-open="${b.id}">${esc(b.title)}${badges}</h3><p>${esc(dateTime(b))} ・ ${esc(b.member)}${b.series&&b.series!==b.member?`（${esc(b.series)}）`:""}</p>
    <p class="card-actions"><button data-open="${b.id}">記事を見る</button>${b.url&&!b.urldead?`<a class="btn sub" href="${esc(b.url)}" target="_blank" rel="noopener">公式サイトへ</a>`:""}</p></div>`;
}
function render(){
  if(VIEW==="photos"){ renderPhotos(); return; }
  renderArticles();
}
function pagerHTML(pages, cur){
  if(pages<=1) return "";
  const nums=new Set([1, pages, cur-1, cur, cur+1]);
  if(cur<=3){ nums.add(2); nums.add(3); nums.add(4); }
  if(cur>=pages-2){ nums.add(pages-1); nums.add(pages-2); nums.add(pages-3); }
  const arr=[...nums].filter(p=>p>=1&&p<=pages).sort((a,b)=>a-b);
  let out=`<div class="pager"><button type="button" data-pg="prev" ${cur<=1?"disabled":""}>← 前へ</button>`;
  let last=0;
  for(const p of arr){
    if(p-last>1) out+=`<span class="gap">…</span>`;
    out+=`<button type="button" data-pg="${p}" class="${p===cur?"on":""}">${p}</button>`;
    last=p;
  }
  out+=`<button type="button" data-pg="next" ${cur>=pages?"disabled":""}>次へ →</button></div>`;
  return out;
}
function bindPager(scope, cur, pages, go){
  scope.querySelectorAll("[data-pg]").forEach(b=>b.addEventListener("click",()=>{
    const v=b.dataset.pg;
    const target= v==="prev" ? cur-1 : v==="next" ? cur+1 : +v;
    if(target>=1&&target<=pages&&target!==cur) go(target);
  }));
}
function scrollToList(){
  const el=document.querySelector(".count-row");
  if(el&&typeof el.scrollIntoView==="function") el.scrollIntoView({block:"start"});
}
function renderArticles(){
  ROWS=filtered();
  document.getElementById("count").textContent=`${ROWS.length}件の記事情報`;
  const pages=Math.max(1, Math.ceil(ROWS.length/PAGE));
  if(apage>pages) apage=pages;
  const list=document.getElementById("list");
  list.innerHTML= ROWS.length ? `<div class="grid">${ROWS.slice((apage-1)*PAGE, apage*PAGE).map(cardHTML).join("")}</div>${pagerHTML(pages, apage)}`
    : `<div class="empty">条件に合う記事がありません。</div>`;
  bindOpen(list);
  bindPager(list, apage, pages, p=>{ apage=p; renderArticles(); scrollToList(); saveState(); });
}
function pcellHTML(p,i){
  return `<figure class="pcell" data-wi="${i}"><img loading="lazy" src="${esc(p.u)}" alt=""><figcaption>${esc(p.label)}</figcaption></figure>`;
}
function bindWall(scope){
  scope.querySelectorAll("[data-wi]").forEach(el=>el.addEventListener("click",()=>{
    openLightbox(WALL.map(p=>p.u), +el.dataset.wi, WALL.map(p=>({id:p.id, label:p.label})));
  }));
}
async function renderPhotos(){
  ROWS=filtered();
  document.getElementById("count").textContent=`${ROWS.length}件の記事情報`;
  for(const y of poolYears()) await ensureImgs(y);
  WALL=[];
  for(const b of ROWS){
    const imgs=(IMGS[b.date.slice(0,4)]||{})[b.id];
    const photos=(imgs&&imgs.length)?imgs:(b.thumb?[b.thumb]:[]);
    photos.forEach(u=>WALL.push({u, id:b.id, label:`${b.member}${b.series&&b.series!==b.member?`（${b.series}）`:""} ・ ${dateTime(b)} ・ ${b.title}`}));
  }
  document.getElementById("count").textContent=`${ROWS.length}件の記事情報（写真${WALL.length}枚）`;
  const pages=Math.max(1, Math.ceil(WALL.length/WPHOTO));
  if(ppage>pages) ppage=pages;
  const start=(ppage-1)*WPHOTO;
  const list=document.getElementById("list");
  list.innerHTML= WALL.length ? `<div class="pgrid">${WALL.slice(start, start+WPHOTO).map((p,i)=>pcellHTML(p,start+i)).join("")}</div>${pagerHTML(pages, ppage)}`
    : `<div class="empty">写真のある記事がありません。</div>`;
  bindWall(list);
  bindPager(list, ppage, pages, p=>{ ppage=p; renderPhotos(); scrollToList(); saveState(); });
}
function bindOpen(scope){
  scope.querySelectorAll("[data-open]").forEach(el=>el.addEventListener("click",()=>openBlog(el.dataset.open)));
}
async function ensureImgs(year){
  if(IMGS[year]) return;
  try{ const r=await fetch(BASE+`data/blog-imgs/y${year}.json`); IMGS[year]= r.ok ? await r.json() : {}; }
  catch(e){ IMGS[year]={}; }
}
let LB={list:[], idx:0, metas:null};
let lbSettling=false;
function lbEl(){ return document.getElementById("lightbox"); }
function lbFilm(){ return lbEl().querySelector(".lb-film"); }
function lbVp(){ return lbEl().querySelector(".lb-viewport"); }
function lbW(){ return lbVp().clientWidth||300; }
function lbCurImg(){ return lbEl().querySelector(".lb-slide.cur img"); }
/* ズーム（旧サイトのビューアと同じ操作：ピンチ・ダブルタップ・拡大時のドラッグ移動） */
const Z={scale:1,x:0,y:0,pinch:null,pan:null,pointers:new Map(),lastTap:null,ignore:false};
const zClamp=(v,a,b)=>Math.min(b,Math.max(a,v));
function zPaint(){
  const img=lbCurImg(); if(!img) return;
  img.style.transform=`translate3d(${Z.x}px,${Z.y}px,0) scale(${Z.scale})`;
  const out=lbEl().querySelector('[data-z="out"]'), inn=lbEl().querySelector('[data-z="in"]'), rst=lbEl().querySelector('[data-z="reset"]');
  if(out) out.disabled=Z.scale<=1;
  if(inn) inn.disabled=Z.scale>=4;
  if(rst) rst.disabled=Z.scale<=1;
}
function zLimits(nx,ny,scale){
  const r=lbVp().getBoundingClientRect(), img=lbCurImg();
  let fw=r.width, fh=r.height;
  if(img&&img.naturalWidth&&img.naturalHeight){
    const ratio=Math.min(r.width/img.naturalWidth, r.height/img.naturalHeight);
    fw=img.naturalWidth*ratio; fh=img.naturalHeight*ratio;
  }
  const bx=Math.max(0,(fw*scale-r.width)/2), by=Math.max(0,(fh*scale-r.height)/2);
  return {x:zClamp(nx,-bx,bx), y:zClamp(ny,-by,by)};
}
function zSetScale(value,cx,cy){
  const r=lbVp().getBoundingClientRect();
  const next=zClamp(value,1,4);
  if(next===1){ Z.scale=1; Z.x=0; Z.y=0; zPaint(); return; }
  if(cx===undefined){ cx=r.width/2; cy=r.height/2; }
  const f=next/Z.scale;
  const p=zLimits((cx-r.width/2)-(cx-r.width/2-Z.x)*f,(cy-r.height/2)-(cy-r.height/2-Z.y)*f,next);
  Z.scale=next; Z.x=p.x; Z.y=p.y; zPaint();
}
function zReset(){ Z.scale=1; Z.x=0; Z.y=0; Z.pinch=null; Z.pan=null; Z.pointers.clear(); Z.lastTap=null; Z.ignore=false; zPaint(); }
function zBlocking(){ return Z.scale>1.001||!!Z.pinch||Z.ignore; }
/* フィルム（前・現在の3枚が指に追従して動き、端では循環する） */
function lbRender(){
  const n=LB.list.length, slides=lbEl().querySelectorAll(".lb-slide");
  const set=(el,url,show)=>{
    const img=el.querySelector("img");
    if(show&&url){ if(img.getAttribute("src")!==url) img.src=url; img.style.visibility=""; }
    else { img.removeAttribute("src"); img.style.visibility="hidden"; }
  };
  set(slides[0], n?LB.list[(LB.idx-1+n)%n]:null, n>1);
  set(slides[1], n?LB.list[LB.idx]:null, n>0);
  set(slides[2], n?LB.list[(LB.idx+1)%n]:null, n>1);
  lbEl().querySelector(".lb-count").textContent=n?`${LB.idx+1} / ${n}`:"";
  const meta=lbEl().querySelector(".lb-meta"), ab=lbEl().querySelector('[data-lb="article"]');
  if(LB.metas&&n){ meta.textContent=LB.metas[LB.idx].label; ab.hidden=false; }
  else { meta.textContent=""; ab.hidden=true; }
  lbEl().querySelector('[data-lb="prev"]').disabled=n<2;
  lbEl().querySelector('[data-lb="next"]').disabled=n<2;
  zReset();
}
function lbSetDrag(px){ lbFilm().style.setProperty("--drag-x", px+"px"); }
function swipeStep(dx,width,ms){
  const d=Math.abs(dx);
  if(!isFinite(d)||d<25) return 0;
  const th=Math.min(90,Math.max(44,(width||300)*0.18));
  if(d<th && d/Math.max(ms||1,1)<0.55) return 0;
  return dx<0?1:-1;
}
function lbFinish(step){
  const film=lbFilm(), n=LB.list.length;
  film.classList.remove("settling");
  film.style.transition="none";
  if(step&&n>1) LB.idx=(LB.idx+step+n)%n;
  lbRender();
  lbSetDrag(0);
  void film.offsetWidth;
  film.style.removeProperty("transition");
  lbSettling=false;
}
function lbSettle(step){
  const film=lbFilm(); if(!film||lbSettling) return;
  if(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches){ lbFinish(step); return; }
  lbSettling=true;
  film.classList.add("settling");
  lbSetDrag(step?(step>0?-lbW():lbW()):0);
  let done=false;
  const fin=()=>{ if(done) return; done=true; film.removeEventListener("transitionend",onEnd); lbFinish(step); };
  const onEnd=e=>{ if(e.target===film&&e.propertyName==="transform") fin(); };
  film.addEventListener("transitionend",onEnd);
  setTimeout(fin,330);
}
function lbDragShift(dx){
  const n=LB.list.length, W=lbW();
  if(n<2) return Math.sign(dx)*Math.min(Math.abs(dx)*0.18,34);
  return Math.max(-W,Math.min(W,dx));
}
function openLightbox(list, idx, metas){
  LB={list, idx, metas:metas||null};
  let lb=lbEl();
  if(!lb){
    lb=document.createElement("div"); lb.id="lightbox"; lb.className="lightbox"; lb.hidden=true;
    lb.innerHTML=`<div class="lb-viewport"><div class="lb-film"><div class="lb-slide"><img alt="" draggable="false"></div><div class="lb-slide cur"><img alt="" draggable="false"></div><div class="lb-slide"><img alt="" draggable="false"></div></div></div><div class="lb-meta"></div><div class="lb-bar"><button data-lb="prev">← 前へ</button><span class="lb-count"></span><button data-lb="next">次へ →</button><span class="lb-zoom"><button data-z="out" title="縮小する">−</button><button data-z="in" title="拡大する">＋</button><button data-z="reset" title="拡大を解除する">等倍</button></span><button data-lb="article" hidden>記事を開く</button><button data-lb="close">閉じる</button></div>`;
    document.body.appendChild(lb);
    const vp=lb.querySelector(".lb-viewport");
    const closeLb=()=>{ lb.hidden=true; zReset(); lbSetDrag(0); };
    lb.addEventListener("click",e=>{ if(e.target===lb) closeLb(); });
    lb.querySelectorAll("[data-lb]").forEach(b=>b.addEventListener("click",()=>{
      const a=b.dataset.lb;
      if(a==="close") closeLb();
      if(a==="article"&&LB.metas){ const id=LB.metas[LB.idx].id; closeLb(); openBlog(id); }
      if(a==="prev") lbSettle(-1);
      if(a==="next") lbSettle(1);
    }));
    lb.querySelectorAll("[data-z]").forEach(b=>b.addEventListener("click",()=>{
      const a=b.dataset.z;
      if(a==="in") zSetScale(Z.scale+0.5);
      if(a==="out") zSetScale(Z.scale-0.5);
      if(a==="reset") zSetScale(1);
    }));
    /* 指に追従するスライド：タッチは専用経路（長押し保存を妨げないよう、横ドラッグが確定するまでブラウザに任せる） */
    let tDrag=null, mDrag=null;
    const cancelDrags=()=>{ tDrag=null; mDrag=null; lbSetDrag(0); };
    vp.addEventListener("touchstart",e=>{
      if(e.touches.length!==1||lbSettling||zBlocking()){ if(tDrag&&tDrag.active) lbSetDrag(0); tDrag=null; return; }
      const t=e.touches[0];
      tDrag={id:t.identifier,x:t.clientX,y:t.clientY,dx:0,start:performance.now(),active:false,vertical:false};
    },{passive:true});
    vp.addEventListener("touchmove",e=>{
      if(!tDrag) return;
      if(lbSettling||zBlocking()){ if(tDrag.active) lbSetDrag(0); tDrag=null; return; }
      const t=[...e.changedTouches].find(t=>t.identifier===tDrag.id); if(!t) return;
      const dx=t.clientX-tDrag.x, dy=t.clientY-tDrag.y;
      if(tDrag.vertical) return;
      if(!tDrag.active){
        if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)*1.12){ tDrag.vertical=true; return; }
        if(Math.abs(dx)<8||Math.abs(dx)<=Math.abs(dy)*1.12) return;
        tDrag.active=true;
      }
      if(e.cancelable) e.preventDefault();
      tDrag.dx=dx; lbSetDrag(lbDragShift(dx));
    },{passive:false});
    const tEnd=canceled=>{
      if(!tDrag) return;
      const d=tDrag; tDrag=null;
      if(!d.active) return;
      lbSettle(!canceled&&LB.list.length>1?swipeStep(d.dx,lbW(),performance.now()-d.start):0);
    };
    vp.addEventListener("touchend",e=>{ if(tDrag&&![...e.changedTouches].some(t=>t.identifier===tDrag.id)) return; tEnd(false); },{passive:true});
    vp.addEventListener("touchcancel",()=>tEnd(true),{passive:true});
    /* マウス/ペンはポインター経路で同じ追従をする */
    vp.addEventListener("pointerdown",e=>{
      if(lb.hidden||lbSettling||e.pointerType==="touch"||zBlocking()||(e.pointerType==="mouse"&&e.button!==0)||e.isPrimary===false) return;
      mDrag={id:e.pointerId,x:e.clientX,y:e.clientY,dx:0,start:performance.now(),active:false,vertical:false};
    });
    vp.addEventListener("pointermove",e=>{
      if(e.pointerType==="touch") return;
      if(zBlocking()){ mDrag=null; return; }
      if(!mDrag||e.pointerId!==mDrag.id||lbSettling) return;
      const dx=e.clientX-mDrag.x, dy=e.clientY-mDrag.y;
      if(mDrag.vertical) return;
      if(!mDrag.active){
        if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)*1.12){ mDrag.vertical=true; return; }
        if(Math.abs(dx)<8||Math.abs(dx)<=Math.abs(dy)*1.12) return;
        mDrag.active=true;
        try{ vp.setPointerCapture(e.pointerId); }catch(_e){}
      }
      if(e.cancelable) e.preventDefault();
      mDrag.dx=dx; lbSetDrag(lbDragShift(dx));
    });
    const mEnd=(e,canceled)=>{
      if(e.pointerType==="touch"||!mDrag||mDrag.id!==e.pointerId) return;
      const d=mDrag; mDrag=null;
      try{ if(vp.hasPointerCapture(e.pointerId)) vp.releasePointerCapture(e.pointerId); }catch(_e){}
      if(!d.active) return;
      lbSettle(!canceled&&LB.list.length>1?swipeStep(d.dx,lbW(),performance.now()-d.start):0);
    };
    vp.addEventListener("pointerup",e=>mEnd(e,false));
    vp.addEventListener("pointercancel",e=>mEnd(e,true));
    /* ズーム：ピンチ／ダブルタップ／拡大時のパン（スワイプより優先） */
    vp.addEventListener("pointerdown",e=>{
      if(lb.hidden||(e.pointerType==="mouse"&&e.button!==0)) return;
      const r=vp.getBoundingClientRect(), p={x:e.clientX-r.left,y:e.clientY-r.top};
      Z.pointers.set(e.pointerId,{...p,startX:p.x,startY:p.y,startTime:e.timeStamp,moved:false,type:e.pointerType});
      if(Z.pointers.size>=2){
        if(!Z.pinch){ Z.ignore=true; cancelDrags(); }
        const [a,b2]=[...Z.pointers.values()];
        Z.pinch={distance:Math.max(1,Math.hypot(a.x-b2.x,a.y-b2.y)),cx:(a.x+b2.x)/2,cy:(a.y+b2.y)/2,scale:Z.scale,x:Z.x,y:Z.y};
        Z.pan=null;
      } else if(Z.scale>1.001) Z.pan={id:e.pointerId,startX:p.x,startY:p.y,x:Z.x,y:Z.y};
    });
    vp.addEventListener("pointermove",e=>{
      const old=Z.pointers.get(e.pointerId); if(!old) return;
      const r=vp.getBoundingClientRect(), nx=e.clientX-r.left, ny=e.clientY-r.top;
      if(Math.hypot(nx-old.startX,ny-old.startY)>9) old.moved=true;
      old.x=nx; old.y=ny;
      if(Z.pinch&&Z.pointers.size>=2){
        const [a,b2]=[...Z.pointers.values()];
        const d=Math.max(1,Math.hypot(a.x-b2.x,a.y-b2.y));
        const z=zClamp(Z.pinch.scale*d/Z.pinch.distance,1,4), f=z/Z.pinch.scale;
        const cx=(a.x+b2.x)/2, cy=(a.y+b2.y)/2;
        const p=zLimits(cx-r.width/2-(Z.pinch.cx-r.width/2-Z.pinch.x)*f, cy-r.height/2-(Z.pinch.cy-r.height/2-Z.pinch.y)*f, z);
        Z.scale=z; Z.x=p.x; Z.y=p.y; zPaint();
        if(e.cancelable) e.preventDefault();
        return;
      }
      if(Z.pan&&Z.pan.id===e.pointerId&&Z.scale>1.001){
        const p=zLimits(Z.pan.x+nx-Z.pan.startX, Z.pan.y+ny-Z.pan.startY, Z.scale);
        Z.x=p.x; Z.y=p.y; zPaint();
        if(e.cancelable) e.preventDefault();
      }
    });
    const zEnd=e=>{
      const p=Z.pointers.get(e.pointerId); if(!p) return;
      Z.pointers.delete(e.pointerId);
      if(Z.pinch){
        Z.pinch=null;
        if(Z.scale<1.01){ Z.scale=1; Z.x=0; Z.y=0; zPaint(); }
        if(Z.pointers.size===1){ const [id,one]=[...Z.pointers.entries()][0]; Z.pan=Z.scale>1.001?{id,startX:one.x,startY:one.y,x:Z.x,y:Z.y}:null; }
      } else if(p.type==="touch"&&!p.moved&&e.type==="pointerup"&&e.timeStamp-p.startTime<300&&!Z.ignore){
        if(Z.lastTap&&e.timeStamp-Z.lastTap.time<330&&Math.hypot(Z.lastTap.x-p.x,Z.lastTap.y-p.y)<36){
          zSetScale(Z.scale>1.001?1:2.5,p.x,p.y); Z.lastTap=null;
        } else Z.lastTap={time:e.timeStamp,x:p.x,y:p.y};
      }
      if(!Z.pointers.size){ Z.pan=null; Z.ignore=false; }
    };
    vp.addEventListener("pointerup",zEnd);
    vp.addEventListener("pointercancel",zEnd);
    vp.addEventListener("dblclick",e=>{
      if(e.pointerType==="touch") return;
      const r=vp.getBoundingClientRect();
      zSetScale(Z.scale>1.001?1:2.5, e.clientX-r.left, e.clientY-r.top);
    });
    document.addEventListener("keydown",e=>{
      if(lb.hidden) return;
      if(e.key==="Escape") closeLb();
      if(e.key==="ArrowLeft") lbSettle(-1);
      if(e.key==="ArrowRight") lbSettle(1);
    });
  }
  lb.hidden=false;
  lbSetDrag(0);
  lbRender();
}
async function openBlog(id){
  const b=pool().find(x=>x.id===id); if(!b) return;
  const body=document.getElementById("dlgBody");
  const dlg=document.getElementById("dlg");
  body.innerHTML=`${groupChip(b.group)}<h3>${esc(b.title)}</h3><p>${esc(dateTime(b))} ・ ${esc(b.member)}${b.series&&b.series!==b.member?`（${esc(b.series)}）`:""}</p><p>読み込んでいます…</p>`;
  dlg.showModal();
  let html=`${groupChip(b.group)}<h3>${esc(b.title)}</h3><p>${esc(dateTime(b))} ・ ${esc(b.member)}${b.series&&b.series!==b.member?`（${esc(b.series)}）`:""}</p>`;
  let photos=[];
  if(b.body){
    try{
      const r=await fetch(BASE+"data/bodies/"+encodeURIComponent(id)+".json");
      if(r.ok){
        const d=await r.json();
        photos=(d.blocks||[]).filter(x=>x.type==="image").map(x=>x.src);
        html+=`<div class="blog-body">${(d.blocks||[]).map(x=>{
          if(x.type==="paragraph") return `<p>${esc(x.text||"")}</p>`;
          if(x.type==="image") return `<img class="bimg" loading="lazy" src="${esc(x.src)}" alt="" data-photo="${photos.indexOf(x.src)}">`;
          return "";
        }).join("")}</div><p style="color:var(--muted);font-size:12px">${d.source==="official"?"本文は公式ブログから取り込んだものです。":"本文・写真は旧サイト『坂道日和』の保存データです。"}</p>`;
      }
    }catch(e){}
  }
  if(!photos.length){
    await ensureImgs(b.date.slice(0,4));
    photos=(IMGS[b.date.slice(0,4)]||{})[id]||[];
    if(photos.length){
      html+=`<div class="photo-grid">${photos.map((u,i)=>`<img loading="lazy" src="${esc(u)}" alt="" data-photo="${i}">`).join("")}</div><p style="color:var(--muted);font-size:12px">公式ブログの写真を表示しています（タップで拡大）。</p>`;
    } else if(b.thumb){
      html+=`<div class="bthumb" style="aspect-ratio:auto"><img src="${esc(b.thumb)}" alt=""></div>`;
    } else {
      html+=`<p style="color:var(--muted)">この記事の写真は保存されていません。</p>`;
    }
  }
  if(b.url) html+=`<p><a class="btn" href="${esc(b.url)}" target="_blank" rel="noopener">公式記事を見る</a></p>`;
  body.innerHTML=html;
  body.querySelectorAll("[data-photo]").forEach(img=>img.addEventListener("click",()=>openLightbox(photos, +img.dataset.photo)));
}
init();
