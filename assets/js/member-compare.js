// メンバー比較：2人の記録（センター曲・フォーメーション・ライブ・ブログ）と共通参加曲・隣同士回数を並べる
let MEMBERS = [], META = {}, PHOTOS = {}, SONGS = [], FORMS = {}, MLIVE = {}, BLOGS = {};
const byName = {};
function photo(name) { const f = PHOTOS[name]; return f ? BASE + "assets/member-photos/" + f : ""; }
function centerSongs(name, titleOnly) {
  return SONGS.filter(s => s.center && s.center.split("・").includes(name) && (!titleOnly || s.type === "表題曲"));
}
function formStats(name) {
  let songs = 0, front = 0; const nb = {};
  for (const k in FORMS) {
    const f = FORMS[k]; if (f.external) continue;
    if (f.rows) {
      for (let r = 0; r < f.rows.length; r++) {
        const row = f.rows[r], p = row.indexOf(name);
        if (p < 0) continue;
        songs++; if (r === f.rows.length - 1) front++;
        [row[p - 1], row[p + 1]].forEach(x => { if (x) nb[x] = (nb[x] || 0) + 1; });
      }
    } else if (f.vocal && f.vocal.includes(name)) songs++;
  }
  return { songs, front, nb };
}
function partSongs(name) {
  const set = new Set();
  for (const k in FORMS) {
    const f = FORMS[k]; if (f.external) continue;
    if ((f.rows && f.rows.flat().includes(name)) || (f.vocal && f.vocal.includes(name))) set.add(k.split("|").slice(1).join("|"));
  }
  return set;
}
function head(m) {
  const url = photo(m.name);
  const meta = META[m.name] || {};
  const bd = meta.b ? `${meta.b[1]}月${meta.b[2]}日` : "―";
  return `<div class="cmp-head">${url ? `<img src="${esc(url)}" alt="">` : ""}<h3>${esc(m.name)}</h3>
    <p>${groupChip(m.group)}${m.gen ? ` ${m.gen}期` : ""}${m.graduated ? "・卒業" : ""}<br>誕生日：${bd}${meta.home ? `／出身：${esc(meta.home)}` : ""}</p>
    <p><a href="../?member=${encodeURIComponent(m.name)}">メンバー詳細 →</a></p></div>`;
}
function render() {
  const a = byName[document.getElementById("cmpA").value], b = byName[document.getElementById("cmpB").value];
  const body = document.getElementById("cmpBody");
  if (!a || !b) { body.innerHTML = ""; return; }
  history.replaceState(null, "", `?a=${encodeURIComponent(a.name)}&b=${encodeURIComponent(b.name)}`);
  const fa = formStats(a.name), fb = formStats(b.name);
  const row = (label, va, vb) => `<div class="cmp-row"><span class="cmp-va">${va}</span><span class="cmp-lab">${label}</span><span class="cmp-vb">${vb}</span></div>`;
  const num = (x, unit) => `<b>${x}</b>${unit}`;
  const pa = partSongs(a.name), pb = partSongs(b.name);
  const common = [...pa].filter(t => pb.has(t));
  const nbCount = fa.nb[b.name] || 0;
  body.innerHTML = `
    <div class="cmp-heads">${head(a)}${head(b)}</div>
    <div class="cmp-table">
      ${row("シングル表題曲センター", num(centerSongs(a.name, true).length, "曲"), num(centerSongs(b.name, true).length, "曲"))}
      ${row("センター曲（全曲）", num(centerSongs(a.name, false).length, "曲"), num(centerSongs(b.name, false).length, "曲"))}
      ${row("フォーメーション／歌唱参加", num(fa.songs, "曲"), num(fb.songs, "曲"))}
      ${row("フロント（1列目）", num(fa.front, "曲"), num(fb.front, "曲"))}
      ${row("ライブ出演記録", num((MLIVE[a.name] || {}).shows || 0, "公演"), num((MLIVE[b.name] || {}).shows || 0, "公演"))}
      ${row("ライブ センター", num((MLIVE[a.name] || {}).centers || 0, "公演"), num((MLIVE[b.name] || {}).centers || 0, "公演"))}
      ${row("ブログ記事", num(BLOGS[a.name] || 0, "件"), num(BLOGS[b.name] || 0, "件"))}
    </div>
    <h3 class="home-ghead">2人の共通点</h3>
    <p>フォーメーションで隣同士になった回数：<b>${nbCount}回</b>　／　共通の参加曲：<b>${common.length}曲</b></p>
    ${common.length ? `<p style="line-height:2">${common.slice(0, 40).map(t => `<a href="../../songs/?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join("、")}${common.length > 40 ? ` ほか${common.length - 40}曲` : ""}</p>` : ""}`;
}
async function init() {
  const [members, meta, photos, songs, forms, mlive, bidx] = await Promise.all([
    loadJSON("members.json"), loadJSON("member-meta.json"), loadJSON("member-photos.json"),
    loadJSON("songs.json"), loadJSON("formations.json"), loadJSON("member-live.json"), loadJSON("blogs/index.json")]);
  MEMBERS = members || []; META = meta || {}; PHOTOS = photos || {}; SONGS = songs || []; FORMS = forms || {}; MLIVE = mlive || {};
  MEMBERS.forEach(m => byName[m.name] = m);
  for (const [k, v] of Object.entries((bidx && bidx.memberCounts) || {})) {
    const nm = k.split("|").pop(); BLOGS[nm] = (BLOGS[nm] || 0) + v;
  }
  const groups = {};
  MEMBERS.forEach(m => { (groups[m.group] = groups[m.group] || []).push(m); });
  const opts = Object.entries(groups).map(([g, ms]) => `<optgroup label="${esc(g)}">${ms.map(m => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join("")}</optgroup>`).join("");
  const A = document.getElementById("cmpA"), B = document.getElementById("cmpB");
  A.innerHTML = opts; B.innerHTML = opts;
  const q = new URLSearchParams(location.search);
  A.value = byName[q.get("a")] ? q.get("a") : "小坂菜緒";
  B.value = byName[q.get("b")] ? q.get("b") : "金村美玖";
  A.addEventListener("change", render); B.addEventListener("change", render);
  render();
}
init();
