// トップ：横断検索
let DB = {};
// ブログのタイトルは、ブログページと同じく所属グループの公式ブログのフォントで出す
// （卒業メンバーの記事は本人の所属グループから判定する）
function blogFontCls(b){
  let g=(b&&b.group)||"";
  if(!["乃木坂46","櫻坂46","欅坂46","日向坂46","けやき坂46"].includes(g)){
    const m=(DB.members||[]).find(x=>x.name===(b&&b.member));
    if(m) g=m.group||"";
  }
  return g==="乃木坂46" ? "bf-nogi" : (g==="櫻坂46"||g==="欅坂46") ? "bf-sakura" : "bf-hinata";
}
async function init(){
  const [lives, bidx, songs, members, newsData, meta, photos, otd] = await Promise.all([
    loadJSON("lives.json"), loadJSON("blogs/index.json"),
    loadJSON("songs.json"), loadJSON("members.json"), loadJSON("news.json"),
    loadJSON("member-meta.json"), loadJSON("member-photos.json"), loadJSON("on-this-day.json")]);
  const latestYear = Math.max(...Object.keys(bidx.years).map(Number));
  const blogs = await loadJSON(`blogs/y${latestYear}.json`);
  const news = (newsData && newsData.items) || [];
  DB = {lives, blogs, songs, members, news};
  renderToday(meta, photos, otd);
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  document.getElementById("homeNews").innerHTML = news.slice(0, 5).map(n => {
    const dt = new Date(n.d + "T00:00:00+09:00");
    const [, mm, dd] = n.d.split("-");
    return `<a class="nw-row" href="${esc(n.url)}" target="_blank" rel="noopener">
      <span class="nw-date"><b>${n.d.slice(0, 4)}/${+mm}/${+dd}</b>（${WD[dt.getDay()]}）</span>
      <span class="nw-main"><span class="nw-meta">${groupChip(n.g)}${n.c ? `<span class="nw-cat">${esc(n.c)}</span>` : ""}</span>
      <span class="nw-title">${esc(n.title)}</span></span></a>`;
  }).join("");
  document.getElementById("counts").textContent =
    `登録データ：ライブ ${lives.length}件 / ブログ ${bidx.total}件 / 楽曲 ${songs.length}曲 / メンバー ${members.length}人`;
  const q = new URLSearchParams(location.search).get("q");
  if(q){ document.getElementById("q").value = q; search(q); }
}
const GCOL={"乃木坂46":"#7e57c2","櫻坂46":"#e77a9b","日向坂46":"#5aa9d6","欅坂46":"#5eba53","けやき坂46":"#a4c639"};
// 「今日の坂道」：今日が誕生日のメンバー＋◯年前の今日のブログ。両方なければセクション自体を出さない
function renderToday(meta, photos, otd){
  const box=document.getElementById("todaySection");
  if(!box) return;
  const now=new Date(), mo=now.getMonth()+1, da=now.getDate();
  const md=`${String(mo).padStart(2,"0")}-${String(da).padStart(2,"0")}`;
  const bdays=(DB.members||[]).filter(m=>{
    const b=meta && meta[m.name] && meta[m.name].b;
    return Array.isArray(b) && b[1]===mo && b[2]===da;
  });
  const past=(otd && otd[md]) || [];
  if(!bdays.length && !past.length){ box.innerHTML=""; return; }
  let html=`<h2 class="title" style="margin-top:26px">今日の坂道</h2>`;
  if(bdays.length){
    html+=`<h3 class="home-ghead">🎂 今日が誕生日のメンバー</h3><div class="bday-row">`+bdays.map(m=>{
      const f=photos && photos[m.name];
      return `<a class="bday-chip" href="members/?member=${encodeURIComponent(m.name)}" style="border-left-color:${GCOL[m.group]||"#2b2430"}">`
        +(f?`<img src="${BASE}assets/member-photos/${esc(f)}" alt="" loading="lazy">`:"")
        +`<span class="bday-name">${esc(m.name)}</span>${groupChip(m.group)}</a>`;
    }).join("")+`</div>`;
  }
  if(past.length){
    html+=`<h3 class="home-ghead">◯年前の今日のブログ</h3><div class="grid">`+past.map(b=>{
      const yrs=now.getFullYear()-(+String(b.date).slice(0,4));
      return `<a class="card" href="blog/?open=${encodeURIComponent(b.id)}">`
        +(b.thumb?`<div class="bthumb"><img loading="lazy" src="${esc(b.thumb)}" alt="" onerror="this.parentNode.style.display='none'"></div>`:"")
        +`${groupChip(b.group)}<span class="otd-years">${yrs}年前の今日</span>`
        +`<h3 class="${blogFontCls(b)}">${esc(b.title)}</h3><p>${esc(b.date)} ・ ${esc(b.member)}</p></a>`;
    }).join("")+`</div>`;
  }
  box.innerHTML=html;
}
function search(q){
  q = (q||"").trim(); const box = document.getElementById("results");
  if(!q){ box.innerHTML=""; return; }
  const hit = (parts) => includesAll(itemText(parts), q);
  const sec = (title, cards) => cards.length ? `<h2 class="title" style="font-size:21px;margin-top:22px">${title}（${cards.length}）</h2><div class="grid">${cards.join("")}</div>` : "";
  const liveCards = DB.lives.filter(l=>hit([l.title,l.group,l.venue,l.date,l.tags,l.setlist])).map(l=>
    `<a class="card" href="live/">${groupChip(l.group)}<h3>${esc(l.title)}</h3><p>${esc(l.date)} ・ ${esc(l.venue)}</p>${tags(l.tags)}</a>`);
  const songCards = DB.songs.filter(s=>hit([s.title,s.group,s.center,s.year])).map(s=>
    `<a class="card" href="songs/">${groupChip(s.group)}<h3>${esc(s.title)}</h3><p>${esc(s.year)}年${s.center?` ・ センター：${esc(s.center)}`:""}</p></a>`);
  const memberCards = DB.members.filter(m=>hit([m.name,m.group,m.reading,m.centerSongs])).map(m=>
    `<a class="card" href="members/?member=${encodeURIComponent(m.name)}">${groupChip(m.group)}<h3>${esc(m.name)}</h3><p>${esc([m.gen?m.gen+"期生":"", m.graduated?"卒業":""].filter(Boolean).join(" ・ "))}<br>センター曲：${esc((m.centerSongs||[]).slice(0,8).join("、") || "—")}${(m.centerSongs||[]).length>8?" ほか":""}</p></a>`);
  const blogCards = DB.blogs.filter(b=>hit([b.title,b.group,b.member,b.date])).map(b=>
    `<a class="card" href="blog/">${groupChip(b.group)}<h3 class="${blogFontCls(b)}">${esc(b.title)}</h3><p>${esc(b.date)} ・ ${esc(b.member)}</p></a>`);
  const newsCards = (DB.news||[]).filter(n=>hit([n.title,n.g,n.c])).map(n=>
    `<a class="card" href="${esc(n.url)}" target="_blank" rel="noopener">${groupChip(n.g)}<h3>${esc(n.title)}</h3><p>${esc(n.d)}${n.c?` ・ ${esc(n.c)}`:""}（公式サイト）</p></a>`);
  const html = sec("歴代ライブ",liveCards)+sec("お知らせ",newsCards)+sec("楽曲",songCards)+sec("メンバー",memberCards)+sec("ブログ",blogCards);
  box.innerHTML = html || `<div class="empty">「${esc(q)}」は見つかりませんでした。<br>メンバー名・曲名・会場名で試してみてください。</div>`;
}
document.getElementById("searchForm").addEventListener("submit", e=>{ e.preventDefault(); hideSuggest(); search(document.getElementById("q").value); });
// 横断検索のサジェスト：入力中にメンバー・楽曲・ライブの候補を出す
const SG_MAX=8;
function suggestItems(q){
  const hits=(text)=>String(text||"").toLowerCase().includes(q.toLowerCase());
  const items=[];
  (DB.members||[]).filter(m=>hits(m.name)||hits(m.reading)).slice(0,4).forEach(m=>items.push(
    {kind:"メンバー", cls:"member", label:m.name, sub:m.group||"", href:`members/?member=${encodeURIComponent(m.name)}`}));
  (DB.songs||[]).filter(s=>hits(s.title)||hits(s.yomi)).slice(0,4).forEach(s=>items.push(
    {kind:"楽曲", cls:"song", label:s.title, sub:[s.group, s.year?`${s.year}年`:""].filter(Boolean).join(" ・ "), href:`songs/?q=${encodeURIComponent(s.title)}`}));
  (DB.lives||[]).filter(l=>hits(l.title)).slice(0,4).forEach(l=>items.push(
    {kind:"ライブ", cls:"live", label:l.title, sub:[l.group, l.date].filter(Boolean).join(" ・ "), href:"live/"}));
  return items.slice(0, SG_MAX);
}
function renderSuggest(){
  const input=document.getElementById("q"), box=document.getElementById("suggest");
  const q=input.value.trim();
  if(!q || !DB.members){ box.hidden=true; box.innerHTML=""; return; }
  const items=suggestItems(q);
  if(!items.length){ box.hidden=true; box.innerHTML=""; return; }
  box.innerHTML=items.map(it=>`<a class="sg-row" href="${esc(it.href)}"><span class="sg-kind sg-${it.cls}">${it.kind}</span><span class="sg-label">${esc(it.label)}</span>${it.sub?`<span class="sg-sub">${esc(it.sub)}</span>`:""}</a>`).join("");
  box.hidden=false;
}
function hideSuggest(){ const box=document.getElementById("suggest"); if(box){ box.hidden=true; } }
(function(){
  const input=document.getElementById("q"), box=document.getElementById("suggest"), form=document.getElementById("searchForm");
  if(!input||!box||!form) return;
  input.addEventListener("input", renderSuggest);
  input.addEventListener("focus", renderSuggest);
  input.addEventListener("keydown", e=>{ if(e.key==="Escape") hideSuggest(); });
  // 候補のタップ／クリックが blur で消えないようにする
  box.addEventListener("mousedown", e=>e.preventDefault());
  input.addEventListener("blur", ()=>setTimeout(hideSuggest, 120));
  document.addEventListener("click", e=>{ if(!form.contains(e.target)) hideSuggest(); });
})();
// ブラウザのタブ復元（スナップショット表示）では古い件数が残るため、復元時は最新データで描き直す
window.addEventListener("pageshow", e=>{ if(e.persisted) init(); });
init();
