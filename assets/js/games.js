// ミニゲーム：センター当て／グループ当て（ドラフトは games/draft/ の専用ページ）
let SONGS=[], MEMBERS=[];
const area=document.getElementById("gameArea");
function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
async function init(){
  [SONGS, MEMBERS]=await Promise.all([loadJSON("songs.json"), loadJSON("members.json")]);
  document.querySelectorAll("[data-start]").forEach(b=>b.addEventListener("click",()=>start(b.dataset.start)));
}
function start(kind){ quiz(kind); }
// ---- クイズ共通 ----
let Q={list:[],i:0,score:0,kind:"center"};
function quiz(kind){
  const pool = kind==="center" ? SONGS.filter(s=>s.center) : SONGS;
  Q={kind, i:0, score:0, list:shuffle(pool).slice(0,10)};
  showQ();
}
function showQ(){
  if(Q.i>=Q.list.length){
    area.innerHTML=`<div class="card" style="margin-bottom:40px"><h3>結果</h3><p class="score">${Q.score} / ${Q.list.length} 問正解</p>
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
  area.innerHTML=`<div class="card" style="margin-bottom:40px"><h3>${Q.kind==="center"?"センター当て":"グループ当て"}クイズ ${Q.i+1} / ${Q.list.length}問目（現在 ${Q.score}点）</h3>
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
