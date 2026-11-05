// 楽曲個別ページ：フォーメーションをマイフォーメーションへ取り込む
(function(){
  const btn = document.getElementById("sgEditFormation");
  if(!btn) return;
  const el = document.getElementById("songData");
  if(!el) return;
  let d = null;
  try{ d = JSON.parse(el.textContent); }catch(e){}
  if(!d) return;
  btn.addEventListener("click", ()=>{
    // 作成ページは最前列（1列目）から順に持つため、生成時に反転済みの rows/positions を使う
    const st = { title: d.title, rows: d.rows, showCenter: true, positions: d.positions };
    try{ localStorage.setItem("sakamichia-formation-import", JSON.stringify(st)); }catch(e){}
    location.href = "../../formation/";
  });
})();
