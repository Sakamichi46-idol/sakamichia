// お知らせ：3グループ公式サイトのお知らせを横断表示（data/news.json、tools/fetch_news.py が定期取得）
const NW_GROUPS = ["乃木坂46", "櫻坂46", "日向坂46"];
let NW = [], nwGroup = "all", nwQuery = "";
const NWCATS = new Set();   // カテゴリの複数選択プルダウン（選択同士は OR、空＝すべて）
let catMS = null;
const WD = ["日", "月", "火", "水", "木", "金", "土"];
function nwDateLabel(d) {
  const dt = new Date(d + "T00:00:00+09:00");
  const [y, m, dd] = d.split("-");
  return { big: `${+m}/${+dd}`, small: `${y}（${WD[dt.getDay()]}）` };
}
function nwRow(it) {
  const dl = nwDateLabel(it.d);
  return `<a class="nw-row" href="${esc(it.url)}" target="_blank" rel="noopener">
    <span class="nw-date"><b>${dl.big}</b>${dl.small}</span>
    <span class="nw-main"><span class="nw-meta">${groupChip(it.g)}${it.c ? `<span class="nw-cat">${esc(it.c)}</span>` : ""}${it.t ? `<span class="nw-cat">${esc(it.t)}</span>` : ""}</span>
    <span class="nw-title">${esc(it.title)}</span></span></a>`;
}
const NW_PAGE = 120;
let nwShown = NW_PAGE;
function render() {
  const list = NW.filter(it =>
    (nwGroup === "all" || it.g === nwGroup)
    && (!NWCATS.size || NWCATS.has(it.c))
    && (!nwQuery || it.title.includes(nwQuery)));
  document.getElementById("nwCount").textContent = `${list.length}件`;
  const more = list.length > nwShown
    ? `<p style="text-align:center;margin:16px 0 40px"><button type="button" class="btn" id="nwMore">もっと見る（残り${list.length - nwShown}件）</button></p>` : "";
  document.getElementById("nwList").innerHTML =
    list.slice(0, nwShown).map(nwRow).join("") + more || `<p style="color:var(--muted)">条件に合うお知らせがありません。</p>`;
  const mb = document.getElementById("nwMore");
  if (mb) mb.addEventListener("click", () => { nwShown += NW_PAGE; render(); });
}
function syncCats() {
  // 選択肢は表示中グループのカテゴリだけにし、無くなったカテゴリの選択は自動で外す（MS 側で剪定される）
  const cats = [...new Set(NW.filter(it => nwGroup === "all" || it.g === nwGroup).map(it => it.c).filter(Boolean))];
  if (catMS) catMS.setOptions(cats.map(c => ({ value: c, label: c })));
}
async function init() {
  const data = await loadJSON("news.json");
  NW = (data && data.items) || [];
  const chips = document.getElementById("nwGroups");
  chips.innerHTML = ["all", ...NW_GROUPS].map(g =>
    `<button type="button" class="ychip${nwGroup === g ? " on" : ""}" data-g="${g}">${g === "all" ? "すべてのグループ" : g}</button>`).join("");
  chips.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    nwGroup = b.dataset.g;
    chips.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    nwShown = NW_PAGE;
    syncCats(); render();
  }));
  catMS = createMultiSelect(document.getElementById("nwCatMS"), {
    allLabel: "すべてのカテゴリ", selected: NWCATS, ariaLabel: "カテゴリ",
    options: [], onChange: () => { nwShown = NW_PAGE; render(); }
  });
  document.getElementById("nwQuery").addEventListener("input", e => { nwQuery = e.target.value.trim(); nwShown = NW_PAGE; render(); });
  // 検索サジェスト：お知らせのタイトルとカテゴリから候補を出す
  attachSuggest(document.getElementById("nwQuery"), q => {
    const hits = t => kanaNorm(String(t || "").toLowerCase()).includes(kanaNorm(q.toLowerCase()));
    const items = [], seen = new Set();
    for (const it of NW) {
      if (items.length >= 5) break;
      if (hits(it.title) && !seen.has(it.title)) { seen.add(it.title); items.push({ kind: "お知らせ", cls: "live", label: it.title, sub: it.d || "" }); }
    }
    [...new Set(NW.map(it => it.c).filter(Boolean))].filter(c => hits(c)).slice(0, 3)
      .forEach(c => items.push({ kind: "カテゴリ", cls: "song", label: c, sub: "カテゴリ" }));
    return items;
  }, (it, input) => { input.value = it.label; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus(); });
  // 条件をリセット：グループ・カテゴリ・キーワードをすべて初期状態に戻す
  document.getElementById("nwReset").addEventListener("click", () => {
    nwGroup = "all"; NWCATS.clear(); nwQuery = "";
    document.getElementById("nwQuery").value = "";
    chips.querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.g === "all"));
    syncCats();
    render();
  });
  syncCats();
  render();
}
init();
