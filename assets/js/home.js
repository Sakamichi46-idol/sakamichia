// トップ：横断検索
let DB = {};
async function init(){
  const [lives, matome, bidx, songs, members] = await Promise.all([
    loadJSON("lives.json"), loadJSON("matome.json"), loadJSON("blogs/index.json"),
    loadJSON("songs.json"), loadJSON("members.json")]);
  const latestYear = Math.max(...Object.keys(bidx.years).map(Number));
  const blogs = await loadJSON(`blogs/y${latestYear}.json`);
  DB = {lives, matome, blogs, songs, members};
  document.getElementById("counts").textContent =
    `登録データ：ライブ ${lives.length}件 / まとめ ${matome.length}件 / ブログ ${bidx.total}件 / 楽曲 ${songs.length}曲 / メンバー ${members.length}人`;
  const q = new URLSearchParams(location.search).get("q");
  if(q){ document.getElementById("q").value = q; search(q); }
}
function search(q){
  q = (q||"").trim(); const box = document.getElementById("results");
  if(!q){ box.innerHTML=""; return; }
  const hit = (parts) => includesAll(itemText(parts), q);
  const sec = (title, cards) => cards.length ? `<h2 class="title" style="font-size:21px;margin-top:22px">${title}（${cards.length}）</h2><div class="grid">${cards.join("")}</div>` : "";
  const liveCards = DB.lives.filter(l=>hit([l.title,l.group,l.venue,l.date,l.tags,l.setlist])).map(l=>
    `<a class="card" href="live/">${groupChip(l.group)}<h3>${esc(l.title)}</h3><p>${esc(l.date)} ・ ${esc(l.venue)}</p>${tags(l.tags)}</a>`);
  const matomeCards = DB.matome.filter(m=>hit([m.title,m.group,m.program,m.summary,m.members,m.tags])).map(m=>
    `<a class="card" href="matome/">${groupChip(m.group)}<h3>${esc(m.title)}</h3><p>${esc(m.summary)}</p>${tags(m.tags)}</a>`);
  const songCards = DB.songs.filter(s=>hit([s.title,s.group,s.center,s.year])).map(s=>
    `<a class="card" href="songs/">${groupChip(s.group)}<h3>${esc(s.title)}</h3><p>${esc(s.year)}年${s.center?` ・ センター：${esc(s.center)}`:""}</p></a>`);
  const memberCards = DB.members.filter(m=>hit([m.name,m.group,m.reading,m.centerSongs])).map(m=>
    `<div class="card">${groupChip(m.group)}<h3>${esc(m.name)}</h3><p>${esc([m.gen?m.gen+"期生":"", m.graduated?"卒業":""].filter(Boolean).join(" ・ "))}<br>センター曲：${esc((m.centerSongs||[]).slice(0,8).join("、") || "—")}${(m.centerSongs||[]).length>8?" ほか":""}</p></div>`);
  const blogCards = DB.blogs.filter(b=>hit([b.title,b.group,b.member,b.date])).map(b=>
    `<a class="card" href="blog/">${groupChip(b.group)}<h3>${esc(b.title)}</h3><p>${esc(b.date)} ・ ${esc(b.member)}</p></a>`);
  const html = sec("歴代ライブ",liveCards)+sec("まとめ",matomeCards)+sec("楽曲",songCards)+sec("メンバー",memberCards)+sec("ブログ",blogCards);
  box.innerHTML = html || `<div class="empty">「${esc(q)}」は見つかりませんでした。<br>メンバー名・曲名・会場名で試してみてください。</div>`;
}
document.getElementById("searchForm").addEventListener("submit", e=>{ e.preventDefault(); search(document.getElementById("q").value); });
init();
