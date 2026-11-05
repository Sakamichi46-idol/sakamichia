// トッププレビュー専用：ピックアップの描画。
// 上位2枠は「新着プール」から新しい順に入る（新ゲーム・新機能・改善のどれでも入れる）。
// 各項目は until（鮮度の期限）までラベル付きで残り、過ぎると自動でプールから外れる。
// プールは新しい順に並べておくこと。残りの枠は定番の週替わりローテーションで埋めて合計3枚にする
// （古い特集が残り続けないための仕組み）。
const PICKUPS_FRESH = [
  { href: "members/", tint: "n", label: "新機能", title: "メンバー個別ページ", desc: "メンバー一人ひとりの個別ページができました。センター曲・ライブ記録・歴代アー写などをまとめて見られます。", lite: "メンバーごとの個別ページ。", until: "2026-12-20" },
  { href: "games/anagram/", tint: "s", label: "新ゲーム", title: "アナグラム", desc: "バラバラになったカタカナのタイルを並べ替えて、メンバー名や楽曲タイトルを当てるクイズです。", lite: "タイルを並べ替えて名前・曲名を当てる。", until: "2026-12-19" },
  { href: "games/memory-match/", tint: "h", label: "新ゲーム", title: "神経衰弱", desc: "メンバーの最新アー写を使ったペア合わせゲーム。6・8・12ペアから選べます。", lite: "最新アー写のペア合わせゲーム。", until: "2026-12-19" },
  { href: "contact/", tint: "n", label: "新機能", title: "お問い合わせページ", desc: "データの誤りやご要望を送れる、お問い合わせページを開設しました。", lite: "誤りの報告・ご要望はこちらから。", until: "2026-12-19" },
];
const PICKUPS_EVERGREEN = [
  { href: "formation/", tint: "h", title: "マイフォーメーション", desc: "列の形を決めて、好きなメンバーを自由に配置。画像として保存もできます。", lite: "好きなメンバーを自由に配置する。" },
  { href: "games/setlist-draft/", tint: "h", title: "セトリドラフト", desc: "曲を指名し合って、自分だけのセットリストを組むドラフトゲームです。", lite: "曲を指名してセトリを組むドラフト。" },
  { href: "blog/stats/", tint: "h", title: "ブログ統計", desc: "メンバーごとの記事数や年ごとの投稿数を、ランキング形式で見られます。", lite: "ブログの投稿数をランキングで見る。" },
];
(function renderPickups(){
  const grid = document.getElementById("pickGrid");
  if (!grid) return;
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const items = PICKUPS_FRESH.filter(p => ymd <= p.until).slice(0, 2).map(p => ({ ...p, isNew: true }));
  const week = Math.floor(Date.now() / (7 * 86400000));
  for (let k = 0; items.length < 3 && k < PICKUPS_EVERGREEN.length; k++) {
    items.push({ ...PICKUPS_EVERGREEN[(week + k) % PICKUPS_EVERGREEN.length], isNew: false });
  }
  grid.innerHTML = items.map((p, i) =>
    `<a class="pick pick-${p.tint}" href="${p.href}"><span class="pick-no">${String(i + 1).padStart(2, "0")}</span><div><h3>${p.isNew ? `${esc(p.label)}「${esc(p.title)}」` : esc(p.title)}</h3><p data-lite-text="${esc(p.lite)}">${esc(p.desc)}</p></div></a>`
  ).join("");
})();
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
  const [lives, bidx, songs, members, newsData, meta, photos, otd, mLatest, jackets] = await Promise.all([
    loadJSON("lives.json"), loadJSON("blogs/index.json"),
    loadJSON("songs.json"), loadJSON("members.json"), loadJSON("news-recent.json"),
    loadJSON("member-meta.json"), loadJSON("member-photos.json"), loadJSON(`on-this-day/m${String(new Date().getMonth() + 1).padStart(2, "0")}.json`),
    loadJSON("member-latest.json"), loadJSON("jackets.json")]);
  const latestYear = Math.max(...Object.keys(bidx.years).map(Number));
  const blogs = await loadJSON(`blogs/y${latestYear}.json`);
  const news = (newsData && newsData.items) || [];
  DB = {lives, blogs, songs, members, news, jackets};
  // 月別ファイルが読めなかった場合（デプロイ直後など）は全期間版にフォールバック
  let otdFull = otd;
  if (Array.isArray(otdFull)) { const f = await loadJSON("on-this-day.json"); if (f && !Array.isArray(f)) otdFull = f; }
  renderToday(meta, photos, otdFull);
  renderFavs(mLatest, meta);
  renderOmikuji(photos);
  renderTicker(meta);
  renderDisco();
  renderBlogRail();
  renderMv();
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
  // 入口カードのメンバー数もデータ連動にする（固定値を書くと人数変更で古くなるため）
  const mc = document.getElementById("memberCardText");
  if (mc) mc.textContent = document.documentElement.dataset.lite === "1"
    ? `${members.length}人のプロフィールと記録を見る。`
    : `${members.length}人のプロフィール、歴代アー写など、センター曲やブログ記事数を見る。`;
  const q = new URLSearchParams(location.search).get("q");
  if(q){ document.getElementById("q").value = q; search(q); }
  // 横断検索用に全期間のお知らせは後から読み込む（初回表示は直近分だけで軽くする）。
  // 簡易版では通信量を優先し、全期間データ（6MB超）は読み込まない（お知らせ検索は直近分のみ）
  if (document.documentElement.dataset.lite !== "1") {
    const loadFullNews = () => loadNewsShards(acc => { DB.news = acc; }).then(all => {
      if (!all) return loadJSON("news.json").then(full => { if (full && full.items) DB.news = full.items; });
    });
    if ("requestIdleCallback" in window) requestIdleCallback(loadFullNews, { timeout: 4000 }); else setTimeout(loadFullNews, 2500);
  }
}
const GCOL={"乃木坂46":"#7e57c2","櫻坂46":"#e77a9b","日向坂46":"#5aa9d6","欅坂46":"#5eba53","けやき坂46":"#a4c639"};
// プレビュー9（公式サイト寄せ）：TODAY バー／ジャケット・ブログ・MV のレール
function p9fmt(d){ return d ? String(d).replaceAll("-", ".") : ""; }
function renderTicker(meta){
  const box = document.getElementById("ticker");
  const track = document.getElementById("tickerTrack");
  if(!box || !track) return;
  const now = new Date(), mo = now.getMonth() + 1, da = now.getDate();
  const tstr = `${now.getFullYear()}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  const items = [];
  const bdays = (DB.members || []).filter(m => {
    const b = meta && meta[m.name] && meta[m.name].b;
    return Array.isArray(b) && b[1] === mo && b[2] === da;
  }).map(m => m.name);
  if (bdays.length) items.push(`今日は${bdays.join("・")}の誕生日`);
  const rels = (DB.songs || []).filter(x => x.date === tstr && x.type === "表題曲");
  if (rels.length) items.push(`本日発売『${rels[0].title}』（${rels[0].group}）`);
  const livesToday = (DB.lives || []).filter(l => l.date === tstr);
  if (livesToday.length) items.push(`本日開催：${livesToday[0].title}`);
  for (const n of (DB.news || []).slice(0, 3)) items.push(n.title);
  const upd = document.querySelector(".site-updates-mini li");
  if (upd) items.push("更新：" + upd.textContent.trim());
  if(!items.length) return;
  const seq = items.map(t => `<span class="tk-item">${esc(t)}</span>`).join('<span class="tk-dot"></span>');
  track.innerHTML = seq + '<span class="tk-dot"></span>' + seq + '<span class="tk-dot"></span>';
  box.hidden = false;
}
function renderDisco(){
  const rail = document.getElementById("discoRail");
  if(!rail) return;
  const seen = new Map();
  for (const s of (DB.songs || [])){
    if (s.type !== "表題曲" || !s.release || !s.date) continue;
    const key = `${s.release}|${s.date}`;
    if (!seen.has(key)) seen.set(key, s);
  }
  const today = new Date().toISOString().slice(0, 10);
  const items = [...seen.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
  rail.innerHTML = items.map(s => {
    const jk = (DB.jackets || {})[`${s.release}|${s.date}`];
    const fut = s.date > today;
    const media = jk && jk.img ? `<img loading="lazy" src="${esc(jk.img)}" alt="">`
      : `<div class="jk-ph">${p9fmt(s.date)}<br>${fut ? "発売予定" : ""}</div>`;
    return `<a class="jk-card" href="songs/${String(s.id).toLowerCase()}/">${media}`
      + `<div class="jk-t">${esc(s.title)}</div>`
      + `<div class="jk-d">${esc(s.group)} ・ ${p9fmt(s.date)}${fut ? " 発売予定" : " 発売"}</div></a>`;
  }).join("");
}
function renderBlogRail(){
  const rail = document.getElementById("blogRail");
  if(!rail) return;
  const items = (DB.blogs || []).filter(b => b.thumb).slice(0, 10);
  rail.innerHTML = items.map(b =>
    `<a class="bl-card" href="blog/?open=${encodeURIComponent(b.id)}">`
    + `<img loading="lazy" src="${esc(b.thumb)}" alt="" onerror="this.style.display='none'">`
    + `<div class="bl-t">${esc(b.title)}</div>`
    + `<div class="bl-d">${esc(b.member)} ・ ${p9fmt(b.date)}</div></a>`).join("");
}
function renderMv(){
  const rail = document.getElementById("mvRail");
  if(!rail) return;
  const items = (DB.songs || []).filter(s => s.mv)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 10);
  rail.innerHTML = items.map(s => {
    const m = String(s.mv).match(/(?:v=|youtu\.be\/)([\w-]{6,})/);
    const th = m ? `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg` : "";
    return `<a class="mv-card" href="songs/${String(s.id).toLowerCase()}/">`
      + `<div class="mv-thumb">${th ? `<img loading="lazy" src="${th}" alt="">` : ""}<span class="mv-play">▶</span></div>`
      + `<div class="jk-t">${esc(s.title)}</div>`
      + `<div class="jk-d">${esc(s.group)} ・ ${p9fmt(s.date)}</div></a>`;
  }).join("");
}
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
  // ◯年前の今日：サムネ有りを優先し、毎回表示が変わるよう候補からランダムに最大6件
  const pastAll=(otd && otd[md]) || [];
  const shuffled=a=>{ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=a[i]; a[i]=a[j]; a[j]=t; } return a; };
  const past=shuffled(pastAll.filter(b=>b.thumb)).concat(shuffled(pastAll.filter(b=>!b.thumb))).slice(0,6).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  // 今日の1曲：MVリンクのある曲から日替わりで1曲（同じ日は誰の画面でも同じ曲）
  const mvSongs=(DB.songs||[]).filter(s=>s.mv);
  let songCard="";
  if(mvSongs.length){
    const seed=`${now.getFullYear()}-${md}`;
    let h=0; for(const c of seed) h=(h*31 + c.charCodeAt(0))>>>0;
    const s=mvSongs[h % mvSongs.length];
    songCard=`<h3 class="home-ghead">今日の1曲</h3><div class="grid"><a class="card" href="songs/${String(s.id).toLowerCase()}/">${groupChip(s.group)}<h3>${esc(s.title)}</h3><p>${s.year}年 ・ ${esc(s.type||"")}${s.center?` ・ センター：${esc(s.center)}`:""}</p></a>`
      +`<a class="card" href="${esc(s.mv)}" target="_blank" rel="noopener"><h3>▶ 公式MVを見る</h3><p>YouTube（公式チャンネル）で『${esc(s.title)}』${s.mvKind==="short"?"（Short Ver.）":""}を再生します。</p></a></div>`;
  }
  if(!bdays.length && !past.length && !songCard){ box.innerHTML=""; return; }
  let html=`<div class="sec-head"><span class="sec-en">ON THIS DAY</span><h2 class="sec-ja">今日の坂道</h2></div>`;
  if(bdays.length){
    html+=`<h3 class="home-ghead">今日が誕生日のメンバー</h3><div class="bday-row">`+bdays.map(m=>{
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
  html+=songCard;
  box.innerHTML=html;
}
// 「推しの新着」：推し登録（localStorage "sakamichia-favs"、メンバーページと共有）した
// メンバーの最新ブログを出す。データは daily 再生成の member-latest.json だけを読む。
// セクションの置き場所は「今日の坂道」の直前（DOMはここで差し込む）。
function loadFavNames(){
  try {
    const v = JSON.parse(localStorage.getItem("sakamichia-favs") || "[]");
    return Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
  } catch (e) { return []; }
}
function renderFavs(mLatest, meta){
  const today = document.getElementById("todaySection");
  if(!today) return;
  let box = document.getElementById("favSection");
  if(!box){
    box = document.createElement("div");
    box.id = "favSection";
    // 構成見直し版：推しの新着はおみくじの直後（上部）に置く
    const anchor = document.getElementById("omikujiAnchor");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
    else today.parentNode.insertBefore(box, today);
  }
  const favs = loadFavNames();
  if(!favs.length){
    // 未登録時は大きな見出し+説明を出さず、1行の案内に圧縮する（毎回のノイズにしない）
    box.classList.add("fav-compact");
    box.innerHTML = `<p class="fav-hint"><a href="members/"><b>推しの新着</b></a>：推しを登録すると、ここに推しの最新のブログが並びます。登録は各メンバーのページからできます。</p>`;
    return;
  }
  box.classList.remove("fav-compact");
  const rows = favs
    .map(name => ({name, latest: (mLatest && mLatest[name] && mLatest[name][0]) || null}))
    .filter(r => r.latest)
    .sort((a, b) => String(b.latest.date).localeCompare(String(a.latest.date)));
  if(!rows.length){
    box.innerHTML = `<h2 class="title" style="margin-top:26px">推しの新着</h2>
    <p style="color:var(--muted)">推しのブログ記事がまだ見つかりませんでした。</p>`;
    return;
  }
  // 推しの次の誕生日までのカウントダウン
  let bdayLine = "";
  if (meta) {
    const now = new Date(); const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let best = null;
    favs.forEach(name => {
      const b = meta[name] && meta[name].b; if (!Array.isArray(b)) return;
      let t = new Date(now.getFullYear(), b[1] - 1, b[2]);
      if (t < today0) t = new Date(now.getFullYear() + 1, b[1] - 1, b[2]);
      const days = Math.round((t - today0) / 86400000);
      if (!best || days < best.days) best = { name, days, mo: b[1], da: b[2] };
    });
    if (best) bdayLine = `<p style="margin:2px 0 10px">推しの次の誕生日：<a href="members/?member=${encodeURIComponent(best.name)}"><b>${esc(best.name)}</b></a>（${best.mo}月${best.da}日）まで${best.days === 0 ? "<b>今日です！</b>" : `あと<b>${best.days}日</b>`}</p>`;
  }
  box.innerHTML = `<h2 class="title" style="margin-top:26px">推しの新着</h2>` + bdayLine + `<div class="grid">` + rows.map(r => {
    const b = r.latest;
    const bb = {group: b.group, member: r.name};
    return `<a class="card" href="blog/?open=${encodeURIComponent(b.id)}">`
      + (b.thumb ? `<div class="bthumb"><img loading="lazy" src="${esc(b.thumb)}" alt="" onerror="this.parentNode.style.display='none'"></div>` : "")
      + `${groupChip(b.group)}<span style="font-weight:700">${esc(r.name)}</span>`
      + `<h3 class="${blogFontCls(bb)}">${esc(b.title)}</h3><p>${esc(b.date)}</p></a>`;
  }).join("") + `</div>`;
}
// 「今日の推し運おみくじ」：サイトを訪れたら引く日課用にトップにも置く。
// 抽選・保存は common.js の共通部品で、おみくじページと同じ結果になる。
function renderOmikuji(photos){
  const anchor = document.getElementById("omikujiAnchor");
  if(!anchor) return;
  let box = document.getElementById("omikujiSection");
  if(!box){
    box = document.createElement("div");
    box.id = "omikujiSection";
    anchor.appendChild(box);
  }
  const saved = omikujiLoad();
  const omNote = `<p style="color:var(--muted);font-size:13px;margin:2px 0 8px">${document.documentElement.dataset.lite === "1" ? "推しや現役メンバーが出ます。" : "推し登録をしていると推しの中から、未登録の場合は現役メンバーから出ます。"}</p>`;
  if(saved){
    const f = photos && photos[saved.name];
    box.innerHTML = `<h2 class="title" style="margin-top:10px">今日の推し運おみくじ</h2>${omNote}
    <div class="om-home">${f ? `<img src="${BASE}assets/member-photos/${esc(f)}" alt="">` : ""}
      <div class="om-home-main"><span class="om-home-rank" data-rank="${esc(saved.rank)}">${esc(saved.rank)}</span> <b style="white-space:nowrap">${esc(saved.name)}</b>${groupChip(saved.group)}
      <p>${esc(saved.msg)}</p></div></div>`;
    return;
  }
  box.innerHTML = `<h2 class="title" style="margin-top:10px">今日の推し運おみくじ</h2>${omNote}
  <div class="om-home">
    <div class="om-home-main"><p style="margin:0">今日の運勢を引いてみましょう（1日1回）。</p></div>
    <button type="button" class="btn" id="homeOmikujiBtn">おみくじを引く</button></div>`;
  document.getElementById("homeOmikujiBtn").addEventListener("click", () => {
    const res = omikujiDraw(DB.members || []);
    if(!res) return;
    omikujiSave(res);
    renderOmikuji(photos);
  });
}
function search(q){
  q = (q||"").trim(); const box = document.getElementById("results");
  if(!q){ box.innerHTML=""; return; }
  const hit = (parts) => includesAll(itemText(parts), q);
  // 各セクションは12件まで＋「もっと見る」で各ページへ（人気名で数百件並んで重く・長くなるのを防ぐ）
  const SEC_MAX = 12;
  const sec = (title, cards, moreHref) => {
    if (!cards.length) return "";
    const more = cards.length > SEC_MAX ? `<p style="margin:-22px 0 30px"><a href="${moreHref}">もっと見る（全${cards.length}件） →</a></p>` : "";
    return `<h2 class="title" style="font-size:21px;margin-top:22px">${title}（${cards.length}）</h2><div class="grid">${cards.slice(0, SEC_MAX).join("")}</div>` + more;
  };
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
  const html = sec("歴代ライブ",liveCards,"live/")+sec("お知らせ",newsCards,"news/")+sec("楽曲",songCards,`songs/?q=${encodeURIComponent(q)}`)+sec("メンバー",memberCards,"members/")+sec("ブログ",blogCards,"blog/");
  box.innerHTML = html || `<div class="empty">「${esc(q)}」は見つかりませんでした。<br>メンバー名・曲名・会場名で試してみてください。</div>`;
}
document.getElementById("searchForm").addEventListener("submit", e=>{ e.preventDefault(); hideSuggest(); search(document.getElementById("q").value); });
// 横断検索のサジェスト：入力中にメンバー・楽曲・ライブの候補を出す
const SG_MAX=8;
function suggestItems(q){
  const hits=(text)=>kanaNorm(String(text||"").toLowerCase()).includes(kanaNorm(q.toLowerCase()));
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
// 例チップ：押すとその語でトップ検索する（プレビュー専用）
document.querySelectorAll(".q-chip").forEach(b => b.addEventListener("click", () => {
  const q = document.getElementById("q");
  if (q) q.value = b.dataset.q;
  const f = document.getElementById("searchForm");
  if (f) f.dispatchEvent(new Event("submit", { cancelable: true }));
}));

// プレビュー8：末尾の共有ボタン列（X / LINE / コピー / 共有シート）
(function(){
  const text = () => withShareTag(document.title.replace(/\s*\|\s*サカミチア\s*$/, "") || "サカミチア");
  const open = (u) => window.open(u, "_blank", "noopener,width=640,height=560");
  const x = document.getElementById("p8ShareX");
  if (x) x.addEventListener("click", () => open("https://x.com/intent/post?text=" + encodeURIComponent(text()) + "&url=" + encodeURIComponent(location.href)));
  const ln = document.getElementById("p8ShareLine");
  if (ln) ln.addEventListener("click", () => open("https://social-plugins.line.me/lineit/share?url=" + encodeURIComponent(location.href)));
  const cp = document.getElementById("p8ShareCopy");
  if (cp) cp.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text() + " " + location.href); cp.classList.add("copied"); setTimeout(() => cp.classList.remove("copied"), 1800); } catch(e){}
  });
  const sh = document.getElementById("p8ShareSheet");
  if (sh) sh.addEventListener("click", () => shareContent({}, null));
})();
