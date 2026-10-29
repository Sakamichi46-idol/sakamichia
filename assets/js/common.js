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

// グループ絞り込みに連動して、ページの差し色をそのグループの色に切り替える
document.addEventListener("DOMContentLoaded",()=>{
  const sel=document.getElementById("group");
  if(!sel) return;
  const apply=()=>{document.body.dataset.group=sel.value||"";};
  sel.addEventListener("input",apply);
  sel.addEventListener("change",apply);
  apply();
});
