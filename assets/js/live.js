let DATA=[]; const DETAILS={};
async function init(){
  DATA = await loadJSON("lives.json");
  const years=[...new Set(DATA.map(l=>l.date.slice(0,4)))].sort().reverse();
  const sel=document.getElementById("year");
  years.forEach(y=>{const o=document.createElement("option");o.textContent=y+"年";o.value=y;sel.appendChild(o);});
  ["q","group","year"].forEach(id=>document.getElementById(id).addEventListener("input",render));
  render();
}
function render(){
  const q=document.getElementById("q").value, g=document.getElementById("group").value, y=document.getElementById("year").value;
  const rows=DATA.filter(l=>(!g||l.group===g)&&(!y||l.date.startsWith(y))&&includesAll(itemText([l.title,l.group,l.venue,l.region,l.date,l.tags]),q))
    .sort((a,b)=>{
      const key=x=>[x.date||"", x.time||"", x.id||""];
      const ka=key(a), kb=key(b);
      for(let i=0;i<3;i++){ const c=ka[i].localeCompare(kb[i]); if(c) return y ? c : -c; }
      return 0;
    });
  document.getElementById("count").textContent=`${rows.length}件の公演`;
  document.getElementById("list").innerHTML= rows.map(l=>`<div class="card">${groupChip(l.group)}<h3>${esc(l.title)}</h3>
    <p>${esc(l.date)}${l.time?` ${esc(l.time)}開演`:""}<br>${esc(l.venue)}${l.region?`（${esc(l.region)}）`:""}</p>${tags(l.tags)}
    <p><button data-open="${esc(l.id)}">セットリストを見る（${esc(l.songCount)}曲）</button></p></div>`).join("")
    || `<div class="empty">条件に合う公演がありません。</div>`;
  document.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>openLive(b.dataset.open)));
}
const SECNAME={main:"本編",encore:"アンコール",double:"ダブルアンコール"};
async function openLive(id){
  const l=DATA.find(x=>x.id===id); if(!l) return;
  const body=document.getElementById("dlgBody");
  body.innerHTML=`${groupChip(l.group)}<h3>${esc(l.title)}</h3><p>${esc(l.date)}${l.time?` ${esc(l.time)}開演`:""} ・ ${esc(l.venue)}</p><p>セットリストを読み込んでいます…</p>`;
  document.getElementById("dlg").showModal();
  if(!DETAILS[id]){
    try{ const r=await fetch(BASE+"data/shows/"+id+".json"); DETAILS[id]= r.ok ? await r.json() : {setlist:[]}; }
    catch(e){ DETAILS[id]={setlist:[]}; }
  }
  const d=DETAILS[id];
  let html=`${groupChip(l.group)}<h3>${esc(l.title)}</h3>
    <p>${esc(l.date)}${l.time?` ${esc(l.time)}開演`:""} ・ ${esc(l.venue)}${l.region?`（${esc(l.region)}）`:""}</p>`;
  if(d.note) html+=`<p style="white-space:pre-line">${esc(d.note)}</p>`;
  if(d.setlist && d.setlist.length){
    const segs=[];
    for(const s of d.setlist){
      if(!segs.length || segs[segs.length-1].sec!==s.sec) segs.push({sec:s.sec, items:[]});
      segs[segs.length-1].items.push(s);
    }
    html+=segs.map(seg=>`<h4 style="margin:16px 0 4px">${SECNAME[seg.sec]||"本編"}</h4><ol class="setlist">${seg.items.map(s=>
      `<li>${esc(s.title)}${s.center?` <span class="tag">センター：${esc(s.center)}</span>`:""}${s.perf?` <span style="color:var(--muted);font-size:12px">出演：${esc(s.perf.join("、"))}</span>`:""}${s.remark?` <span style="color:var(--muted);font-size:12px">${esc(s.remark)}</span>`:""}</li>`).join("")}</ol>`).join("");
  } else {
    html+=`<p>セットリストはまだ登録されていません。</p>`;
  }
  if(d.ref) html+=`<p style="font-size:13px"><a href="${esc(d.ref)}" target="_blank" rel="noopener">出典・参考ページ</a></p>`;
  body.innerHTML=html;
}
init();
