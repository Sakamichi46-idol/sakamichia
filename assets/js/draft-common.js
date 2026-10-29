// ドラフト共通：旧『坂道日和』ドラフトのエンジンが期待するグローバルデータを、
// サカミチアのJSONから組み立てる（名簿・写真・条件メタ・在籍期間）。
// 使い方：await DraftData.load() のあとにエンジン群（draft-engine.js 等）を読み込む。
window.DraftData = (function () {
  let promise = null;
  function load() {
    if (promise) return promise;
    promise = (async () => {
      const [roster, photos, meta, timeline] = await Promise.all([
        loadJSON("draft-members.json"), loadJSON("member-photos.json"),
        loadJSON("member-meta.json"), loadJSON("draft-timeline.json")]);
      const list = Array.isArray(roster) ? roster : [];
      window.SakamichiMembersData = list;
      const byName = new Map(list.map(m => [m.name, m]));
      const soloMeta = {};
      for (const [name, v] of Object.entries(meta || {})) {
        const m = byName.get(name);
        if (!m) continue;
        const rec = {};
        if (Array.isArray(v.b)) rec.birthday = v.b;
        if (v.home) rec.hometown = v.home;
        if (rec.birthday || rec.hometown) soloMeta[m.id] = rec;
      }
      window.SakamichiSoloMeta = soloMeta;
      window.SakamichiDraftTimeline = timeline || { version: 1, ready: false, members: {} };
      const photoById = {};
      for (const m of list) {
        const f = (photos || {})[m.name];
        if (f) photoById[m.id] = BASE + "assets/member-photos/" + f;
      }
      window.DraftPhotoById = photoById;
      window.DraftMemberById = new Map(list.map(m => [m.id, m]));
      return list;
    })();
    return promise;
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  return { load, loadScript };
})();
