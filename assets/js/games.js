// ミニゲーム：センター当て／グループ当て（ドラフトは games/draft/ の専用ページ）
// 両クイズともタイムアタック方式：開始と同時に計測し、上部に経過時間を表示する。
let SONGS=[], MEMBERS=[];
const area=document.getElementById("gameArea");
function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
async function init(){
  [SONGS, MEMBERS]=await Promise.all([loadJSON("songs.json"), loadJSON("members.json")]);
  document.querySelectorAll("[data-start]").forEach(b=>b.addEventListener("click",()=>start(b.dataset.start)));
}
function start(kind){ quiz(kind); }
// ---- クイズ共通（タイムアタック） ----
let Q={list:[],i:0,score:0,kind:"center",t0:0,timer:null};
function fmtTime(ms){
  const t=Math.max(0,ms)/1000, m=Math.floor(t/60), s=t-m*60;
  return `${m}:${s<10?"0":""}${s.toFixed(1)}`;
}
function bestKey(kind){ return `sakamichia-best-${kind}`; }
function loadBest(kind){ try{ return JSON.parse(localStorage.getItem(bestKey(kind))||"null"); }catch{ return null; } }
function saveBest(kind, score, ms){
  const b=loadBest(kind);
  if(!b || score>b.score || (score===b.score && ms<b.ms)){
    try{ localStorage.setItem(bestKey(kind), JSON.stringify({score, ms})); }catch{}
    return true;
  }
  return false;
}
function tick(){
  const el=document.getElementById("qTime");
  if(el && Q.t0) el.textContent=fmtTime(performance.now()-Q.t0);
}
function quiz(kind){
  if(Q.timer) clearInterval(Q.timer);
  const pool = kind==="center" ? SONGS.filter(s=>s.center) : SONGS;
  Q={kind, i:0, score:0, list:shuffle(pool).slice(0,10), t0:performance.now(), timer:null};
  Q.timer=setInterval(tick, 100);
  showQ();
}
function showQ(){
  if(Q.i>=Q.list.length){
    if(Q.timer){ clearInterval(Q.timer); Q.timer=null; }
    const ms=performance.now()-Q.t0;
    const isBest=saveBest(Q.kind, Q.score, ms);
    const best=loadBest(Q.kind);
    area.innerHTML=`<div class="card" style="margin-bottom:40px"><h3>結果</h3><p class="score">${Q.score} / ${Q.list.length} 問正解</p>
    <p>クリアタイム：<b>${fmtTime(ms)}</b>${isBest?"（ベスト更新！）":""}</p>
    ${best?`<p style="color:var(--muted)">ベスト：${best.score}問正解 ／ ${fmtTime(best.ms)}</p>`:""}
    <p>${Q.score>=9?"すごい、ほぼ完璧です！":Q.score>=6?"かなり詳しいですね。":Q.score>=3?"楽曲図鑑で復習するともっと伸びます。":"まずは楽曲図鑑からどうぞ。"}</p>
    <button onclick="location.reload()">もう一度遊ぶ</button></div>`; return;
  }
  const s=Q.list[Q.i];
  let question, answer, pool;
  if(Q.kind==="center"){ question=`「${s.title}」（${s.group}・${s.year}年）のセンターは？`; answer=s.center;
    pool=shuffle([...new Set(SONGS.filter(x=>x.group===s.group).map(x=>x.center))].filter(c=>c!==answer)).slice(0,3); }
  else { question=`「${s.title}」（${s.year}年）はどのグループの曲？`; answer=s.group;
    pool=shuffle(["乃木坂46","櫻坂46","日向坂46","欅坂46"].filter(g=>g!==answer)).slice(0,3); }
  const opts=shuffle([answer,...pool]);
  const best=loadBest(Q.kind);
  area.innerHTML=`<div class="card" style="margin-bottom:40px"><h3>${Q.kind==="center"?"センター当て":"グループ当て"}クイズ ${Q.i+1} / ${Q.list.length}問目（現在 ${Q.score}点）</h3>
  <p style="color:var(--muted);margin:4px 0">⏱ 経過時間 <b id="qTime">${fmtTime(performance.now()-Q.t0)}</b>${best?` ・ ベスト ${best.score}問正解／${fmtTime(best.ms)}`:""}</p>
  <p style="font-size:18px;font-weight:700">${esc(question)}</p>
  ${opts.map(o=>`<button class="quiz-opt" data-opt="${esc(o)}">${esc(o)}</button>`).join("")}<p id="fb"></p></div>`;
  area.querySelectorAll("[data-opt]").forEach(b=>b.addEventListener("click",()=>{
    const ok=b.dataset.opt===answer;
    b.classList.add(ok?"correct":"wrong");
    if(ok) Q.score++;
    document.getElementById("fb").innerHTML= ok?"正解！" : `残念、正解は「${esc(answer)}」でした。`;
    area.querySelectorAll("[data-opt]").forEach(x=>x.disabled=true);
    setTimeout(()=>{Q.i++; showQ();}, 1100);
  }));
}
init();
