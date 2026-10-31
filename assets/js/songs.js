let DATA=[]; let FORMS={}; let MEMB={}; const SEL=new Set(); const YSEL=new Set(); const TSEL=new Set();
let yearMS=null, typeMS=null;   // 年・曲種の複数選択プルダウン（値は文字列で保持）
// ディープリンク（?member=<名前>）専用の参加曲絞り込み。参加の根拠は詳細ダイアログの
// 「参加メンバー／歌唱メンバー」と同じく formations の rows（配置）／vocal（歌唱）とする
let MFILTER=""; let PARTS=[];
function participantsOf(s){
  const f=FORMS[`${s.group}|${s.title}`];
  if(!f) return [];
  if(f.rows&&f.rows.length) return f.rows.flat();
  if(f.vocal&&f.vocal.length) return f.vocal;
  return [];
}
// 楽曲→ライブ逆引き（data/song-live.json、daily 再生成）。大きいので初回ダイアログ表示時に遅延読み込みする
let SONGLIVE=null, SONGLIVE_P=null, openSongTitle=null;
function ensureSongLive(){
  if(SONGLIVE) return Promise.resolve(SONGLIVE);
  if(!SONGLIVE_P) SONGLIVE_P = loadJSON("song-live.json").then(d=>{ SONGLIVE=(d && d.songs) ? d : {shows:{}, songs:{}}; return SONGLIVE; }).catch(()=>{ SONGLIVE={shows:{}, songs:{}}; return SONGLIVE; });
  return SONGLIVE_P;
}
function renderSongLive(title){
  const box=document.getElementById("dlgSongLive");
  if(!box || openSongTitle!==title) return;   // 別の曲のダイアログに切り替わっていたら描かない
  const e=SONGLIVE && SONGLIVE.songs ? SONGLIVE.songs[title] : null;
  if(!e || !e.ids || !e.ids.length){ box.innerHTML=""; return; }
  const SHOW_MAX=20;
  const rows=e.ids.slice(0, SHOW_MAX).map(id=>{
    const sh=(SONGLIVE.shows||{})[id]; if(!sh) return "";
    return `<div style="padding:7px 0;border-bottom:1px solid var(--line)"><a href="../live/?show=${encodeURIComponent(id)}"><b>${esc(sh[1])}</b></a><br><span style="color:var(--muted);font-size:13px">${esc(sh[0])}${sh[2]?` ・ ${esc(sh[2])}`:""}</span></div>`;
  }).join("");
  box.innerHTML=`<h4 style="margin:16px 0 4px">この曲が披露されたライブ（${e.n}件）</h4>${rows}`
    + (e.n>SHOW_MAX ? `<p style="color:var(--muted);font-size:13px;margin:6px 0 0">新しい順に${SHOW_MAX}件まで表示しています（全${e.n}件）。</p>` : "");
}
// グループ・年・曲種チップの選択状態表示と「選択をクリア」ボタンの表示をまとめて同期する
function syncTabs(){
  document.querySelectorAll("#groupTabs button").forEach(x=>{
    const on = x.dataset.g==="" ? SEL.size===0 : SEL.has(x.dataset.g);
    x.classList.toggle("on", on);
    x.setAttribute("aria-pressed", on ? "true" : "false");
  });
  if(yearMS) yearMS.refresh();
  if(typeMS) typeMS.refresh();
  // 「条件をリセット」はチップだけでなく検索・並び替えも含めて初期状態と異なる間だけ出す
  const clr=document.getElementById("clearSel");
  if(clr){
    const qEl=document.getElementById("q"), sEl=document.getElementById("sort");
    clr.hidden = !(SEL.size||YSEL.size||TSEL.size||MFILTER||(qEl&&qEl.value)||(sEl&&sEl.value!=="old"));
  }
}
const GCOL={"乃木坂46":"#7e57c2","櫻坂46":"#e77a9b","日向坂46":"#5aa9d6","欅坂46":"#5eba53","けやき坂46":"#a4c639","坂道AKB":"#d24a43","坂道選抜":"#2f9e8f"};
async function init(){
  let members=[];
  [DATA, FORMS, members]=await Promise.all([loadJSON("songs.json"), loadJSON("formations.json"), loadJSON("members.json")]);
  MEMB={}; (members||[]).forEach(m=>{ MEMB[m.name]=m; });
  PARTS=DATA.map(s=>new Set(participantsOf(s)));
  document.querySelectorAll("#groupTabs button").forEach(b=>b.addEventListener("click",()=>{
    const key=b.dataset.g;
    if(key==="") SEL.clear();
    else if(SEL.has(key)) SEL.delete(key);
    else SEL.add(key);
    syncTabs();
    if(SEL.size===1){
      const only=[...document.querySelectorAll("#groupTabs button")].find(x=>x.dataset.g===[...SEL][0]);
      document.body.dataset.group=only ? (only.dataset.acc||"") : "";
    } else {
      document.body.dataset.group="";
    }
    render();
  }));
  // 年の複数選択プルダウン（選択同士は OR）
  const years=[...new Set(DATA.map(s=>s.year).filter(Boolean))].sort((a,b)=>b-a);
  yearMS=createMultiSelect(document.getElementById("yearMS"),{
    allLabel:"すべての年", selected:YSEL, ariaLabel:"年",
    options:years.map(y=>({value:String(y), label:y+"年"})),
    onChange:()=>{ syncTabs(); render(); }
  });
  // 曲種の複数選択プルダウン（データ内の type の実値から作る。選択同士は OR）
  const typeCounts={};
  DATA.forEach(s=>{ const t=s.type||""; if(t) typeCounts[t]=(typeCounts[t]||0)+1; });
  const types=Object.keys(typeCounts).sort((a,b)=>typeCounts[b]-typeCounts[a]);
  typeMS=createMultiSelect(document.getElementById("typeMS"),{
    allLabel:"すべての曲種", selected:TSEL, ariaLabel:"曲種",
    options:types.map(t=>({value:t, label:t})),
    onChange:()=>{ syncTabs(); render(); }
  });
  // 条件をリセット：チップ（グループ・年・曲種）・検索・並び替えをすべて初期状態に戻す
  document.getElementById("clearSel").addEventListener("click",()=>{
    SEL.clear(); YSEL.clear(); TSEL.clear(); MFILTER="";
    document.body.dataset.group="";
    document.getElementById("q").value="";
    document.getElementById("sort").value="old";
    syncTabs();
    render();
  });
  ["q","sort"].forEach(id=>document.getElementById(id).addEventListener("input",()=>{ syncTabs(); render(); }));
  // ディープリンク（?q=<検索語>）：トップのサジェストなどから曲名で絞り込んで開く
  const qParam=new URLSearchParams(location.search).get("q");
  if(qParam) document.getElementById("q").value=qParam;
  // ディープリンク（?member=<名前>）：推しフローティングの「参加曲」などから、そのメンバーの参加曲だけに絞って開く
  const mParam=new URLSearchParams(location.search).get("member");
  if(mParam) MFILTER=mParam;
  syncTabs();
  render();
}
function matchG(s){
  if(SEL.size===0) return true;
  for(const k of SEL){
    if(k==="合同"){ if(s.special==="坂道合同") return true; }
    else if(s.group===k) return true;
  }
  return false;
}
function genreRank(s){ const g=s.genre||""; return (/^A[:：]/.test(g)||/表題曲|リード曲/.test(g)) ? 0 : 1; }
function render(){
  const q=document.getElementById("q").value, sort=document.getElementById("sort").value;
  let rows=DATA.map((s,i)=>[s,i]).filter(([s],i)=>matchG(s)&&(YSEL.size===0||YSEL.has(String(s.year)))&&(TSEL.size===0||TSEL.has(s.type||""))&&(!MFILTER||(PARTS[i]&&PARTS[i].has(MFILTER)))&&includesAll(itemText([s.title,s.center,s.group,s.year,s.special]),q));
  if(sort==="title"){
    const ykey=s=>s.yomi||s.title;
    rows.sort((a,b)=>ykey(a[0]).localeCompare(ykey(b[0]),"ja") || a[0].title.localeCompare(b[0].title,"ja"));
  } else {
    const desc = sort==="new";
    const relKey = s => `${s.group}|${s.release||""}|${s.date||"9999-12-31"}`;
    const firstRel = new Map();
    rows.forEach(([s],idx)=>{ const k=relKey(s); if(!firstRel.has(k)) firstRel.set(k, idx); });
    rows.sort((a,b)=>{
      const da=a[0].date||"", db=b[0].date||"";
      if(!!da!==!!db) return da ? -1 : 1;
      if(da!==db) return desc ? db.localeCompare(da) : da.localeCompare(db);
      const fr=firstRel.get(relKey(a[0]))-firstRel.get(relKey(b[0]));
      if(fr) return desc ? -fr : fr;
      const oa=a[0].ord, ob=b[0].ord;
      if(oa!=null && ob!=null && oa!==ob) return oa-ob;
      if(oa!=null && ob==null) return -1;
      if(oa==null && ob!=null) return 1;
      const gr=genreRank(a[0])-genreRank(b[0]); if(gr) return gr;
      return a[1]-b[1];
    });
  }
  document.getElementById("count").textContent=`${rows.length}曲`+(MFILTER?`（${MFILTER}の参加曲）`:"");
  document.getElementById("list").innerHTML=rows.map(([s,i])=>`<div class="card">${groupChip(s.group)}
    <h3>${esc(s.title)}</h3><p>${s.year?esc(s.year)+"年 ・ ":""}${esc(s.type||"")}${s.center?`<br>センター：${esc(s.center)}`:""}</p>
    <p><button data-open="${i}">フォーメーション・詳細</button></p></div>`).join("")
    || `<div class="empty">条件に合う楽曲がありません。</div>`;
  document.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>openSong(+b.dataset.open)));
}
// 参加メンバーの並びはメンバーページ（members.js）と統一する：系統→期→五十音（reading）。
// 系統は改名をまたぐ「最後の所属」から判定し（欅坂46・櫻坂46は同一系統、日向坂46・けやき坂46も同一系統）、
// 期なし（ポカ・交換留学生）は系統内の最後尾（99）。フォーメーション図の配置には使わず、一覧表示だけに適用する。
const MEMB_FAM_ORDER=["乃木坂46","櫻坂46","日向坂46"];
const MEMB_ERA_RANK={"けやき坂46":1,"欅坂46":2,"櫻坂46":3,"日向坂46":3,"乃木坂46":0};
const MEMB_FAMILY={"乃木坂46":"乃木坂46","櫻坂46":"櫻坂46","欅坂46":"櫻坂46","日向坂46":"日向坂46","けやき坂46":"日向坂46"};
function membFamily(m){
  const gs=(m.groups&&m.groups.length)?m.groups:[m.group];
  let lg=m.group, br=-1;
  for(const g of gs){ const r=(g in MEMB_ERA_RANK)?MEMB_ERA_RANK[g]:0; if(r>br){ br=r; lg=g; } }
  return MEMB_FAMILY[lg]||lg;
}
function cmpMembName(a,b){
  const ma=MEMB[a], mb=MEMB[b];
  if(ma&&mb) return MEMB_FAM_ORDER.indexOf(membFamily(ma))-MEMB_FAM_ORDER.indexOf(membFamily(mb))
    || (ma.gen>0?ma.gen:99)-(mb.gen>0?mb.gen:99)
    || (ma.reading||ma.name).localeCompare(mb.reading||mb.name,"ja");
  if(ma) return -1;   // 名簿に無い参加者（坂道AKBのAKB側メンバー等）は坂道メンバーの後ろに名前順で並べる
  if(mb) return 1;
  return String(a).localeCompare(String(b),"ja");
}
function sortedParticipants(names){ return [...names].sort(cmpMembName); }
function openSong(i){
  const s=DATA[i]; if(!s) return;
  openSongTitle=s.title;
  const f=FORMS[`${s.group}|${s.title}`];
  const dlg=document.getElementById("dlg");
  dlg.style.setProperty("--page", GCOL[s.group]||"#2b2430");
  let html=`${groupChip(s.group)}<h3>${esc(s.title)}</h3>
  <p>${s.date?esc(s.date)+"発売":""}${s.type?` ・ ${esc(s.type)}`:""}${s.center?`<br>センター：<b>${esc(s.center)}</b>`:""}</p>`;
  if((s.writers&&s.writers.length)||(s.arrangers&&s.arrangers.length))
    html+=`<p style="color:var(--muted);font-size:13px">${s.writers&&s.writers.length?`作曲：${esc(s.writers.join("、"))}`:""}${s.arrangers&&s.arrangers.length?`　編曲：${esc(s.arrangers.join("、"))}`:""}</p>`;
  if(f && f.rows && f.rows.length){
    const last=f.rows.length-1;
    html+=`<h4 style="margin:16px 0 4px">フォーメーション</h4>
    <p style="color:var(--muted);font-size:12px;margin:0 0 6px">上が後列、下が前列です。色付きがセンター。${f.official?"（公式発表に基づく）":"（参考データに基づく）"}</p>
    <div class="fwrap">${f.rows.map((row,ri)=>{
      const n=row.length;
      const ctr = ri===last ? (n%2===1 ? [Math.floor(n/2)] : [n/2-1, n/2]) : [];
      return `<div class="frow">${row.map((name,ci)=>`<span class="fm${ctr.includes(ci)?" ctr":""}">${esc(name)}</span>`).join("")}</div>`;
    }).join("")}</div>`;
    const all=sortedParticipants(f.rows.flat());
    html+=`<h4 style="margin:16px 0 4px">参加メンバー（${all.length}名）</h4><p style="line-height:2">${all.map(esc).join("、")}</p>`;
    html+=`<p style="margin-top:14px"><button type="button" id="dlgEditFormation">このフォーメーションを編集する</button></p>`;
  } else if(f && f.vocal && f.vocal.length){
    html+=`<h4 style="margin:16px 0 4px">歌唱メンバー（${f.vocal.length}名）</h4><p style="line-height:2">${f.vocal.map(esc).join("、")}</p>`;
  } else if(f && f.note){
    html+=`<h4 style="margin:16px 0 4px">歌唱メンバー</h4><p style="line-height:2">${esc(f.note)}</p>`;
  } else {
    html+=`<p style="color:var(--muted)">フォーメーション情報は未登録です。</p>`;
  }
  if(f && f.vocal && f.rows && f.rows.length)
    html+=`<h4 style="margin:16px 0 4px">歌唱メンバー（${f.vocal.length}名）</h4><p style="line-height:2">${f.vocal.map(esc).join("、")}</p>`;
  html+=`<div id="dlgSongLive"></div>`;
  document.getElementById("dlgBody").innerHTML=html;
  dlg.showModal();
  ensureSongLive().then(()=>renderSongLive(s.title));
  fitFormation();
  const eb=document.getElementById("dlgEditFormation");
  if(eb) eb.addEventListener("click",()=>{
    const rows=[...f.rows].reverse();   // 作成ページは最前列（1列目）から順に持つ
    const st={title:s.title, rows:rows.map(r=>r.length), showCenter:true, positions:rows.flat()};
    try{ localStorage.setItem("sakamichia-formation-import", JSON.stringify(st)); }catch(e){}
    location.href="../formation/";
  });
}
init();
function fitFormation(){
  const rows=[...document.querySelectorAll("#dlgBody .frow")];
  if(!rows.length) return;
  let target=13;
  rows.forEach(row=>{
    let fs=13; row.style.fontSize=fs+"px";
    let guard=0;
    while(row.scrollWidth>row.clientWidth && fs>7 && guard++<26){ fs-=0.5; row.style.fontSize=fs+"px"; }
    if(fs<target) target=fs;
  });
  rows.forEach(row=>{ row.style.fontSize=target+"px"; });
}
