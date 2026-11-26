// フォーメーションの変遷：formations.json（rows は後列→前列の順）からメンバーごとの立ち位置を時系列で出す
let FH_MEMBERS = [], FH_SONGS = [], FH_FORM = {}, FH_PHOTOS = {};
function fhPhoto(name) { const f = FH_PHOTOS[name]; return f ? BASE + "assets/member-photos/" + f : ""; }
function fhPosition(song, entry, name) {
  if (!entry) return null;
  if (entry.rows) {
    const rows = entry.rows;
    for (let r = 0; r < rows.length; r++) {
      const idx = rows[r].indexOf(name);
      if (idx >= 0) {
        const fromFront = rows.length - r; // 1=フロント
        const centers = (song.center || "").split("・").map(s => s.trim());
        const isCenter = centers.includes(name);
        return {
          kind: "rows",
          label: fromFront === 1 ? "フロント" : `${fromFront}列目`,
          detail: `左から${idx + 1}番目`,
          front: fromFront === 1, center: isCenter,
        };
      }
    }
    return null;
  }
  if (entry.vocal && entry.vocal.includes(name)) return { kind: "vocal", label: "歌唱メンバー", detail: "列の指定なし", front: false, center: false };
  if (entry.mv && entry.mv.includes(name)) return { kind: "mv", label: "MV出演", detail: "", front: false, center: false };
  return null;
}
function fhRender(name) {
  const m = FH_MEMBERS.find(x => x.name === name);
  const body = document.getElementById("fhBody");
  if (!m) { body.innerHTML = `<p style="color:var(--muted);margin-top:14px">メンバーを選んでください。</p>`; return; }
  const items = [];
  for (const song of FH_SONGS) {
    const pos = fhPosition(song, FH_FORM[song.group + "|" + song.title], name);
    if (pos) items.push({ song, pos });
  }
  items.sort((a, b) => (a.song.date || "").localeCompare(b.song.date || "") || (a.song.ord || 0) - (b.song.ord || 0));
  const fronts = items.filter(i => i.pos.front).length;
  const centers = items.filter(i => i.pos.center).length;
  const photo = fhPhoto(name);
  const rows = items.map(({ song, pos }) => `<a class="bd-row" href="../songs/${esc(song.id.toLowerCase())}/">
    <span class="bd-date"><b>${esc((song.date || "").slice(0, 4))}</b><small style="display:block;font-size:11px">${esc((song.date || "").slice(5))}</small></span>
    <span class="bd-main"><span class="bd-name">${esc(song.title)}</span>
    <span class="bd-sub">${groupChip(song.group)}<span class="tag">${esc(song.release || "")}</span><span class="tag">${esc(song.type || "")}</span></span></span>
    <span class="fh-pos ${pos.center ? "fh-center" : ""}">${pos.center ? "センター" : esc(pos.label)}${pos.detail ? `<small style="display:block;font-weight:400;color:var(--muted);font-size:12px;text-align:right">${esc(pos.detail)}</small>` : ""}</span></a>`).join("");
  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-top:16px">
      ${photo ? `<img class="bd-thumb" src="${esc(photo)}" alt="" style="width:52px;height:52px">` : ""}
      <div><div style="font-size:19px;font-weight:700">${esc(m.name)}</div>
      <div>${groupChip(m.group)}${m.gen ? `<span class="tag">${esc(m.gen)}期</span>` : ""}${m.graduated ? `<span class="tag">卒業</span>` : ""}</div></div>
    </div>
    <div class="fh-summary">
      <span class="fh-stat">参加曲<b>${items.length}曲</b></span>
      <span class="fh-stat">フロント<b>${fronts}回</b></span>
      <span class="fh-stat">センター<b>${centers}曲</b></span>
      ${items.length ? `<span class="fh-stat">初参加曲<b style="font-size:15px">${esc(items[0].song.title)}</b></span>` : ""}
    </div>
    ${items.length ? `<div class="bd-list">${rows}</div>` : `<p style="color:var(--muted)">フォーメーションが登録されている参加曲がありません。</p>`}`;
  const url = new URL(location.href);
  url.searchParams.set("member", name);
  history.replaceState(null, "", url);
}
async function init() {
  const [members, songs, formations, photos] = await Promise.all([
    loadJSON("members.json"), loadJSON("songs.json"), loadJSON("formations.json"), loadJSON("member-photos.json")]);
  FH_MEMBERS = members || [];
  FH_SONGS = songs || [];
  FH_FORM = formations || {};
  FH_PHOTOS = photos || {};
  const input = document.getElementById("fhQuery");
  attachSuggest(input, q => {
    const nq = kanaNorm(q.trim().toLowerCase());
    if (!nq) return [];
    return FH_MEMBERS.filter(m => kanaNorm((m.name + " " + (m.reading || "")).toLowerCase()).includes(nq))
      .slice(0, 8).map(m => ({ label: m.name, sub: `${m.group}${m.gen ? " " + m.gen + "期" : ""}` }));
  }, (item) => { input.value = item.label; fhRender(item.label); });
  const pre = new URLSearchParams(location.search).get("member");
  if (pre && FH_MEMBERS.some(m => m.name === pre)) { input.value = pre; fhRender(pre); }
}
init();
