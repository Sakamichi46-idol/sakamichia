let DATA=[]; let FORMS={}; let MEMB={}; const SEL=new Set(); const YSEL=new Set(); const TSEL=new Set(); const NSEL=new Set();
let yearMS=null, typeMS=null, countMS=null;   // 年・曲種・人数の複数選択プルダウン（値は文字列で保持）
let CBUCKET=[];   // 曲ごとの人数バケット（キー）。参加メンバー不明の曲は ""（人数フィルター時は対象外）
// 人数の数え方は participantsOf と同じ（rows の配置、無ければ vocal、重複は除く）。
// バケットは 10人まで人数そのまま、11〜15人／16〜20人は範囲にまとめ、21人以上は1つにする
// （21人以上は人数ごとの曲数が1〜3曲とばらけるため。実データの分布に基づく）
function countBucket(n){
  if(n<=0) return "";
  if(n<=10) return String(n);
  if(n<=15) return "11-15";
  if(n<=20) return "16-20";
  return "21+";
}
function countLabel(key){
  if(key==="1") return "1人（ソロ）";
  if(key==="11-15") return "11〜15人";
  if(key==="16-20") return "16〜20人";
  if(key==="21+") return "21人以上";
  return key+"人";
}
// ディープリンク（?member=<名前>）専用の参加曲絞り込み。参加の根拠は詳細ダイアログの
// 「参加メンバー／歌唱メンバー」と同じく formations の rows（配置）／vocal（歌唱）とする
let MFILTER=""; let PARTS=[];
function participantsOf(s){
  const f=FORMS[`${s.group}|${s.title}`];
  if(!f) return [];
  if(f.rows&&f.rows.length) return f.rows.flat();
  if(f.vocal&&f.vocal.length) return f.vocal;
  if(f.mv&&f.mv.length) return f.mv;   // 「その他」のMV出演曲：メンバー検索（?member=）の対象にする
  return [];
}
// グループ・年・曲種・人数の選択状態表示と「条件をリセット」ボタンの表示をまとめて同期する
function syncTabs(){
  document.querySelectorAll("#groupTabs button").forEach(x=>{
    const on = x.dataset.g==="" ? SEL.size===0 : SEL.has(x.dataset.g);
    x.classList.toggle("on", on);
    x.setAttribute("aria-pressed", on ? "true" : "false");
  });
  if(yearMS) yearMS.refresh();
  if(typeMS) typeMS.refresh();
  if(countMS) countMS.refresh();
  // 「条件をリセット」はチップだけでなく検索・並び替えも含めて初期状態と異なる間だけ出す
  const clr=document.getElementById("clearSel");
  if(clr){
    const qEl=document.getElementById("q"), sEl=document.getElementById("sort");
    clr.hidden = !(SEL.size||YSEL.size||TSEL.size||NSEL.size||MFILTER||(qEl&&qEl.value)||(sEl&&sEl.value!=="old"));
  }
}
async function init(){
  let members=[];
  [DATA, FORMS, members]=await Promise.all([loadJSON("songs.json"), loadJSON("formations.json"), loadJSON("members.json")]);
  MEMB={}; (members||[]).forEach(m=>{ MEMB[m.name]=m; });
  PARTS=DATA.map(s=>new Set(participantsOf(s)));
  // 「その他」（外部楽曲）は坂道側だけの人数になるため、人数フィルターの対象外にする（""＝不明扱い）
  CBUCKET=DATA.map((s,i)=>s.group==="その他" ? "" : countBucket(PARTS[i].size));
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
  // 人数の複数選択プルダウン（選択同士は OR）。選択肢はデータに実在するバケットだけを人数順に作る
  const bucketOrder=["1","2","3","4","5","6","7","8","9","10","11-15","16-20","21+"];
  const present=new Set(CBUCKET.filter(Boolean));
  countMS=createMultiSelect(document.getElementById("countMS"),{
    allLabel:"すべての人数", selected:NSEL, ariaLabel:"人数",
    options:bucketOrder.filter(k=>present.has(k)).map(k=>({value:k, label:countLabel(k)})),
    onChange:()=>{ syncTabs(); render(); }
  });
  // 条件をリセット：チップ（グループ・年・曲種・人数）・検索・並び替えをすべて初期状態に戻す
  document.getElementById("clearSel").addEventListener("click",()=>{
    SEL.clear(); YSEL.clear(); TSEL.clear(); NSEL.clear(); MFILTER="";
    document.body.dataset.group="";
    document.getElementById("q").value="";
    document.getElementById("sort").value="old";
    syncTabs();
    render();
  });
  ["q","sort"].forEach(id=>document.getElementById(id).addEventListener("input",()=>{ syncTabs(); render(); }));
  // 検索サジェスト：曲名・読み、メンバー名、「その他」のアーティスト名から候補を出す
  attachSuggest(document.getElementById("q"), q=>{
    const hits=t=>kanaNorm(String(t||"").toLowerCase()).includes(kanaNorm(q.toLowerCase()));
    const items=[];
    DATA.filter(s=>hits(s.title)||hits(s.yomi)).slice(0,4).forEach(s=>items.push({kind:"楽曲", cls:"song", label:s.title, sub:[s.group, s.year?s.year+"年":""].filter(Boolean).join(" ・ ")}));
    Object.values(MEMB).filter(m=>hits(m.name)||hits(m.reading)).slice(0,3).forEach(m=>items.push({kind:"メンバー", cls:"member", label:m.name, sub:m.group||""}));
    [...new Set(DATA.filter(s=>s.artist&&hits(s.artist)).map(s=>s.artist))].slice(0,2).forEach(a=>items.push({kind:"アーティスト", cls:"live", label:a, sub:"その他"}));
    return items;
  }, (it,input)=>{ input.value=it.label; input.dispatchEvent(new Event("input",{bubbles:true})); input.focus(); });
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
// 「その他」のカードには、誰が参加・出演したかが一目で分かるようメンバーを出す。
// 3名までは全員、4名以上は先頭3名＋「ほか（全N名）」（全員は詳細で表示する）
function cardMembers(s,i){
  if(s.group!=="その他") return "";
  const names=sortedParticipants([...(PARTS[i]||[])]);
  if(!names.length) return "";
  const label=s.type==="MV出演" ? "出演" : "参加";
  const txt=names.length<=3 ? names.join("、") : `${names.slice(0,3).join("、")} ほか（全${names.length}名）`;
  return `<br>${label}：${esc(txt)}`;
}
function render(){
  const q=document.getElementById("q").value, sort=document.getElementById("sort").value;
  let rows=DATA.map((s,i)=>[s,i]).filter(([s],i)=>matchG(s)&&(YSEL.size===0||YSEL.has(String(s.year)))&&(TSEL.size===0||TSEL.has(s.type||""))&&(NSEL.size===0||NSEL.has(CBUCKET[i]))&&(!MFILTER||(PARTS[i]&&PARTS[i].has(MFILTER)))&&includesAll(itemText([s.title,s.yomi,s.center,s.group,s.year,s.special,s.artist,s.group==="その他"?[...PARTS[i]]:[]]),q));
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
    <h3>${esc(s.title)}</h3><p>${s.year?esc(s.year)+"年 ・ ":""}${esc(s.type||"")}${s.artist?`<br>${esc(s.artist)}`:""}${cardMembers(s,i)}${s.center?`<br>センター：${esc(s.center)}`:""}</p>
    <p><a class="btn" href="${String(s.id).toLowerCase()}/">${s.group==="その他"?"詳細":"フォーメーション・詳細"}</a></p></div>`).join("")
    || `<div class="empty">条件に合う楽曲がありません。</div>`;
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

init();
