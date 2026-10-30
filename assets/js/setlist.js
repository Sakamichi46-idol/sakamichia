// マイセットリスト：旧サイト『坂道日和』の作り方を移植。
// 楽曲候補（検索・グループ・並び替え）＋進行情報（MC・影ナレ・アンコール等）＋
// センター/参加メンバーの編集（原曲データから入力可）＋表示設定＋プレビュー＋
// 画像保存・共有/コピー/テキスト保存。内容は localStorage に自動保存。
'use strict';
const $ = id => document.getElementById(id);
const MIXED = ['坂道AKB', '坂道選抜'];
const groupMatches = (s, g) => g === 'all' || s.group === g
  || (g === 'mixed' && MIXED.includes(s.group))
  || (g === 'collab' && s.group === '坂道AKB')
  || (g === 'selection' && s.group === '坂道選抜');
const KEY = 'sakamichia-setlist-v1', OLD = 'sb-setlist';
const SHOW = ['title', 'number', 'song', 'group', 'center', 'members', 'composer', 'arranger', 'release', 'mc', 'kagenare', 'overture', 'encore', 'interlude', 'custom', 'people', 'note'];
const DEFAULT = { title: true, number: true, song: true, group: false, center: true, members: true, composer: false, arranger: false, release: false, mc: true, kagenare: true, overture: true, encore: true, interlude: true, custom: true, people: true, note: false };
const TYPE = { mc: 'MC', kagenare: '影ナレ', overture: 'OVERTURE', encore: 'ENCORE', double: 'W ENCORE', interlude: '幕間', custom: '区切り・メモ' };
const EVENT_LABEL = { mc: 'MC', kagenare: '影ナレ', overture: 'OVERTURE', encore: 'ENCORE', double: 'W ENCORE', interlude: '幕間', custom: '区切り' };
const m = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const identifier = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2));
const safeText = (v, n = 250) => String(v || '').slice(0, n);
const openCreditFields = new Set();
let imageMode = 'compact';
let songs = [], songById = new Map(), ORIGINALS = new Map();
let items = [], settings = { ...DEFAULT }, name = 'MY SETLIST', numberMode = 'section';

// --- 参加メンバーの表記（旧サイト setlist-cast-format の移植） ---
function castDescribe(value) {
  const raw = String(value || '').trim();
  if (!raw) return { names: [], count: 0, short: '', full: '', collapsed: false };
  const isLabel = /^(?:全員|[一二三四五六七八九1-9]+期生?(?:（\d+人）)?|選抜メンバー(?:（\d+人）)?|アンダーメンバー(?:（\d+人）)?)$/u.test(raw);
  if (isLabel) return { names: [], count: 0, short: raw, full: raw, collapsed: false };
  const names = [...new Set(raw.split(/[・、,，;；\n]+/u).map(x => x.trim()).filter(Boolean))];
  const full = names.join('・');
  return { names, count: names.length, short: names.length > 5 ? `${names.length}人` : full, full, collapsed: names.length > 5 };
}

// --- 保存・読み込み ---
function normalise(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.type === 'song' && typeof entry.songId === 'string')
    return { id: safeText(entry.id || identifier(), 90), type: 'song', songId: entry.songId, center: safeText(entry.center, 120), people: safeText(entry.people, 1500) };
  if (entry.type === 'event' && TYPE[entry.event])
    return { id: safeText(entry.id || identifier(), 90), type: 'event', event: entry.event, label: safeText(entry.label, 100), people: safeText(entry.people, 140), note: safeText(entry.note, 400) };
  return null;
}
function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.items)) {
      items = data.items.slice(0, 300).map(normalise).filter(Boolean);
      name = safeText(data.name, 90) || 'MY SETLIST';
      settings = { ...DEFAULT, ...(data.settings || {}) };
      numberMode = data.numberMode === 'continuous' ? 'continuous' : 'section';
      return;
    }
  } catch (e) {}
  // 旧ミニ版（sb-setlist）からの引き継ぎ
  try {
    const old = JSON.parse(localStorage.getItem(OLD) || '[]');
    items = (Array.isArray(old) ? old : []).map(en => {
      if (en && en.kind === 'song') {
        const s = songs.find(x => x.title === en.title && x.group === en.group) || songs.find(x => x.title === en.title);
        return s ? { id: identifier(), type: 'song', songId: s.id, center: '', people: '' } : null;
      }
      if (en && en.kind === 'marker') {
        const ev = /MC/.test(en.label) ? 'mc' : /アンコール/.test(en.label) ? 'encore' : /OVERTURE/.test(en.label) ? 'overture' : 'custom';
        return { id: identifier(), type: 'event', event: ev, label: '', people: '', note: '' };
      }
      return null;
    }).filter(Boolean);
  } catch (e) { items = []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, items, name, settings, numberMode })); }
  catch (e) { notify('ブラウザに保存できませんでした。', true); }
}

// --- 過去ライブからの取り込み（歴代ライブの「マイセットリストで編集」） ---
const IMPORT_KEY = 'sakamichia-setlist-import';
let pendingImport = null;
function convertImport(payload) {
  const byTitle = new Map();
  for (const s of songs) { if (!byTitle.has(s.title)) byTitle.set(s.title, s); }
  const out = [];
  let songsN = 0, otherN = 0, prevSec = 'main';
  for (const r of (payload.rows || [])) {
    const sec = r.sec || 'main';
    if (sec !== prevSec) {
      if (sec === 'encore') out.push({ id: identifier(), type: 'event', event: 'encore', label: '', people: '', note: '' });
      else if (sec === 'double') out.push({ id: identifier(), type: 'event', event: 'double', label: '', people: '', note: '' });
      prevSec = sec;
    }
    const song = byTitle.get(r.title);
    if (song) {
      out.push({ id: identifier(), type: 'song', songId: song.id,
        center: safeText(r.center || '', 120),
        people: safeText((Array.isArray(r.perf) ? r.perf : []).join('、'), 1500) });
      songsN++;
    } else {
      // 楽曲データに無い曲（カバー曲など）は、消さずにメモとして残す
      const notes = [];
      if (r.center) notes.push('センター：' + r.center);
      if (Array.isArray(r.perf) && r.perf.length) notes.push('参加：' + r.perf.join('、'));
      if (r.remark) notes.push(r.remark);
      out.push({ id: identifier(), type: 'event', event: 'custom', label: safeText(r.title || '', 100), people: '', note: safeText(notes.join(' / '), 400) });
      otherN++;
    }
  }
  return { items: out, songsN, otherN };
}
function applyImport(mode) {
  if (!pendingImport) return;
  const conv = convertImport(pendingImport);
  if (mode === 'append') {
    items = items.concat(conv.items).slice(0, 300);
  } else {
    items = conv.items.slice(0, 300);
    name = safeText(pendingImport.name, 90) || name;
  }
  save();
  renderSettings();
  render();
  notify(`「${pendingImport.name}」のセットリストを取り込みました（曲${conv.songsN}件${conv.otherN ? `／楽曲データに無い${conv.otherN}件はメモとして追加` : ''}）`);
  pendingImport = null;
}
function checkImport() {
  let payload = null;
  try { payload = JSON.parse(localStorage.getItem(IMPORT_KEY) || 'null'); } catch (e) {}
  if (!payload || !Array.isArray(payload.rows) || !payload.rows.length) return;
  try { localStorage.removeItem(IMPORT_KEY); } catch (e) {}
  pendingImport = payload;
  if (!items.length) { applyImport('replace'); return; }
  const dlg = $('msImportDlg');
  if (dlg && dlg.showModal) {
    $('msImportText').textContent = `「${payload.name}」（${payload.date || ''}）のセットリスト全${payload.rows.length}曲を取り込みます。今のマイセットリスト（${items.length}件）はどうしますか？`;
    dlg.showModal();
  } else if (confirm(`「${payload.name}」のセットリストを取り込みます。今の内容の末尾に追加しますか？（キャンセル＝置き換え）`)) {
    applyImport('append');
  } else {
    applyImport('replace');
  }
}
function notify(text, error = false) { const el = $('msMsg'); el.textContent = text; el.style.color = error ? '#c0392b' : 'var(--muted)'; }

// --- 並び替え ---
function sortSongs(list) {
  const mode = $('msSortMode').value;
  const desc = document.querySelector('input[name="ms-dir"]:checked')?.value === 'desc';
  const arr = [...list];
  if (mode === 'kana') {
    arr.sort((a, b) => (a.yomi || a.title).localeCompare(b.yomi || b.title, 'ja'));
    if (desc) arr.reverse();
    return arr;
  }
  arr.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.ord || 0) - (b.ord || 0) || (a.yomi || '').localeCompare(b.yomi || '', 'ja'));
  if (!desc) return arr;
  // 新しい順：作品（発売日＋リリース）単位で逆順にし、作品内の収録順は維持
  const runs = [];
  for (const s of arr) {
    const key = (s.date || '') + '|' + (s.release || '') + '|' + s.group;
    if (runs.length && runs[runs.length - 1].key === key) runs[runs.length - 1].items.push(s);
    else runs.push({ key, items: [s] });
  }
  return runs.reverse().flatMap(r => r.items);
}

// --- 初期化 ---
async function init() {
  const [songsData, formations] = await Promise.all([loadJSON('songs.json'), loadJSON('formations.json')]);
  songs = Array.isArray(songsData) ? songsData : (songsData.songs || []);
  songById = new Map(songs.map(s => [s.id, s]));
  for (const s of songs) {
    const f = formations[s.group + '|' + s.title];
    let members = [];
    if (f && Array.isArray(f.rows)) members = [...new Set(f.rows.flat())];
    else if (f && Array.isArray(f.vocal)) members = [...f.vocal];
    ORIGINALS.set(s.id, { centers: s.center ? s.center.split('・') : [], members });
  }
  load();
  bind();
  renderSettings();
  render();
  checkImport();
}
function getSong(entry) { return songById.get(entry.songId) || { id: entry.songId, title: entry.songId, group: '', writers: [], arrangers: [] }; }

// --- 番号付けと行の説明 ---
function indexLabel(number, section, enc, wen) {
  if (!settings.number) return '';
  if (numberMode === 'continuous') return 'M' + number;
  if (section === 'encore') return 'EN' + enc;
  if (section === 'double') return 'WEN' + wen;
  return 'M' + (number - enc - wen);
}
function describe(list = items) {
  let section = 'main', count = 0, enc = 0, wen = 0, mc = 0;
  return list.map((entry, pos) => {
    if (entry.type === 'event') {
      if (entry.event === 'encore') section = 'encore';
      if (entry.event === 'double') section = 'double';
      if (entry.event === 'mc') mc++;
      return { entry, pos, label: entry.label || (entry.event === 'mc' ? 'MC' + mc : TYPE[entry.event]), kind: 'event' };
    }
    count++;
    if (section === 'encore') enc++;
    if (section === 'double') wen++;
    return { entry, pos, song: getSong(entry), label: indexLabel(count, section, enc, wen), kind: 'song' };
  });
}
function eventVisible(x) { return x.event === 'double' ? settings.encore : settings[x.event] !== false; }
function previewRows() {
  const out = [];
  if (settings.title && name) out.push({ type: 'title', text: name });
  for (const d of describe()) {
    if (d.kind === 'event') {
      if (!eventVisible(d.entry)) continue;
      out.push({ type: 'event', text: d.label, people: settings.people ? d.entry.people : '', note: settings.note ? d.entry.note : '' });
      continue;
    }
    const s = d.song, entry = d.entry, meta = [];
    const center = settings.center ? entry.center.trim() : '';
    const members = settings.members ? castDescribe(entry.people) : castDescribe('');
    if (settings.group && s.group) meta.push(s.group);
    if (settings.composer && (s.writers || []).length) meta.push('作曲：' + s.writers.join('・'));
    if (settings.arranger && (s.arrangers || []).length) meta.push('編曲：' + s.arrangers.join('・'));
    if (settings.release && s.release) meta.push(s.release);
    out.push({ type: 'song', number: d.label, title: settings.song ? s.title : '？？？？？', center, members, meta });
  }
  return out;
}

// --- 描画：候補 ---
function renderCandidates() {
  const q = $('msSearch').value.trim().toLocaleLowerCase(), g = $('msGroup').value;
  const list = sortSongs(songs.filter(s => groupMatches(s, g)
    && (!q || [s.title, s.yomi || '', ...(s.writers || []), ...(s.arrangers || [])].join(' ').toLocaleLowerCase().includes(q))));
  $('msCount').textContent = `${list.length}曲を表示（全${songs.length}曲）`;
  const host = $('msCandidates');
  host.replaceChildren();
  for (const s of list) {
    const b = m('button', 'ms-song');
    b.type = 'button';
    b.append(m('strong', '', s.title), m('small', '', `${s.group}${s.date ? ' · ' + s.date : ''}${s.release ? ' · ' + s.release : ''}`));
    b.addEventListener('click', () => addSong(s.id));
    host.append(b);
  }
  if (!list.length) host.append(m('p', 'ms-help', '該当する楽曲はありません。'));
}
function addSong(id) {
  if (items.filter(x => x.type === 'song').length >= 150) { notify('楽曲は150曲まで追加できます。', true); return; }
  items.push({ id: identifier(), type: 'song', songId: id, center: '', people: '' });
  save(); renderEditor(); renderPreview();
}
function addEvent(type) {
  if (items.length >= 300) { notify('追加できる行数の上限に達しました。', true); return; }
  items.push({ id: identifier(), type: 'event', event: type, label: '', people: '', note: '' });
  save(); renderEditor(); renderPreview();
}
function move(index, delta) {
  const j = index + delta;
  if (j < 0 || j >= items.length) return;
  [items[index], items[j]] = [items[j], items[index]];
  save(); renderEditor(); renderPreview();
}
function makeButton(text, onClick, label) {
  const b = m('button', 'ms-small', text);
  b.type = 'button';
  b.setAttribute('aria-label', label || text);
  b.addEventListener('click', onClick);
  return b;
}
function field(label, value, onChange, placeholder = '') {
  const wrap = m('label', 'ms-field');
  if (label) wrap.append(m('span', '', label));
  const el = m('input');
  el.type = 'text'; el.value = value || ''; el.placeholder = placeholder; el.maxLength = 400;
  el.addEventListener('input', () => onChange(el.value));
  wrap.append(el);
  return wrap;
}
function creditEditor(entry, kind, label, placeholder, originalNames) {
  const fieldKey = entry.id + ':' + kind;
  const prop = kind === 'center' ? 'center' : 'people';
  const value = entry[prop];
  const block = m('div', 'ms-credit' + ((value || openCreditFields.has(fieldKey)) ? ' is-open' : ''));
  if (!value && !openCreditFields.has(fieldKey)) {
    block.append(makeButton('＋ ' + label + 'を追加', () => { openCreditFields.add(fieldKey); renderEditor(); }, label + 'を追加'));
    return block;
  }
  const controls = m('div', 'ms-credit-head');
  controls.append(m('span', '', label));
  controls.append(makeButton('削除', () => { entry[prop] = ''; openCreditFields.delete(fieldKey); save(); renderEditor(); renderPreview(); }, label + 'を削除'));
  block.append(controls);
  block.append(field('', value, v => { entry[prop] = safeText(v, kind === 'center' ? 120 : 1500); save(); renderPreview(); }, placeholder));
  if (originalNames.length) block.append(makeButton('原曲の' + label + 'を入力', () => {
    entry[prop] = safeText(originalNames.join('・'), kind === 'center' ? 120 : 1500);
    openCreditFields.add(fieldKey); save(); renderEditor(); renderPreview();
  }, '図鑑に登録されている' + label + 'を入力'));
  return block;
}

// --- 描画：編集リスト ---
function renderEditor() {
  const host = $('msSelected');
  host.replaceChildren();
  $('msTotal').textContent = items.filter(x => x.type === 'song').length + '曲';
  if (!items.length) { host.append(m('p', 'ms-help', '左の楽曲一覧から追加するか、進行情報を挿入してください。')); return; }
  for (const d of describe()) {
    const entry = d.entry, i = d.pos;
    const row = m('div', 'ms-row ' + (entry.type === 'event' ? 'is-event' : 'is-song'));
    const head = m('div', 'ms-row-head');
    if (entry.type === 'song') head.append(m('span', 'ms-num', d.label || String(i + 1)), m('strong', '', d.song.title));
    else head.append(m('span', 'ms-num', '·'), m('strong', '', d.label));
    const actions = m('div', 'ms-row-actions');
    actions.append(
      makeButton('↑', () => move(i, -1), '上へ移動'),
      makeButton('↓', () => move(i, 1), '下へ移動'),
      makeButton('×', () => { items.splice(i, 1); openCreditFields.delete(entry.id + ':center'); openCreditFields.delete(entry.id + ':people'); save(); renderEditor(); renderPreview(); }, 'この行を削除'));
    head.append(actions);
    row.append(head);
    if (entry.type === 'song') {
      const orig = ORIGINALS.get(entry.songId) || { centers: [], members: [] };
      const credits = m('div', 'ms-credits');
      credits.append(creditEditor(entry, 'center', 'センター', '例：小坂菜緒・金村美玖', orig.centers));
      credits.append(creditEditor(entry, 'people', '参加メンバー', '例：金村美玖・河田陽菜・小坂菜緒', orig.members));
      row.append(credits);
    } else {
      const detail = m('div', 'ms-details');
      detail.append(field('表示名', entry.label, v => { entry.label = safeText(v, 100); save(); renderPreview(); }, EVENT_LABEL[entry.event]));
      if (entry.event === 'mc' || entry.event === 'kagenare')
        detail.append(field('担当メンバー', entry.people, v => { entry.people = safeText(v, 140); save(); renderPreview(); }, '複数人も入力可能'));
      detail.append(field('内容・メモ', entry.note, v => { entry.note = safeText(v, 400); save(); renderPreview(); }, '任意'));
      row.append(detail);
    }
    host.append(row);
  }
}

// --- 描画：プレビュー ---
function renderPreview() {
  const host = $('msPreview');
  host.replaceChildren();
  for (const row of previewRows()) {
    if (row.type === 'title') { host.append(m('h3', 'ms-pv-title', row.text)); continue; }
    if (row.type === 'event') {
      const line = m('div', 'ms-pv-event' + (['ENCORE', 'W ENCORE'].includes(row.text) ? ' is-section' : ''));
      line.append(m('span', '', row.text));
      if (row.people) line.append(m('small', '', '担当：' + row.people));
      if (row.note) line.append(m('small', '', row.note));
      host.append(line);
      continue;
    }
    const line = m('div', 'ms-pv-song');
    if (row.number) line.append(m('span', 'ms-pv-num', row.number));
    const content = m('div', 'ms-pv-content'), head = m('div', 'ms-pv-head');
    head.append(m('strong', '', row.title));
    if (row.center) head.append(m('span', 'ms-pv-center', 'C：' + row.center));
    if (row.members.collapsed) {
      const det = m('details', 'ms-pv-cast');
      det.append(m('summary', '', row.members.short), m('div', 'ms-pv-names', row.members.full));
      head.append(det);
    }
    content.append(head);
    if (row.members.full && !row.members.collapsed) content.append(m('div', 'ms-pv-castline', row.members.short));
    for (const meta of row.meta) content.append(m('p', 'ms-pv-meta', meta));
    line.append(content);
    host.append(line);
  }
  if (!items.length) host.append(m('p', 'ms-help', '曲や進行情報を追加すると、ここに表示されます。'));
}
function renderSettings() {
  for (const id of SHOW) { const e = $('show-' + id); if (e) e.checked = !!settings[id]; }
  $('msName').value = name;
  $('msNumberMode').value = numberMode;
}
function render() { renderCandidates(); renderEditor(); renderPreview(); }
function setlistText() {
  return previewRows().map(x => {
    if (x.type === 'title') return x.text + '\n';
    if (x.type === 'event') return x.text + (x.people ? '　担当：' + x.people : '') + (x.note ? '　' + x.note : '');
    return (x.number ? x.number + '　' : '') + x.title + (x.center ? '　C：' + x.center : '') + (x.members.full ? '　' + x.members.full : '') + (x.meta.length ? '　' + x.meta.join(' / ') : '');
  }).join('\n');
}

// --- 画像 ---
async function imageBlob() {
  const raw = previewRows();
  if (!raw.some(r => r.type === 'song' || r.type === 'event')) throw new Error('保存する曲・進行情報がありません。');
  const heading = (raw.find(r => r.type === 'title') || {}).text || '';
  const result = await window.SakamichiSetlistImageExport.create(raw, { title: heading }, { mode: imageMode, hideTitle: !settings.title });
  if (result.layout && result.layout.overflow) notify('すべて1枚に収めましたが、情報量が多く文字が小さくなっています。表示設定で補足情報を減らすと読みやすくなります。');
  return result.blob;
}
function closePreview() {
  const d = $('msDlg');
  if (d.open) d.close();
  const img = $('msDlgImg');
  if (img.dataset.url) { URL.revokeObjectURL(img.dataset.url); img.dataset.url = ''; }
}
async function openImagePreview() {
  try {
    const b = await imageBlob(), src = URL.createObjectURL(b), img = $('msDlgImg');
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.src = src; img.dataset.url = src;
    $('msDlg').showModal();
  } catch (e) { notify(e.message, true); }
}
async function downloadImage() {
  try {
    const blob = await imageBlob(), src = URL.createObjectURL(blob), a = m('a');
    a.href = src; a.download = 'sakamichia-setlist.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(src), 3000);
  } catch (e) { notify(e.message, true); }
}
async function shareImage() {
  try {
    const blob = await imageBlob(), file = new File([blob], 'sakamichia-setlist.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: '自分で作った坂道セットリスト！\nhttps://sakamichia.pages.dev/setlist/' });
      return;
    }
    notify('このブラウザでは画像共有に対応していません。画像をダウンロードして共有してください。');
  } catch (e) { if (e.name !== 'AbortError') notify('共有できませんでした。画像ダウンロードをお試しください。', true); }
}

// --- イベント登録 ---
function bind() {
  const impDlg = $('msImportDlg');
  if (impDlg) {
    $('msImportReplace').addEventListener('click', () => { impDlg.close(); applyImport('replace'); });
    $('msImportAppend').addEventListener('click', () => { impDlg.close(); applyImport('append'); });
    $('msImportCancel').addEventListener('click', () => { impDlg.close(); pendingImport = null; notify('取り込みをやめました'); });
  }
  $('msSearch').addEventListener('input', renderCandidates);
  $('msGroup').addEventListener('change', renderCandidates);
  $('msSortMode').addEventListener('change', renderCandidates);
  document.querySelectorAll('input[name="ms-dir"]').forEach(r => r.addEventListener('change', renderCandidates));
  $('msName').addEventListener('input', e => { name = safeText(e.target.value, 90); save(); renderPreview(); });
  $('msNumberMode').addEventListener('change', e => { numberMode = e.target.value; save(); renderEditor(); renderPreview(); });
  for (const id of SHOW) {
    const box = $('show-' + id);
    if (box) box.addEventListener('change', e => { settings[id] = e.target.checked; save(); renderPreview(); });
  }
  $('msAddEvent').addEventListener('click', () => addEvent($('msEventType').value));
  $('msReset').addEventListener('click', () => {
    if (confirm('セットリストと進行情報をすべて削除しますか？')) { items = []; save(); renderEditor(); renderPreview(); notify('最初から作り直せます。'); }
  });
  $('msCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(setlistText()); notify('表示内容をコピーしました。'); }
    catch (e) { notify('コピーできませんでした。', true); }
  });
  $('msExport').addEventListener('click', () => {
    const a = m('a');
    a.href = URL.createObjectURL(new Blob([setlistText() + '\n'], { type: 'text/plain;charset=utf-8' }));
    a.download = 'sakamichia-setlist.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('msImageMenu').addEventListener('click', () => { $('msImageActions').hidden = !$('msImageActions').hidden; });
  $('msImageMode').addEventListener('change', e => { imageMode = e.target.value === 'full' ? 'full' : 'compact'; });
  $('msImgPreviewBtn').addEventListener('click', openImagePreview);
  $('msImgDownloadBtn').addEventListener('click', downloadImage);
  $('msImgShareBtn').addEventListener('click', shareImage);
  $('msDlgClose').addEventListener('click', closePreview);
  const dlg = $('msDlg');
  dlg.addEventListener('click', e => { if (e.target === dlg) closePreview(); });
}
document.addEventListener('DOMContentLoaded', () => {
  init().catch(e => notify('初期化に失敗しました：' + (e.message || e), true));
});
