let DATA=[]; let FORMS={}; const SEL=new Set(); const YSEL=new Set();
const GCOL={"乃木坂46":"#7e57c2","櫻坂46":"#e77a9b","日向坂46":"#5aa9d6","欅坂46":"#5eba53","けやき坂46":"#a4c639","坂道AKB":"#d24a43","坂道選抜":"#2f9e8f"};
async function init(){
  [DATA, FORMS]=await Promise.all([loadJSON("songs.json"), loadJSON("formations.json")]);
  document.querySelectorAll("#groupTabs button").forEach(b=>b.addEventListener("click",()=>{
    const key=b.dataset.g;
    if(key==="") SEL.clear();
    else if(SEL.has(key)) SEL.delete(key);
    else SEL.add(key);
    document.querySelectorAll("#groupTabs button").forEach(x=>{
      const on = x.dataset.g==="" ? SEL.size===0 : SEL.has(x.dataset.g);
      x.classList.toggle("on", on);
      x.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if(SEL.size===1){
      const only=[...document.querySelectorAll("#groupTabs button")].find(x=>x.dataset.g===[...SEL][0]);
      document.body.dataset.group=only ? (only.dataset.acc||"") : "";
    } else {
      document.body.dataset.group="";
    }
    render();
  }));
  const years=[...new Set(DATA.map(s=>s.year).filter(Boolean))].sort((a,b)=>b-a);
  const ybox=document.getElementById("yearTabs");
  ybox.innerHTML=`<button data-y="" class="on">すべての年</button>`+years.map(y=>`<button data-y="${y}">${y}年</button>`).join("")+`<span class="tabhint">年もタップで複数選択できます</span>`;
  ybox.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
    const y=b.dataset.y;
    if(y==="") YSEL.clear();
    else if(YSEL.has(+y)) YSEL.delete(+y);
    else YSEL.add(+y);
    ybox.querySelectorAll("button").forEach(x=>{
      const on = x.dataset.y==="" ? YSEL.size===0 : YSEL.has(+x.dataset.y);
      x.classList.toggle("on", on);
      x.setAttribute("aria-pressed", on ? "true" : "false");
    });
    render();
  }));
  ["q","sort"].forEach(id=>document.getElementById(id).addEventListener("input",render));
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
  let rows=DATA.map((s,i)=>[s,i]).filter(([s])=>matchG(s)&&(YSEL.size===0||YSEL.has(s.year))&&includesAll(itemText([s.title,s.center,s.group,s.year,s.special]),q));
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
  document.getElementById("count").textContent=`${rows.length}曲`;
  document.getElementById("list").innerHTML=rows.map(([s,i])=>`<div class="card">${groupChip(s.group)}
    <h3>${esc(s.title)}</h3><p>${s.year?esc(s.year)+"年 ・ ":""}${esc(s.type||"")}${s.center?`<br>センター：${esc(s.center)}`:""}</p>
    <p><button data-open="${i}">フォーメーション・詳細</button></p></div>`).join("")
    || `<div class="empty">条件に合う楽曲がありません。</div>`;
  document.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>openSong(+b.dataset.open)));
}
function openSong(i){
  const s=DATA[i]; if(!s) return;
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
    const all=f.rows.flat();
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
  document.getElementById("dlgBody").innerHTML=html;
  dlg.showModal();
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
