let DATA=[]; const DETAILS={};
let INDEX=null; const SEXTRA={}; // 曲名・メンバー検索の索引（あとから読み込む）
function memberMatch(l, name, role){
  const e=INDEX && INDEX[l.id]; if(!e) return false;
  if(role==="center") return (e.c||[]).includes(name);
  if(role==="perf") return (e.p||[]).includes(name);
  return (e.c||[]).includes(name) || (e.p||[]).includes(name);
}
function buildMemberOptions(roster){
  const sel=document.getElementById("member");
  const inIndex=new Set();
  Object.values(INDEX).forEach(v=>{ (v.c||[]).forEach(n=>inIndex.add(n)); (v.p||[]).forEach(n=>inIndex.add(n)); });
  const byGroup={};
  roster.forEach(m=>{ if(inIndex.has(m.name)){ (byGroup[m.group] ||= []).push(m.name); inIndex.delete(m.name); } });
  const addOpts=(label,names)=>{
    if(!names.length) return;
    const og=document.createElement("optgroup"); og.label=label;
    names.forEach(n=>{ const o=document.createElement("option"); o.value=n; o.textContent=n; og.appendChild(o); });
    sel.appendChild(og);
  };
  ["乃木坂46","櫻坂46","日向坂46","欅坂46","けやき坂46"].forEach(g=>addOpts(g, byGroup[g]||[]));
  addOpts("その他", [...inIndex].sort());
}
const KINDS=[
  {label:"全国ツアー", tag:"全国ツアー"},
  {label:"真夏の全国ツアー", tag:"真夏の全国ツアー"},
  {label:"アンダーライブ", tag:"アンダーライブ"},
  {label:"BIRTHDAY LIVE", tag:"BIRTHDAY LIVE"},
  {label:"ANNIVERSARY LIVE", tag:"ANNIVERSARY LIVE"},
  {label:"BACKS LIVE!!", tag:"BACKS LIVE!!"},
  {label:"ひなた坂46LIVE", tag:"ひなた坂46LIVE"},
  {label:"ひな誕祭", tag:"ひな誕祭"},
  {label:"欅共和国／W-KEYAKI FES", match:l=>(l.tags||[]).includes("欅共和国/W-K FES.")||/欅共和国|W-KEYAKI FES/.test(l.title)},
  {label:"がなくり・ひなくり", tag:"がなくり/ひなくり"},
  {label:"合同公演", match:l=>((l.tags||[]).includes("合同公演")||JOINT_IDS.has(l.id))&&!/欅共和国|W-KEYAKI FES/.test(l.title)},
  {label:"外部のイベント", tag:"外部のイベント"},
  {label:"ミニライブなど", tag:"ミニライブなど"},
  {label:"単独主催公演（その他）", tag:null},
];
const KSEL=new Set();
const GSEL=new Set();
const GROUP_LIST=["乃木坂46","櫻坂46","日向坂46","欅坂46","けやき坂46"];
let JOINT_IDS=new Set();
// 同じ日・同じ公演名で複数グループの記録がある公演は「合同」とみなす
// （例：欅坂46の握手会ミニライブやツアーに、けやき坂46・日向坂46が出演した回）。
// 対象は欅坂46/櫻坂46 × けやき坂46/日向坂46 の組み合わせに限る（外部フェスの共演は含めない）。
function computeJointIds(){
  const GROUPS=["乃木坂46","櫻坂46","日向坂46","欅坂46","けやき坂46"];
  const keyOf=l=>{
    let t=l.title, changed=true;
    while(changed){ changed=false;
      for(const g of GROUPS){ if(t.startsWith(g)){ t=t.slice(g.length).trim(); changed=true; } } }
    return l.date+"|"+t;
  };
  const byKey={};
  DATA.forEach(l=>{ (byKey[keyOf(l)] ||= []).push(l); });
  const out=new Set();
  Object.values(byKey).forEach(list=>{
    if(list.some(x=>(x.tags||[]).includes("外部のイベント"))) return; // 外部フェスの共演は合同に含めない
    const gs=new Set(list.map(x=>x.group));
    if(gs.size<2) return;
    const hasKanji=[...gs].some(g=>g==="欅坂46"||g==="櫻坂46");
    const hasHira=[...gs].some(g=>g==="けやき坂46"||g==="日向坂46");
    if(hasKanji&&hasHira) list.forEach(x=>out.add(x.id));
  });
  return out;
}
function kindMatch(l, kind){
  if(kind.match) return kind.match(l);
  const ts=l.tags||[];
  if(kind.tag===null) return ts.length===1 && ts[0]==="単独主催公演";
  return ts.includes(kind.tag) || ts.some(t=>String(t).split("/").includes(kind.tag));
}
async function init(){
  DATA = await loadJSON("lives.json");
  JOINT_IDS = computeJointIds();
  const years=[...new Set(DATA.map(l=>l.date.slice(0,4)))].sort().reverse();
  const sel=document.getElementById("year");
  years.forEach(y=>{const o=document.createElement("option");o.textContent=y+"年";o.value=y;sel.appendChild(o);});
  const gc=document.getElementById("groupChips");
  const syncGroupChips=()=>{
    gc.querySelectorAll(".gchip").forEach(b=>{
      const g=b.dataset.g;
      b.classList.toggle("on", g==="" ? GSEL.size===0 : GSEL.has(g));
    });
  };
  [["", "すべてのグループ"], ...GROUP_LIST.map(g=>[g,g])].forEach(([g,label])=>{
    const b=document.createElement("button");
    b.type="button"; b.className="ychip gchip"; b.dataset.g=g; b.textContent=label;
    b.addEventListener("click",()=>{
      if(g==="") GSEL.clear();
      else if(GSEL.has(g)) GSEL.delete(g);
      else GSEL.add(g);
      syncGroupChips();
      render();
    });
    gc.appendChild(b);
  });
  syncGroupChips();
  const kt=document.getElementById("kindTabs");
  KINDS.forEach(k=>{
    const b=document.createElement("button");
    b.type="button"; b.className="ychip"; b.textContent=k.label;
    b.addEventListener("click",()=>{
      if(KSEL.has(k.label)){ KSEL.delete(k.label); b.classList.remove("on"); }
      else{ KSEL.add(k.label); b.classList.add("on"); }
      render();
    });
    kt.appendChild(b);
  });
  const regionSel=document.getElementById("region");
  const regionCount={};
  DATA.forEach(l=>{ const r=l.region||""; if(r) regionCount[r]=(regionCount[r]||0)+1; });
  Object.keys(regionCount).sort((a,b)=>regionCount[b]-regionCount[a]).forEach(r=>{
    const o=document.createElement("option"); o.value=r; o.textContent=r; regionSel.appendChild(o);
  });
  const advToggle=document.getElementById("advToggle"), advPanel=document.getElementById("advPanel");
  advToggle.addEventListener("click",()=>{
    const open=advPanel.hidden;
    advPanel.hidden=!open;
    advToggle.setAttribute("aria-expanded", String(open));
    render();
  });
  document.getElementById("advClear").addEventListener("click",()=>{
    KSEL.clear();
    kt.querySelectorAll(".ychip.on").forEach(b=>b.classList.remove("on"));
    document.getElementById("sort").value="auto";
    regionSel.value="";
    document.getElementById("member").value="";
    document.getElementById("role").value="any";
    document.getElementById("from").value="";
    document.getElementById("to").value="";
    render();
  });
  ["q","year","sort","region","from","to","member","role"].forEach(id=>document.getElementById(id).addEventListener("input",render));
  render();
  // 曲名・メンバー検索の索引は裏で読み込み、届いたら絞り込みに反映する
  loadJSON("live-index.json").then(async idx=>{
    if(!idx || Array.isArray(idx)) return;
    INDEX=idx;
    for(const [id,v] of Object.entries(idx)) SEXTRA[id]=(v.s||[]).join(" ");
    const members=await loadJSON("members.json");
    buildMemberOptions(Array.isArray(members)?members:[]);
    render();
  }).catch(()=>{});
}
function render(){
  const q=document.getElementById("q").value, y=document.getElementById("year").value;
  document.body.dataset.group = GSEL.size===1 ? [...GSEL][0] : "";
  const srt=document.getElementById("sort").value, region=document.getElementById("region").value;
  const from=document.getElementById("from").value, to=document.getElementById("to").value;
  const member=document.getElementById("member").value, role=document.getElementById("role").value;
  const advToggle=document.getElementById("advToggle"), advPanel=document.getElementById("advPanel");
  const advActive=!!(KSEL.size || region || from || to || srt!=="auto" || member);
  advToggle.textContent=`詳細設定 ${advPanel.hidden?"▼":"▲"}${advActive?"（設定中）":""}`;
  const rows=DATA.filter(l=>(!GSEL.size||GSEL.has(l.group))&&(!y||l.date.startsWith(y))
    &&(!region||l.region===region)&&(!from||l.date>=from)&&(!to||l.date<=to)
    &&(!member || memberMatch(l, member, role))
    &&(!KSEL.size || KINDS.some(k=>KSEL.has(k.label)&&kindMatch(l,k)))
    &&includesAll(itemText([l.title,l.group,l.venue,l.region,l.date,l.tags,SEXTRA[l.id]||""]),q))
    .sort((a,b)=>{
      if(srt==="songs") return (b.songCount-a.songCount) || b.date.localeCompare(a.date);
      const key=x=>[x.date||"", x.time||"", x.id||""];
      const ka=key(a), kb=key(b);
      for(let i=0;i<3;i++){ const c=ka[i].localeCompare(kb[i]); if(c) return (srt==="new"||(srt==="auto"&&!y)) ? -c : c; }
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
  const sb0=document.getElementById("saveSetlistImg"); if(sb0) sb0.hidden=true;
  const sm0=document.getElementById("saveImgMsg"); if(sm0) sm0.textContent="";
  document.getElementById("dlg").showModal();
  if(!DETAILS[id]){
    try{ const r=await fetch(BASE+"data/shows/"+id+".json"); DETAILS[id]= r.ok ? await r.json() : {setlist:[]}; }
    catch(e){ DETAILS[id]={setlist:[]}; }
  }
  const d=DETAILS[id];
  let html=`${groupChip(l.group)}<h3>${esc(l.title)}</h3>
    <p>${esc(l.date)}${l.time?` ${esc(l.time)}開演`:""} ・ ${esc(l.venue)}${l.region?`（${esc(l.region)}）`:""}</p>`;
  if(d.note) html+=`<p style="white-space:pre-line">${esc(d.note)}</p>`;
  let segs=[];
  if(d.setlist && d.setlist.length){
    for(const s of d.setlist){
      if(!segs.length || segs[segs.length-1].sec!==s.sec) segs.push({sec:s.sec, items:[]});
      segs[segs.length-1].items.push(s);
    }
    html+=segs.map(seg=>`<h4 style="margin:16px 0 4px">${SECNAME[seg.sec]||"本編"}</h4><div class="setlist">${seg.items.map((s,i)=>
      `<div class="srow"><span class="sno">${i+1}</span><div class="smain"><div class="stitle">${esc(s.title)}</div>${s.remark?`<div class="sremark">${esc(s.remark)}</div>`:""}</div>${(s.center||s.perf)?`<div class="scredits">${s.center?`<div class="sc-center">センター：${esc(s.center)}</div>`:""}${s.perf?`<div>参加：${esc(s.perf.join("、"))}</div>`:""}</div>`:""}</div>`).join("")}</div>`).join("");
  } else {
    html+=`<p>セットリストはまだ登録されていません。</p>`;
  }
  if(d.ref) html+=`<p style="font-size:13px"><a href="${esc(d.ref)}" target="_blank" rel="noopener">出典・参考ページ</a></p>`;
  body.innerHTML=html;
  // 名前（クレジット）が右カラムで3行を超える行は、読みやすいよう曲名の下に回す（旧サイトの画像出力と同じ考え方）
  body.querySelectorAll(".srow").forEach(row=>{
    const cr=row.querySelector(".scredits");
    if(cr && cr.offsetHeight>66) row.classList.add("stacked");
  });
  const saveBtn=document.getElementById("saveSetlistImg");
  if(saveBtn){
    saveBtn.hidden=!(segs&&segs.length);
    // 画像はダイアログを開いた時点で先に作っておく（共有シートをすぐ開けるように）
    let blobPromise=null;
    if(segs&&segs.length){
      // 出力画像は旧サイト式：番号は M01/EN1/WEN1、区切りはアンコールのみ帯表示、
      // 全員で歌う曲は名前を並べず「（全員参加）」と表記する
      const rows=[];
      const cnt={main:0,encore:0,double:0};
      let prevSec=null;
      for(const seg of segs){
        for(const s of seg.items){
          if(s.sec!==prevSec){
            if(s.sec==="encore") rows.push({type:"event", text:"アンコール"});
            else if(s.sec==="double") rows.push({type:"event", text:"Wアンコール"});
            prevSec=s.sec;
          }
          cnt[s.sec]=(cnt[s.sec]||0)+1;
          const num=s.sec==="main" ? "M"+String(cnt.main).padStart(2,"0")
            : s.sec==="encore" ? "EN"+cnt.encore : "WEN"+cnt.double;
          const clauses=(s.remark||"").split("、").map(x=>x.trim()).filter(Boolean);
          const zenin=clauses.some(c=>/^全員(歌唱|バージョン)?$/.test(c));
          let memberText=(s.perf||[]).length ? "参加："+s.perf.join("、") : "";
          let meta=clauses;
          if(zenin){
            memberText="参加：全員";
            meta=clauses.filter(c=>!/^全員(歌唱|バージョン)?$/.test(c));
          }
          rows.push({type:"song", number:num, title:s.title, center:s.center||"",
            members:{full:memberText}, meta:meta.length?[meta.join("、")]:[]});
        }
      }
      const header={title:l.title, date:`${l.date}${l.time?` ${l.time}開演`:""}`, venue:l.venue};
      blobPromise=window.SakamichiSetlistImageExport.create(rows, header, {mode:"full"})
        .then(r=>r.blob).catch(()=>null);
    }
    saveBtn.onclick=async ()=>{
    const msg=document.getElementById("saveImgMsg");
    saveBtn.disabled=true; if(msg) msg.textContent="画像を作っています…";
    try{
      const blob=await blobPromise;
      if(!blob) throw new Error("no blob");
      const filename=`${l.id}.png`;
      // iPhone/iPadでは共有シートから「画像を保存」で写真に入れられる。それ以外はダウンロード。
      let shared=false;
      try{
        const file=new File([blob], filename, {type:"image/png"});
        if(navigator.canShare && navigator.canShare({files:[file]})){
          await navigator.share({files:[file]});
          shared=true;
        }
      }catch(e){
        if(e && e.name==="AbortError"){ shared=true; } // ユーザーが共有を閉じただけ
      }
      if(shared){ if(msg) msg.textContent=""; }
      else{
        window.SakamichiSetlistImageExport.download(blob, filename);
        if(msg) msg.textContent="画像を保存しました。";
      }
    }catch(e){
      if(msg) msg.textContent="画像を作れませんでした。";
    }finally{ saveBtn.disabled=false; }
    };
  }
}
init();
