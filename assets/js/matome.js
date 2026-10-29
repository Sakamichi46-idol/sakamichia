let DATA=[];
async function init(){
  DATA=await loadJSON("matome.json");
  const progs=[...new Set(DATA.map(m=>m.program))];
  const sel=document.getElementById("program");
  progs.forEach(p=>{const o=document.createElement("option");o.textContent=p;sel.appendChild(o);});
  ["q","group","program"].forEach(id=>document.getElementById(id).addEventListener("input",render));
  render();
}
function render(){
  const q=document.getElementById("q").value, g=document.getElementById("group").value, p=document.getElementById("program").value;
  const rows=DATA.filter(m=>(!g||m.group===g)&&(!p||m.program===p)&&includesAll(itemText([m.title,m.group,m.program,m.summary,m.members,m.tags,m.date]),q))
    .sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById("count").textContent=`${rows.length}件のまとめ`;
  document.getElementById("list").innerHTML=rows.map(m=>`<div class="card">${groupChip(m.group)}<span class="tag">${esc(m.program)}</span>
    <h3>${esc(m.title)}</h3><p>${esc(m.date)}</p><p>${esc(m.summary)}</p>${tags(m.tags)}
    <p><a class="btn sub" href="${esc(m.sourceUrl)}" target="_blank" rel="noopener">公式サイトを見る</a></p></div>`).join("")
    || `<div class="empty">条件に合うまとめがありません。</div>`;
}
init();
