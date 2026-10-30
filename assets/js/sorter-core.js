/* ソート共通エンジン：対話型マージソート（引き分け＝同順位グループ化、1つ戻る、進捗目安）。
   メンバーソート（sorter.js）と楽曲ソート（song-sorter.js）で共用する純粋ロジック。
   アイテムは呼び出し側の配列の添字（0..n-1）で扱う。 */
(function(root){
  'use strict';

  // 対戦数の目安：平均的なマージソートの比較回数 n*log2(n) - n + 1
  function estimate(n){
    if(n <= 1) return 0;
    return Math.max(1, Math.round(n * Math.log2(n) - n + 1));
  }

  // 系統（欅坂46・櫻坂46は同一系統、けやき坂46・日向坂46は同一系統）
  function memberLineage(m){
    const gs = m.groups || [m.group];
    if(gs.includes('乃木坂46')) return '乃木坂46';
    if(gs.includes('櫻坂46') || gs.includes('欅坂46')) return '櫻坂46';
    if(gs.includes('日向坂46') || gs.includes('けやき坂46')) return '日向坂46';
    return m.group || '';
  }
  function songLineage(s){
    if(s.group === '乃木坂46') return '乃木坂46';
    if(s.group === '櫻坂46' || s.group === '欅坂46') return '櫻坂46';
    if(s.group === '日向坂46' || s.group === 'けやき坂46') return '日向坂46';
    return '合同';
  }

  function createSorter(n){
    // run = グループの配列、グループ = アイテム添字の配列（同順位のひとかたまり）
    let level = [];
    for(let i = 0; i < n; i++) level.push([[i]]);
    let next = [];
    let cur = null; // {a, b, ai, bi, out}
    let battles = 0;
    let history = [];

    function snapshot(){ return JSON.stringify({level, next, cur, battles}); }
    function restore(s){
      const o = JSON.parse(s);
      level = o.level; next = o.next; cur = o.cur; battles = o.battles;
    }
    function done(){
      return !cur && next.length === 0 && level.length <= 1;
    }
    // 次の対戦ペアが提示できる状態まで内部状態を進める
    function advance(){
      while(!done()){
        if(!cur){
          if(level.length >= 2){
            cur = {a: level.shift(), b: level.shift(), ai: 0, bi: 0, out: []};
          } else if(level.length === 1){
            // この段の残り1ランは次段へ送り、段を切り替える
            next.push(level.shift());
            level = next; next = [];
          } else {
            level = next; next = [];
          }
          continue;
        }
        if(cur.ai < cur.a.length && cur.bi < cur.b.length) return; // ペア提示可能
        while(cur.ai < cur.a.length) cur.out.push(cur.a[cur.ai++]);
        while(cur.bi < cur.b.length) cur.out.push(cur.b[cur.bi++]);
        next.push(cur.out); cur = null;
      }
    }
    advance();

    // 現在の対戦ペア {a, b, aSize, bSize}（a/b は各グループの代表アイテム）。終了時は null
    function pair(){
      if(done() || !cur) return null;
      return {
        a: cur.a[cur.ai][0], b: cur.b[cur.bi][0],
        aSize: cur.a[cur.ai].length, bSize: cur.b[cur.bi].length
      };
    }
    // choice: 'left' | 'right' | 'draw'
    function answer(choice){
      if(done() || !cur) return false;
      if(choice !== 'left' && choice !== 'right' && choice !== 'draw') return false;
      history.push(snapshot());
      if(choice === 'left'){ cur.out.push(cur.a[cur.ai]); cur.ai++; }
      else if(choice === 'right'){ cur.out.push(cur.b[cur.bi]); cur.bi++; }
      else { cur.out.push(cur.a[cur.ai].concat(cur.b[cur.bi])); cur.ai++; cur.bi++; }
      battles++;
      advance();
      return true;
    }
    function undo(){
      if(!history.length) return false;
      restore(history.pop());
      return true;
    }
    // 終了時の結果：順位順のグループ配列（各グループ = 同順位のアイテム添字配列）
    function result(){
      if(!done()) return null;
      return level.length ? level[0] : [];
    }
    function progress(){
      if(done()) return 100;
      const est = estimate(n);
      if(!est) return 100;
      return Math.min(99, Math.floor(100 * battles / est));
    }
    return {
      pair, answer, undo, done, result, progress,
      battles: () => battles,
      canUndo: () => history.length > 0,
      size: n
    };
  }

  root.SakamichiSorterCore = {createSorter, estimate, memberLineage, songLineage};
})(typeof window === 'undefined' ? globalThis : window);
