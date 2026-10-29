// マイセットリスト：localStorage保存・並び替え・テキスト出力・曲名隠し
let SONGS=[], mine=[];
try{ mine=JSON.parse(localStorage.getItem("sb-setlist")||"[]"); }catch(e){ mine=[]; }
async function init(){
  SONGS=await loadJSON("songs.json");
  ["q","group"].forEach(id=>document.getElementById(id).addEventListener("input",renderSongs));
  document.getElementById("addMC").addEventListener("click",()=>add({kind:"marker",label:"― MC ―"}));
  document.getElementById("addEncore").addEventListener("click",()=>add({kind:"marker",label:"― アンコール ―"}));
  document.getElementById("addOverture").addEventListener("click",()=>add({kind:"marker",label:"OVERTURE"}));
  document.getElementById("hideTitles").addEventListener("change",renderMine);
  document.getElementById("title").addEventListener("input",renderMine);
  document.getElementById("clear").addEventListener("click",()=>{mine=[];save();renderMine();});
  document.getElementById("copy").addEventListener("click",copyText);
  renderSongs(); renderMine();
}
function save(){ localStorage.setItem("sb-setlist", JSON.stringify(mine)); }
function add(item){ mine.push(item); save(); renderMine(); }
function renderSongs(){
  const q=document.getElementById("q").value, g=document.getElementById("group").value;
  const rows=SONGS.filter(s=>(!g||s.group===g)&&includesAll(itemText([s.title,s.center,s.group]),q)).slice(0,24);
  document.getElementById("songs").innerHTML=rows.map((s,i)=>`<div class="card">${groupChip(s.group)}<h3>${esc(s.title)}</h3>
    <p>${esc(s.year)}年 ・ センター：${esc(s.center)}</p><button data-add="${esc(s.title)}">＋ 追加</button></div>`).join("");
  document.querySelectorAll("[data-add]").forEach(b=>b.addEventListener("click",()=>{
    const s=SONGS.find(x=>x.title===b.dataset.add); if(s) add({kind:"song",title:s.title,group:s.group,center:s.center});
  }));
}
function renderMine(){
  const hide=document.getElementById("hideTitles").checked;
  let n=0;
  document.getElementById("mine").innerHTML= mine.length ? mine.map((it,i)=>{
    const label = it.kind==="song" ? `${++n}. ${hide?"？？？":esc(it.title)}（${esc(it.group)}／C:${esc(it.center)}）` : esc(it.label);
    return `<div class="card" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;padding:10px 14px"><span style="flex:1">${label}</span>
    <button class="sub" data-up="${i}">↑</button><button class="sub" data-down="${i}">↓</button><button class="sub" data-del="${i}">削除</button></div>`;
  }).join("") : `<div class="empty">まだ曲がありません。上の検索から追加してください。</div>`;
  document.getElementById("n").textContent=mine.filter(x=>x.kind==="song").length;
  const bind=(attr,fn)=>document.querySelectorAll(`[${attr}]`).forEach(b=>b.addEventListener("click",()=>fn(+b.getAttribute(attr))));
  bind("data-up",i=>{ if(i>0){[mine[i-1],mine[i]]=[mine[i],mine[i-1]]; save(); renderMine();}});
  bind("data-down",i=>{ if(i<mine.length-1){[mine[i+1],mine[i]]=[mine[i],mine[i+1]]; save(); renderMine();}});
  bind("data-del",i=>{ mine.splice(i,1); save(); renderMine(); });
}
function copyText(){
  const name=document.getElementById("title").value||"マイセットリスト";
  let n=0;
  const text=name+"\n\n"+mine.map(it=> it.kind==="song" ? `${++n}. ${it.title}` : it.label).join("\n");
  document.getElementById("out").value=text;
  if(navigator.clipboard) navigator.clipboard.writeText(text);
}
init();
