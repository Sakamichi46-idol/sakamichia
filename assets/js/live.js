let DATA=[]; const DETAILS={};
let INDEX=null; const SEXTRA={}; // 曲名・メンバー検索の索引（あとから読み込む）
// 日付欄はテキスト入力（枠の中に「年/月/日」と表示）。読み取り時は ISO 形式に直す。
function parseDateText(v){
  const d=String(v||"").replace(/[^\d]/g,"");
  if(d.length!==8) return "";
  const mo=+d.slice(4,6), da=+d.slice(6,8);
  if(mo<1||mo>12||da<1||da>31) return "";
  return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
}
function dateVal(id){ return parseDateText(document.getElementById(id).value); }
function fmtDateText(iso){ return iso ? iso.replace(/-/g,"/") : ""; }
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
// マイ参戦記録：公演 id → 状態（"venue"=現地で参戦 / "stream"=配信で見た）を端末内に保存する。
// 旧形式（参戦した公演 id の配列）で保存されている場合は、全て "venue" として読み込む（移行は読み込み時に透過的に行う）。
const ATTEND_KEY="sakamichia-attended";
const ATTENDED=new Map();
const attendFilter=new Set(); // 絞り込みで選ばれている状態（"venue" / "stream"）。空なら絞り込まない
function loadAttended(){
  ATTENDED.clear();
  try{
    const v=JSON.parse(localStorage.getItem(ATTEND_KEY)||"null");
    if(Array.isArray(v)){
      v.forEach(x=>{ if(typeof x==="string" && x) ATTENDED.set(x, "venue"); });
    }else if(v && typeof v==="object"){
      Object.entries(v).forEach(([id, st])=>{ if(id) ATTENDED.set(id, st==="stream" ? "stream" : "venue"); });
    }
  }catch(e){}
}
function saveAttended(){
  try{
    const o={};
    ATTENDED.forEach((st, id)=>{ o[id]=st; });
    localStorage.setItem(ATTEND_KEY, JSON.stringify(o));
  }catch(e){}
}
function attendedShows(){ return DATA.filter(l=>ATTENDED.has(l.id)); }
function attendCounts(shows){
  let v=0, s=0;
  shows.forEach(l=>{ if(ATTENDED.get(l.id)==="stream") s++; else v++; });
  return {v, s};
}
// 内訳 {v, s} → 「参戦3・配信2」のような表記（0 の側は省略）
function attendParts(c){
  return [c.v?`参戦${c.v}`:"", c.s?`配信${c.s}`:""].filter(Boolean).join("・");
}
function renderAttend(){
  const sum=document.getElementById("attendSum"), share=document.getElementById("attendShare");
  if(!sum) return;
  const shows=attendedShows();
  if(share) share.hidden=!shows.length;
  if(!shows.length){
    sum.textContent="まだ記録がありません。各公演の詳細から「参戦した」「配信で見た」を選ぶと記録できます。";
    return;
  }
  const {v, s}=attendCounts(shows);
  const byG={}, byY={};
  shows.forEach(l=>{
    const k=ATTENDED.get(l.id)==="stream" ? "s" : "v";
    (byG[l.group] ||= {v:0, s:0})[k]++;
    const y=l.date.slice(0,4);
    (byY[y] ||= {v:0, s:0})[k]++;
  });
  const gtxt=GROUP_LIST.filter(g=>byG[g]).map(g=>`${g} ${attendParts(byG[g])}件`).join(" ・ ");
  const ytxt=Object.keys(byY).sort().reverse().map(y=>`${y}年 ${attendParts(byY[y])}件`).join(" ・ ");
  sum.innerHTML=`これまで <strong>参戦 ${v}公演</strong> ・ <strong>配信 ${s}公演</strong> を記録<br>${esc(gtxt)}<br>${esc(ytxt)}`;
}
function syncAttendCtl(id){
  const ctl=document.getElementById("attendCtl"); if(!ctl) return;
  const cur=ATTENDED.get(id)||"";
  ctl.querySelectorAll("button").forEach(b=>{
    const on=b.dataset.attend===cur;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
}
function setAttend(id, state){
  if(state) ATTENDED.set(id, state); else ATTENDED.delete(id);
  saveAttended();
  syncAttendCtl(id);
  renderAttend();
  render();
}
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
  loadAttended();
  const bindAttendChip=(el, state)=>{
    if(!el) return;
    el.addEventListener("click",()=>{
      if(attendFilter.has(state)) attendFilter.delete(state); else attendFilter.add(state);
      el.classList.toggle("on", attendFilter.has(state));
      el.setAttribute("aria-pressed", String(attendFilter.has(state)));
      render();
    });
  };
  bindAttendChip(document.getElementById("attendOnly"), "venue");
  bindAttendChip(document.getElementById("streamOnly"), "stream");
  const ash=document.getElementById("attendShare");
  if(ash) ash.addEventListener("click", shareAttendImage);
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
  // 条件をリセット：メインの絞り込み（キーワード・グループ・年）も含めてすべて初期状態に戻す
  // （参戦記録そのものは消さない。「参戦した公演だけ」「配信で見た公演だけ」の絞り込みだけを解除する）
  document.getElementById("resetAll").addEventListener("click",()=>{
    KSEL.clear();
    kt.querySelectorAll(".ychip.on").forEach(b=>b.classList.remove("on"));
    GSEL.clear();
    syncGroupChips();
    attendFilter.clear();
    ["attendOnly","streamOnly"].forEach(cid=>{
      const el=document.getElementById(cid);
      if(el){ el.classList.remove("on"); el.setAttribute("aria-pressed","false"); }
    });
    document.getElementById("q").value="";
    document.getElementById("year").value="";
    document.getElementById("sort").value="auto";
    regionSel.value="";
    document.getElementById("member").value="";
    document.getElementById("role").value="any";
    document.getElementById("from").value="";
    document.getElementById("to").value="";
    render();
  });
  renderAttend();
  ["q","year","sort","region","from","to","member","role"].forEach(id=>document.getElementById(id).addEventListener("input",render));
  ["from","to"].forEach(id=>document.getElementById(id).addEventListener("change",()=>{
    const el=document.getElementById(id), iso=parseDateText(el.value);
    if(iso) el.value=fmtDateText(iso);
  }));
  render();
  // ?show=<公演id> で該当公演の詳細を直接開く（楽曲詳細の「披露されたライブ」からの導線）
  const qShow=new URLSearchParams(location.search).get("show");
  if(qShow && DATA.some(l=>l.id===qShow)) openLive(qShow);
  // 曲名・メンバー検索の索引は裏で読み込み、届いたら絞り込みに反映する
  loadJSON("live-index.json").then(async idx=>{
    if(!idx || Array.isArray(idx)) return;
    INDEX=idx;
    for(const [id,v] of Object.entries(idx)) SEXTRA[id]=(v.s||[]).join(" ");
    const members=await loadJSON("members.json");
    buildMemberOptions(Array.isArray(members)?members:[]);
    const qMember=new URLSearchParams(location.search).get("member");
    if(qMember){
      const msel=document.getElementById("member");
      if([...msel.options].some(o=>o.value===qMember)) msel.value=qMember;
    }
    render();
  }).catch(()=>{});
  // 登録済みロゴはアイドル時間に先読みし、詳細を開いたときの画像生成を待たせない
  if(window.SakamichiSetlistImageExport){
    const warm=()=>window.SakamichiSetlistImageExport.preloadLogos("../assets/live-logos.json",
      DATA.map(l=>({id:l.id, group:l.id.split("-")[0], title:l.title})));
    if(window.requestIdleCallback) requestIdleCallback(warm, {timeout:4000});
    else setTimeout(warm, 2500);
  }
}
function render(){
  const q=document.getElementById("q").value, y=document.getElementById("year").value;
  document.body.dataset.group = GSEL.size===1 ? [...GSEL][0] : "";
  const srt=document.getElementById("sort").value, region=document.getElementById("region").value;
  const from=dateVal("from"), to=dateVal("to");
  const member=document.getElementById("member").value, role=document.getElementById("role").value;
  const advToggle=document.getElementById("advToggle"), advPanel=document.getElementById("advPanel");
  const advActive=!!(KSEL.size || region || from || to || srt!=="auto" || member);
  advToggle.textContent=`詳細設定 ${advPanel.hidden?"▼":"▲"}${advActive?"（設定中）":""}`;
  const rows=DATA.filter(l=>(!GSEL.size||GSEL.has(l.group))&&(!y||l.date.startsWith(y))
    &&(!attendFilter.size||attendFilter.has(ATTENDED.get(l.id)))
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
  document.getElementById("list").innerHTML= rows.map(l=>`<div class="card">${groupChip(l.group)}<h3>${esc(l.title)}${ATTENDED.get(l.id)==="venue"?`<span class="badge attend-badge">参戦済み</span>`:ATTENDED.get(l.id)==="stream"?`<span class="badge stream-badge">配信で見た</span>`:""}</h3>
    <p>${esc(l.date)}${l.time?` ${esc(l.time)}開演`:""}<br>${esc(l.venue)}${l.region?`（${esc(l.region)}）`:""}</p>${tags(l.tags)}
    <p><button data-open="${esc(l.id)}">セットリストを見る（${esc(l.songCount)}曲）</button></p></div>`).join("")
    || `<div class="empty">条件に合う公演がありません。</div>`;
  document.querySelectorAll("[data-open]").forEach(b=>b.addEventListener("click",()=>openLive(b.dataset.open)));
}
const SECNAME={main:"本編",encore:"アンコール",double:"ダブルアンコール"};
const blobCache=new Map(); // 生成済みのセトリ画像は公演ごとに保持し、開き直しを即時表示にする
async function openLive(id){
  const l=DATA.find(x=>x.id===id); if(!l) return;
  // ロゴ画像は詳細データの取得と並行して読み始める(待ちを重ねない)
  const logoPromise=window.SakamichiSetlistImageExport
    ? window.SakamichiSetlistImageExport.getLogo("../assets/live-logos.json", {id:l.id, group:l.id.split("-")[0], title:l.title})
    : Promise.resolve(null);
  const body=document.getElementById("dlgBody");
  body.innerHTML=`${groupChip(l.group)}<h3>${esc(l.title)}</h3><p>${esc(l.date)}${l.time?` ${esc(l.time)}開演`:""} ・ ${esc(l.venue)}</p><p>セットリストを読み込んでいます…</p>`;
  const eb0=document.getElementById("editInSetlist"); if(eb0) eb0.hidden=true;
  const ctl0=document.getElementById("attendCtl");
  if(ctl0){
    ctl0.hidden=false;
    ctl0.querySelectorAll("button").forEach(b=>{ b.onclick=()=>setAttend(id, b.dataset.attend||null); });
    syncAttendCtl(id);
  }
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
  const editBtn=document.getElementById("editInSetlist");
  if(editBtn){
    editBtn.hidden=!(segs&&segs.length);
    editBtn.onclick=()=>{
      // マイセットリストへは localStorage 経由で生のセトリを渡し、向こうで楽曲データと照合する
      const payload={name:l.title, liveId:l.id, date:l.date, venue:l.venue||"", group:l.group||"",
        rows:(d.setlist||[]).map(s=>({sec:s.sec||"main", title:s.title||"", center:s.center||"", perf:Array.isArray(s.perf)?s.perf:[], remark:s.remark||""}))};
      try{ localStorage.setItem("sakamichia-setlist-import", JSON.stringify(payload)); }catch(e){}
      location.href="../setlist/";
    };
  }
  // セトリ画像は表示と並行して生成し、できたらダイアログ下部にそのまま出す。
  // 保存は画像の長押し・右クリックで行う想定のため、専用の保存ボタンや
  // 「プレビュー」の見出しは置かない（ユーザーの指定）。
  const pvWrap=document.getElementById("imgPreviewWrap"), pvImg=document.getElementById("imgPreview");
  if(pvWrap) pvWrap.hidden=true;
  if(pvImg){
    if(pvImg.dataset.url){ URL.revokeObjectURL(pvImg.dataset.url); pvImg.dataset.url=""; }
    pvImg.removeAttribute("src");
    pvImg.style.opacity="0";
    pvImg.onload=null;
    pvImg.dataset.forId=l.id;
    pvImg.onclick=()=>{
      const f=document.getElementById("imgFullImg"), d=document.getElementById("imgFullDlg");
      if(f&&d&&pvImg.src){ f.src=pvImg.src; d.showModal(); }
    };
  }
  {
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
      // 公演ロゴが登録されている公演では、画像のヘッダーに実物のロゴを使う
      // （assets/live-logos.json）。登録側の mode が 'bg' のものはタイトル代わり
      // ではなく背景に薄く敷く。ロゴが無い・読めない場合はタイトル文字になる。
      const cachedBlob=blobCache.get(l.id);
      const blobPromise=cachedBlob ? Promise.resolve(cachedBlob)
        : logoPromise
          .then(logo=>window.SakamichiSetlistImageExport.create(rows, header, {mode:"full", logoImage:logo?logo.image:null, logoMode:logo?logo.mode:undefined}))
          .then(r=>{ const b=r&&r.blob; if(b) blobCache.set(l.id, b); return b; })
          .catch(()=>null);
      // 画像が完全に読み込めてからフェードインで出す。生成途中の状態や
      // 空の画像枠が一瞬映らないようにするため（ユーザーの指摘）。
      // 別の公演を開き直していた場合は、古い画像を出さない。
      blobPromise.then(blob=>{
        if(!blob||!pvWrap||!pvImg) return;
        if(pvImg.dataset.forId!==l.id) return;
        const url=URL.createObjectURL(blob);
        pvImg.dataset.url=url;
        pvImg.onload=()=>{ pvWrap.hidden=false; pvImg.style.opacity="1"; };
        pvImg.src=url;
      });
    }
  }
}
// 参戦記録のサマリー画像（960×1280、白地・インク色。サイトのデザインに合わせる）
const ATTEND_GCOLOR={"乃木坂46":"#7e57c2","櫻坂46":"#e77a9b","日向坂46":"#5aa9d6","欅坂46":"#5eba53","けやき坂46":"#a4c639"};
async function attendedImageBlob(){
  const shows=attendedShows().slice().sort((a,b)=>b.date.localeCompare(a.date)||String(b.time||"").localeCompare(String(a.time||""))||b.id.localeCompare(a.id));
  const W=960,H=1280,M=64,BOTTOM=H-56;
  const cv=document.createElement("canvas"); cv.width=W; cv.height=H;
  const ctx=cv.getContext("2d"); if(!ctx) throw new Error("Canvasを使用できません。");
  const FONT='"Hiragino Maru Gothic ProN","Hiragino Sans","Noto Sans JP",sans-serif';
  const INK="#2b2430", MUTED="#7a7080", LINE="#eadff0";
  ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,W,H);
  ctx.textBaseline="top";
  // ロゴの三色ドット
  ["#7e57c2","#e77a9b","#5aa9d6"].forEach((c,i)=>{ ctx.fillStyle=c; ctx.beginPath(); ctx.arc(M+13+i*42, M+13, 12, 0, Math.PI*2); ctx.fill(); });
  ctx.fillStyle=INK; ctx.font=`700 54px ${FONT}`;
  ctx.fillText("マイ参戦記録", M, M+44);
  ctx.fillStyle=MUTED; ctx.font=`400 23px ${FONT}`;
  ctx.fillText("サカミチア | 歴代ライブ", M, M+116);
  ctx.strokeStyle=LINE; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(M, M+158); ctx.lineTo(W-M, M+158); ctx.stroke();
  let y=M+182;
  const {v:av, s:as}=attendCounts(shows);
  ctx.fillStyle=INK; ctx.font=`700 42px ${FONT}`;
  ctx.fillText(`記録した公演：全 ${shows.length} 公演`, M, y); y+=56;
  ctx.fillStyle=MUTED; ctx.font=`400 27px ${FONT}`;
  ctx.fillText(`参戦（現地）${av} 公演 ・ 配信で見た ${as} 公演`, M, y); y+=56;
  const fit=(text,maxW)=>{ if(ctx.measureText(text).width<=maxW) return text; const e="…"; let t=text; while(t.length&&ctx.measureText(t+e).width>maxW) t=t.slice(0,-1); return t+e; };
  const wrap=(tokens,maxW)=>{
    const lines=[]; let cur="";
    for(const t of tokens){
      const cand=cur?cur+" ・ "+t:t;
      if(ctx.measureText(cand).width<=maxW||!cur) cur=cand;
      else{ lines.push(cur); cur=t; }
    }
    if(cur) lines.push(cur);
    return lines;
  };
  const byG={}, byY={};
  shows.forEach(l=>{
    const k=ATTENDED.get(l.id)==="stream" ? "s" : "v";
    (byG[l.group] ||= {v:0, s:0})[k]++;
    const yy=l.date.slice(0,4);
    (byY[yy] ||= {v:0, s:0})[k]++;
  });
  ctx.font=`700 27px ${FONT}`; ctx.fillStyle=INK;
  ctx.fillText("グループ別", M, y); y+=44;
  ctx.font=`400 26px ${FONT}`;
  for(const g of GROUP_LIST){
    if(!byG[g]) continue;
    ctx.fillStyle=ATTEND_GCOLOR[g]||INK; ctx.beginPath(); ctx.arc(M+11, y+15, 9, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle=INK; ctx.fillText(`${g}　${attendParts(byG[g])}件`, M+34, y); y+=40;
  }
  y+=14;
  ctx.font=`700 27px ${FONT}`; ctx.fillText("年別", M, y); y+=44;
  ctx.font=`400 26px ${FONT}`; ctx.fillStyle=INK;
  wrap(Object.keys(byY).sort().reverse().map(yy=>`${yy}年 ${attendParts(byY[yy])}件`), W-2*M).forEach(line=>{ ctx.fillText(line, M, y); y+=40; });
  y+=14;
  ctx.font=`700 27px ${FONT}`; ctx.fillText("最近の記録", M, y); y+=46;
  ctx.font=`400 24px ${FONT}`;
  const recent=shows.slice(0,15);
  let drawn=0;
  for(const l of recent){
    if(y+34>BOTTOM-30) break;
    const st=ATTENDED.get(l.id);
    ctx.fillStyle=MUTED; ctx.fillText(l.date.replace(/-/g,"/"), M, y);
    ctx.fillStyle= st==="stream" ? "#1f6fb2" : "#7e57c2";
    ctx.fillText(st==="stream" ? "配信" : "参戦", M+168, y);
    ctx.fillStyle=INK; ctx.fillText(fit(l.title, W-2*M-240), M+240, y);
    y+=38; drawn++;
  }
  if(shows.length>drawn && y+34<=BOTTOM-30){
    ctx.fillStyle=MUTED; ctx.fillText(`…ほか ${shows.length-drawn} 件`, M, y);
  }
  ctx.fillStyle=MUTED; ctx.font=`400 21px ${FONT}`;
  ctx.fillText("https://sakamichia.pages.dev/live/", M, H-44);
  return new Promise((resolve,reject)=>cv.toBlob(b=>b?resolve(b):reject(new Error("画像を生成できませんでした。")),"image/png"));
}
async function shareAttendImage(){
  if(!attendedShows().length) return;
  try{
    const blob=await attendedImageBlob();
    const file=new File([blob], "sakamichia-attended.png", {type:"image/png"});
    if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], text:"サカミチアのマイ参戦記録\nhttps://sakamichia.pages.dev/live/"});
      return;
    }
    const url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url; a.download="sakamichia-attended.png"; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 3000);
  }catch(e){ /* 共有キャンセル時は何もしない */ }
}
init();
