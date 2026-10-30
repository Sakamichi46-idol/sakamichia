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
      // 並び順はメンバーページ（members.js）と統一する：系統→期→五十音（reading）。
      // 系統は改名をまたぎ、所属歴から ERA_RANK で決めた「最後の所属」で判定する
      // （nogi=乃木坂系統、keyaki/sakura=櫻坂系統、hiragana/hinata=日向坂系統）。
      // 期なし・0期は members.js の genKey と同じく系統内の最後尾（99）。
      const ERA_RANK = { nogi: 0, hiragana: 1, keyaki: 2, sakura: 3, hinata: 3 };
      const FAMILY_RANK = { nogi: 0, keyaki: 1, sakura: 1, hiragana: 2, hinata: 2 };
      const lastGroupId = (m) => {
        const gs = (m.groups && m.groups.length) ? m.groups : [m.group];
        let best = m.group, br = -1;
        for (const g of gs) { const r = (g in ERA_RANK) ? ERA_RANK[g] : 0; if (r > br) { br = r; best = g; } }
        return best;
      };
      list.sort((a, b) =>
        (FAMILY_RANK[lastGroupId(a)] ?? 3) - (FAMILY_RANK[lastGroupId(b)] ?? 3) ||
        (a.generation > 0 ? a.generation : 99) - (b.generation > 0 ? b.generation : 99) ||
        String(a.reading || a.name).localeCompare(String(b.reading || b.name), "ja"));
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
