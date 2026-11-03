// 公式リンク集：data/links.json（グループ公式／メンバーのSNS／写真集アカウント）を描画する
// 収録基準：各グループの公式サイトや公式の告知で案内されているリンクだけ
// リンクボタンの表示は全セクション共通形式：SNSは「プラットフォーム名 @ハンドル ↗」（lkBtn／lkHandle）、カテゴリ系はラベルのみ
// メンバーのSNSは現役がInstagramのみ。卒業生はInstagramに加えてX・YouTubeもあり得る（graduated: true、x / youtube フィールド）
let LK = null, lkGroup = "", lkQ = "", lkActiveOnly = false;
const LK_VAR = { "乃木坂46": "var(--n)", "櫻坂46": "var(--s)", "日向坂46": "var(--h)", "欅坂46": "var(--k)", "けやき坂46": "var(--h)" };

function lkHead(text, group) {
  return `<h3 class="home-ghead" style="border-left:5px solid ${LK_VAR[group] || "var(--line)"};padding-left:8px">${esc(text)}</h3>`;
}
// SNSアカウントのハンドルをURLから機械的に取り出す。取り出せる形式（instagram.com/<名前>、
// x.com/<名前>、facebook.com/<名前>、tiktok.com/@<名前>、youtube.com/@<名前>）以外は "" を返し、
// プラットフォーム名だけのボタンにする（YouTubeのチャンネルID形式、LINEの短縮URLなど）
function lkHandle(url) {
  let u;
  try { u = new URL(url); } catch (e) { return ""; }
  const host = u.hostname.replace(/^(www|m)\./, "");
  const seg = u.pathname.split("/").filter(Boolean);
  if (!seg.length) return "";
  if (host === "instagram.com" || host === "x.com" || host === "twitter.com" || host === "facebook.com") {
    const reserved = ["p", "reel", "reels", "stories", "explore", "accounts", "direct", "home", "search", "notifications", "messages", "settings", "i", "profile.php"];
    return reserved.includes(seg[0]) ? "" : seg[0].replace(/^@/, "");
  }
  if (host === "tiktok.com" || host === "youtube.com")
    return seg[0].startsWith("@") ? seg[0].slice(1) : "";
  return "";
}
// 全セクション共通のリンクボタン：SNSは「プラットフォーム名 @ハンドル ↗」、カテゴリ系はラベルのみ。
// ハンドルが付くかどうかは lkHandle がURLのドメインで判定するので、公式サイト等のリンクは自動的にラベルのみになる
function lkBtn(label, url) {
  if (!url) return "";
  const h = lkHandle(url);
  return `<a class="btn sub" href="${esc(url)}" target="_blank" rel="noopener">${esc(label + (h ? " @" + h : ""))} ↗</a>`;
}
function lkOfficialHtml() {
  const blocks = (LK.groups || []).filter(b => !lkGroup || b.group === lkGroup).map(b => `
    <section>${lkHead(b.group, b.group)}
    <div class="lk-btns">${b.links.map(l => lkBtn(l.label, l.url)).join("")}</div></section>`).join("");
  return blocks ? `<h3 class="home-ghead">グループ公式</h3>${blocks}` : "";
}
function lkIgHtml() {
  const q = kanaNorm(lkQ.trim());
  const rows = (LK.memberInstagram || []).filter(m => (!lkGroup || m.group === lkGroup) &&
    (!lkActiveOnly || !m.graduated) &&
    (!q || kanaNorm(m.name).includes(q) || kanaNorm(m.reading || "").includes(q) ||
      [m.url, m.x, m.youtube].some(u => u && kanaNorm(u).includes(q))));
  if (!rows.length) return "";
  const byGroup = {};
  rows.forEach(m => { (byGroup[m.group] = byGroup[m.group] || []).push(m); });
  const body = Object.keys(byGroup).map(g => `${lkHead(g, g)}<div class="grid">${byGroup[g].map(m => `
    <div class="card">${groupChip(m.group)}<h3>${esc(m.name)}${m.graduated ? `<span class="badge">卒業生</span>` : ""}</h3>
    <div class="lk-btns">${lkBtn("Instagram", m.url)}${lkBtn("X", m.x)}${lkBtn("YouTube", m.youtube)}</div></div>`).join("")}</div>`).join("");
  return `<h3 class="home-ghead">メンバーのSNS（${rows.length}人）</h3>${body}`;
}
function lkBooksHtml() {
  const q = kanaNorm(lkQ.trim());
  const rows = (LK.photobooks || []).filter(b => (!lkGroup || b.group === lkGroup) &&
    (!q || kanaNorm(b.member).includes(q) || kanaNorm(b.reading || "").includes(q) || kanaNorm(b.title).includes(q)));
  if (!rows.length) return "";
  return `<h3 class="home-ghead">写真集の公式アカウント（${rows.length}件）</h3><div class="grid">${rows.map(b => `
    <div class="card">${groupChip(b.group)}<h3>${esc(b.title)}</h3><p>${esc(b.member)}${b.year ? ` ・ ${esc(String(b.year))}年` : ""}</p>
    <div class="lk-btns">${lkBtn("X", b.x)}${lkBtn("Instagram", b.instagram)}${lkBtn("TikTok", b.tiktok)}</div></div>`).join("")}</div>`;
}
function render() {
  if (!LK) return;
  document.getElementById("lkOfficial").innerHTML = lkOfficialHtml();
  document.getElementById("lkIg").innerHTML = lkIgHtml();
  document.getElementById("lkBooks").innerHTML = lkBooksHtml();
  const ig = (LK.memberInstagram || []).length, bk = (LK.photobooks || []).length;
  document.getElementById("lkCount").textContent = `メンバーのSNS ${ig}人 ・ 写真集アカウント ${bk}件を収録`;
  if (!lkOfficialHtml() && !lkIgHtml() && !lkBooksHtml())
    document.getElementById("lkOfficial").innerHTML = `<div class="empty">条件に合うリンクがありません。</div>`;
}
async function init() {
  LK = await loadJSON("links.json");
  const chips = [["", "すべて"], ["乃木坂46", "乃木坂46"], ["櫻坂46", "櫻坂46"], ["日向坂46", "日向坂46"], ["欅坂46", "欅坂46"]];
  const box = document.getElementById("lkChips");
  box.innerHTML = chips.map(([v, t]) => `<button type="button" class="ychip${v === lkGroup ? " on" : ""}" data-g="${esc(v)}">${esc(t)}</button>`).join("");
  box.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
    lkGroup = b.dataset.g;
    box.querySelectorAll("button[data-g]").forEach(x => x.classList.toggle("on", x === b));
    render();
  }));
  const gt = document.createElement("button");
  gt.type = "button"; gt.className = "ychip"; gt.id = "lkActiveOnly"; gt.textContent = "現役のみ";
  gt.addEventListener("click", () => { lkActiveOnly = !lkActiveOnly; gt.classList.toggle("on", lkActiveOnly); render(); });
  box.appendChild(gt);
  document.getElementById("lkQ").addEventListener("input", e => { lkQ = e.target.value; render(); });
  render();
}
init();
