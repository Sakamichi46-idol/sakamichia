/* 坂道日和 v0.9 - フォーメーション可変列・可変人数。抽選と配置の状態を分離して管理。 */
(function (root) {
  'use strict';
  const GROUPS = [
    { id: 'nogi', label: '乃木坂46' }, { id: 'keyaki', label: '欅坂46' },
    { id: 'sakura', label: '櫻坂46' }, { id: 'hiragana', label: 'けやき坂46' },
    { id: 'hinata', label: '日向坂46' }
  ];
  // 並び順はメンバーページ（members.js）と統一：系統 -> 期別 -> メンバー名（読みの50音順）。
  // 系統は改名をまたぎ、乃木坂46 -> 櫻坂46（欅坂46を含む）-> 日向坂46（けやき坂46を含む）。
  // 系統判定は members.js と同じく、所属歴から ERA_RANK で決めた「最後の所属」を系統へ寄せる。
  // 改名前後に所属したメンバーは内部IDが1つで、一度だけ表示する。
  // 旧グループでの絞り込みは member.groups の所属履歴に対応。
  const ERA_RANK = { nogi: 0, hiragana: 1, keyaki: 2, sakura: 3, hinata: 3 };
  const FAMILY_RANK = { nogi: 0, keyaki: 1, sakura: 1, hiragana: 2, hinata: 2 };
  const lastGroupId = (m) => {
    const gs = (m.groups && m.groups.length) ? m.groups : [m.group];
    let best = m.group, br = -1;
    for (const g of gs) { const r = (g in ERA_RANK) ? ERA_RANK[g] : 0; if (r > br) { br = r; best = g; } }
    return best;
  };
  const familyRank = (m) => FAMILY_RANK[lastGroupId(m)] ?? GROUPS.length;
  // 期は members.js の genKey と同じ：期なし・0期は系統内の最後尾。
  const genKey = (m) => (m.generation > 0 ? m.generation : 99);
  const kanaKey = (m) => String(m.reading || m.name).normalize('NFKC')
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0)-0x60));
  const codepointCompare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
  // グループ指定時の整列（compareMembersForGroup）専用：0期（交換留学生）は、
  // 各グループ内で通常の1期生よりも先に並べる（従来仕様のまま）。
  const generationOrder = (m) => m.generation===0 ? -1 : m.generation;
  const compareMembers = (a,b) =>
    familyRank(a) - familyRank(b) ||
    genKey(a) - genKey(b) ||
    String(a.reading || a.name).localeCompare(String(b.reading || b.name), 'ja') ||
    codepointCompare(a.name,b.name) ||
    codepointCompare(a.id,b.id);
  const MEMBERS = Object.freeze((root.SakamichiMembersData || [])
    .map(m => Object.freeze({...m})).sort(compareMembers));
  const MEMBER_MAP = new Map(MEMBERS.map(m => [m.id, m]));
  // グループ別で検索した場合は、代表所属ではなく「選択中のグループ」を基準に整列。
  // 旧欅坂→櫻坂のように所属歴を持つ同一人物も、このグループ内の期別順で見る。
  function compareMembersForGroup(a, b, activeGroup='all') {
    if (activeGroup==='all') return compareMembers(a,b);
    return generationOrder(a) - generationOrder(b) ||
      codepointCompare(kanaKey(a),kanaKey(b)) ||
      codepointCompare(a.name,b.name) || codepointCompare(a.id,b.id);
  }

  function sortMemberIds(ids) {
    return [...ids].sort((a,b)=>{
      const ma=MEMBER_MAP.get(a),mb=MEMBER_MAP.get(b);
      return ma&&mb?compareMembers(ma,mb):ma?-1:mb?1:String(a).localeCompare(String(b),'ja');
    });
  }
  if (MEMBER_MAP.size !== MEMBERS.length || MEMBERS.some(m => !GROUPS.some(g => g.id === m.group))) {
    throw new Error('メンバーデータの形式が正しくありません。');
  }
  const memberInGroup = (member, groupId) => (member.groups || [member.group]).includes(groupId);
  const AVAILABLE_GROUPS = GROUPS.filter(g => MEMBERS.some(m => memberInGroup(m,g.id))).map(g => g.id);
  const defaultFormation = () => ({rows:[5,6,7], placement:'after', showCenter:true});
  const totalSlots = f => f.rows.reduce((a,b)=>a+b,0);
  const validFormation = f => !!f && Array.isArray(f.rows) && f.rows.length>=1 && f.rows.length<=5 &&
    f.rows.every(n => Number.isSafeInteger(n) && n>=1 && n<=12) &&
    ['during','after'].includes(f.placement) && typeof f.showCenter==='boolean' && totalSlots(f)<=60;
  function availableGenerations(group) {
    return [...new Set(MEMBERS.filter(m => memberInGroup(m,group)).map(m => m.generation))].sort((a,b)=>a-b);
  }
  function eligibleForGroup(s,m,group) {
    if (!s || !m || !memberInGroup(m,group)) return false;
    if(Array.isArray(s.allowedGenerations[group]) && !s.allowedGenerations[group].includes(m.generation))return false;
    if(s.eraDate){
      return !!root.SakamichiDraftEra?.eligible(m,group,s.eraDate,s.includeGraduates!==false);
    }
    return s.includeGraduates!==false || !m.graduated;
  }
  function eligibleMember(s,m) {
    if (!s || !m) return false;
    return s.allowedGroups.some(group => eligibleForGroup(s,m,group));
  }
  function eligibleMembers(s) { return MEMBERS.filter(m=>eligibleMember(s,m)); }
  function normalizeSession(s) {
    if (!s || typeof s!=='object') return null;
    if (s.version===4) return s;
    if (s.version===2) {
      s={...s,version:3,allowedGroups:s.allowedGroup==='all'?[...AVAILABLE_GROUPS]:[s.allowedGroup],
        allowedGenerations:{},roundLimit:null,status:'active',hostId:s.players?.[0]?.id||'p1'};
    }
    if (s.version!==3 || !Array.isArray(s.players) || !s.acquired) return null;
    // 古いドラフトを失わず、後から配置できるようにする。無制限巡は以前のまま。
    const limit=s.roundLimit===null?Math.max(5,...Object.values(s.acquired).map(a=>a.length+3)):s.roundLimit;
    const rows=[];let remain=limit;
    while (remain>0) { const n=Math.min(12,remain);rows.push(n);remain-=n; }
    if(rows.length>5) return null;
    const size=rows.reduce((a,b)=>a+b,0);
    return {...s,version:4,formation:{rows,placement:'after',showCenter:true},
      placements:Object.fromEntries(s.players.map(p=>[p.id,Array(size).fill(null)])),pickSlots:{}};
  }
  function isValidSession(s) {
    if (!s || s.version!==4 || !Array.isArray(s.players) || s.players.length<2 || s.players.length>50 ||
      !Array.isArray(s.allowedGroups) || !s.allowedGroups.length ||
      new Set(s.allowedGroups).size!==s.allowedGroups.length ||
      s.allowedGroups.some(g=>!AVAILABLE_GROUPS.includes(g)) ||
      !s.allowedGenerations || typeof s.allowedGenerations!=='object' ||
      !Number.isSafeInteger(s.round) || s.round<1 || !s.acquired || !s.picks ||
      !Array.isArray(s.roundWinners) || !Array.isArray(s.history) ||
      !['active','finished'].includes(s.status) || !validFormation(s.formation) ||
      !(s.roundLimit===null || (Number.isSafeInteger(s.roundLimit) && s.roundLimit>=1 && s.roundLimit<=60)) ||
      (s.roundLimit!==null && (s.round>s.roundLimit || s.roundLimit!==totalSlots(s.formation))) ||
      (s.status==='finished' && s.roundLimit===null) || !s.placements || !s.pickSlots) return false;
    for (const [g,gens] of Object.entries(s.allowedGenerations)) {
      if (!s.allowedGroups.includes(g) || !Array.isArray(gens) || new Set(gens).size!==gens.length ||
          gens.some(n=>!availableGenerations(g).includes(n))) return false;
    }
    const ids=s.players.map(p=>p?.id);
    if (new Set(ids).size!==ids.length || ids.some(id=>typeof id!=='string') ||
      s.players.some(p=>typeof p.name!=='string') || !ids.includes(s.hostId) ||
      s.roundWinners.some(id=>!ids.includes(id)) || new Set(s.roundWinners).size!==s.roundWinners.length) return false;
    const owned=[];
    for (const pid of ids) {
      if (!Array.isArray(s.acquired[pid]) || s.acquired[pid].some(mid=>!eligibleMember(s,MEMBER_MAP.get(mid)))) return false;
      owned.push(...s.acquired[pid]);
      const positions=s.placements[pid];
      if (!Array.isArray(positions) || positions.length!==totalSlots(s.formation)) return false;
      const placed=positions.filter(Boolean);
      if (new Set(placed).size!==placed.length || placed.some(mid=>!s.acquired[pid].includes(mid))) return false;
    }
    if (new Set(owned).size!==owned.length) return false;
    if (s.includeGraduates!==undefined && typeof s.includeGraduates!=='boolean') return false;
    if(s.eraDate!==undefined && s.eraDate!==null &&
      (!root.SakamichiDraftEra?.isDate(s.eraDate) || !root.SakamichiDraftEra?.available()))return false;
    if (s.status==='finished' && (Object.keys(s.picks).length || s.roundWinners.length)) return false;
    if (!Object.entries(s.picks).every(([pid,mid])=>ids.includes(pid) &&
      !s.roundWinners.includes(pid) && eligibleMember(s,MEMBER_MAP.get(mid)) && !owned.includes(mid))) return false;
    for (const [pid,index] of Object.entries(s.pickSlots)) {
      if (!ids.includes(pid) || !Object.prototype.hasOwnProperty.call(s.picks,pid) ||
        !Number.isSafeInteger(index) || index<0 || index>=totalSlots(s.formation) ||
        s.placements[pid][index]!==null) return false;
    }
    if (s.formation.placement==='during' && Object.keys(s.picks).some(pid=>!(pid in s.pickSlots))) return false;
    return true;
  }
  function createSession(names,opts={}) {
    if (!Array.isArray(names)||names.length<2||names.length>50) throw new Error('参加人数は2人以上にしてください（最大50人）。');
    const allowedGroups=Array.isArray(opts.allowedGroups)?opts.allowedGroups:AVAILABLE_GROUPS;
    const allowedGenerations=opts.allowedGenerations||{};
    const formation=opts.formation?{rows:[...opts.formation.rows],placement:opts.formation.placement,showCenter:opts.formation.showCenter}:defaultFormation();
    if(!validFormation(formation)) throw new Error('列数・列ごとの人数を見直してください。');
    const roundLimit=totalSlots(formation);
    const players=names.map((name,i)=>({id:`p${i+1}`,name:String(name).trim().slice(0,20)||`プレイヤー${i+1}`}));
    const s={version:4,allowedGroups:[...allowedGroups],allowedGenerations,includeGraduates:opts.includeGraduates!==false,roundLimit,round:1,
      formation,status:'active',hostId:'p1',players,acquired:Object.fromEntries(players.map(p=>[p.id,[]])),
      placements:Object.fromEntries(players.map(p=>[p.id,Array(roundLimit).fill(null)])),pickSlots:{},
      picks:{},roundWinners:[],history:[],message:'指名するプレイヤーとメンバーを選んでください。'};
    if(opts.eraDate){
      if(!root.SakamichiDraftEra?.available()) throw new Error('在籍期間データが未登録です。管理者にデータ更新を依頼してください。');
      if(!root.SakamichiDraftEra.isDate(opts.eraDate))throw new Error('基準日の形式を確認してください。');
      s.eraDate=opts.eraDate;
    }
    if(!isValidSession(s)) throw new Error('グループ・期別・時代設定を確認してください。');
    if(eligibleMembers(s).length<players.length*roundLimit) {
      throw new Error(`候補は${eligibleMembers(s).length}人です。${players.length}人×${roundLimit}巡（合計${players.length*roundLimit}人分）には不足しています。`);
    }
    return s;
  }
  function pendingPlayers(s) { return s.status==='finished'?[]:s.players.filter(p=>!s.roundWinners.includes(p.id)); }
  function isAcquired(s,mid) { return Object.values(s.acquired).some(a=>a.includes(mid)); }
  function setPick(s,pid,mid,slotIndex=null) {
    if(!isValidSession(s)) throw new Error('ドラフトのデータが壊れています。');
    if(!pendingPlayers(s).some(p=>p.id===pid)) throw new Error('このプレイヤーは現在指名できません。');
    if(!eligibleMember(s,MEMBER_MAP.get(mid)) || isAcquired(s,mid)) throw new Error('指定されたメンバーは指名できません。');
    const slots={...s.pickSlots};
    if(s.formation.placement==='during') {
      if(!Number.isSafeInteger(slotIndex) || slotIndex<0 || slotIndex>=totalSlots(s.formation) ||
        s.placements[pid][slotIndex]!==null) throw new Error('先に空いている配置枠を選んでください。');
      slots[pid]=slotIndex;
    } else delete slots[pid];
    return {...s,picks:{...s.picks,[pid]:mid},pickSlots:slots,
      message:'全員の指名が揃ったら主催者が抽選を実行してください。'};
  }
  function clearPick(s,pid) {
    if(!isValidSession(s)) throw new Error('ドラフトのデータが壊れています。');
    if(!pendingPlayers(s).some(p=>p.id===pid)) return s;
    const picks={...s.picks},slots={...s.pickSlots};delete picks[pid];delete slots[pid];
    return {...s,picks,pickSlots:slots,message:'指名を取り消しました。'};
  }
  function resolvePicks(s,rng=Math.random) {
    if(!isValidSession(s)) throw new Error('ドラフトのデータが壊れています。');
    const pending=pendingPlayers(s);
    if(!pending.length||pending.some(p=>!s.picks[p.id])) throw new Error('全員の指名が揃っていません。');
    const byMember=new Map();
    for(const p of pending){const mid=s.picks[p.id];if(!byMember.has(mid))byMember.set(mid,[]);byMember.get(mid).push(p.id);}
    const acquired=Object.fromEntries(s.players.map(p=>[p.id,[...s.acquired[p.id]]]));
    const placements=Object.fromEntries(s.players.map(p=>[p.id,[...s.placements[p.id]]]));
    const winners=[...s.roundWinners],events=[];
    for(const [mid,candidates] of byMember){
      const v=rng();
      if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>=1) throw new Error('抽選乱数に問題があります。');
      const winner=candidates[Math.floor(v*candidates.length)];
      acquired[winner].push(mid);winners.push(winner);
      if(s.formation.placement==='during') placements[winner][s.pickSlots[winner]]=mid;
      events.push({round:s.round,memberId:mid,winner,candidates:[...candidates],wasContested:candidates.length>1});
    }
    const completed=winners.length===s.players.length;
    const finished=completed&&s.roundLimit!==null&&s.round>=s.roundLimit;
    return {...s,round:completed&&!finished?s.round+1:s.round,
      status:finished?'finished':'active',acquired,placements,pickSlots:{},
      roundWinners:completed?[]:winners,picks:{},history:[...s.history,...events],
      message:finished?`全${s.roundLimit}巡のドラフトが終了しました！${s.formation.placement==='after'?' メンバーをフォーメーションに配置しましょう。':''}`:
        completed?`第${s.round}巡が確定しました。第${s.round+1}巡へ進みます。`:
        '抽選結果が確定しました。落選したプレイヤーは再指名してください。'};
  }
  function placeMember(s,pid,slot,mid) {
    if(!isValidSession(s) || s.status!=='finished' || s.formation.placement!=='after') throw new Error('配置変更できる状態ではありません。');
    if(!s.players.some(p=>p.id===pid) || !Number.isSafeInteger(slot) || slot<0 || slot>=totalSlots(s.formation)) throw new Error('配置場所が正しくありません。');
    if(mid!==null&&!s.acquired[pid].includes(mid)) throw new Error('自分の獲得メンバーだけを配置できます。');
    const positions=[...s.placements[pid]];
    if(mid===null) positions[slot]=null;
    else {
      const old=positions.indexOf(mid),displaced=positions[slot];
      positions[slot]=mid;
      if(old>=0&&old!==slot) positions[old]=displaced;
    }
    return {...s,placements:{...s.placements,[pid]:positions}};
  }
  root.SakamichiDraftEngine=Object.freeze({GROUPS,MEMBERS,AVAILABLE_GROUPS,availableGenerations,
    memberInGroup,eligibleForGroup,eligibleMember,eligibleMembers,compareMembers,compareMembersForGroup,sortMemberIds,normalizeSession,isValidSession,createSession,
    pendingPlayers,isAcquired,setPick,clearPick,resolvePicks,placeMember,validFormation,totalSlots,defaultFormation});
})(window);
