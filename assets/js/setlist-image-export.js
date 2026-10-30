/* 坂道日和: one-image 3:4 setlist export shared by live archive and editor.
 * No third-party rendering dependency. All layout decisions are made locally.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.SakamichiSetlistImageExport=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const W=960,H=1280,MARGIN=54,COLUMN_GAP=32;
 const JP="'Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans CJK JP',sans-serif";
 const COLORS={ink:'#203246',secondary:'#5f7388',line:'#dce5ef',accent:'#6e78a9',section:'#f0eff8',paper:'#ffffff'};
 const clean=s=>String(s||'').normalize('NFKC').replace(/[\s\u3000・「」『』ー―-]/g,'').toLocaleLowerCase('ja');
 const tidy=s=>String(s||'').trim();
 const squeeze=(ctx,text,width,font)=>{
  ctx.font=font;
  const src=String(text||'');
  // 英単語の途中で改行しない(タイトルが ROCKE/STRA のように割れるのを防ぐ)。
  // 日本語は1文字ずつ、英数字の並びは単語単位でトークン化して貪欲に詰める。
  const tokens=[];let word='';
  const flush=()=>{if(word){tokens.push(word);word='';}};
  for(const c of Array.from(src)){
   if(/[A-Za-z0-9'’.\-]/.test(c)){word+=c;continue;}
   flush();
   tokens.push(c===' '||c==='　'?' ':c);
  }
  flush();
  const hardSplit=t=>{
   const parts=[];let cur='';
   for(const c of Array.from(t)){if(cur&&ctx.measureText(cur+c).width>width){parts.push(cur);cur='';}cur+=c;}
   if(cur)parts.push(cur);return parts;
  };
  const units=[];
  for(const t of tokens){
   if(t!==' '&&ctx.measureText(t).width>width)units.push(...hardSplit(t));
   else units.push(t);
  }
  const result=[];let line='';
  for(const u of units){
   if(u===' '){if(line&&ctx.measureText(line+' ').width<=width)line+=' ';continue;}
   if(line&&ctx.measureText(line+u).width>width){result.push(line.replace(/\s+$/,''));line='';}
   line+=u;
  }
  if(line)result.push(line.replace(/\s+$/,''));
  return result.length?result:[''];
 };
 function normalizeRows(input,mode='compact'){
  const out=[];
  for(const row of input||[]){if(!row||!row.type)continue;
   if(row.type==='title'){continue;}
   if(row.type==='event'){
    const label=tidy(row.text||row.label);if(!label)continue;
    const details=[row.people?'担当：'+row.people:'',row.note||''].filter(Boolean);
    out.push({type:'event',text:label,details,section:/^(ENCORE|W ENCORE|アンコール|Wアンコール|ダブルアンコール)/i.test(label)});
   }else if(row.type==='song'){
    const cast=row.members||{},memberText=mode==='full'?cast.full:(cast.collapsed?cast.short:(cast.full||cast.short));
    const extras=[...(memberText?[memberText]:[]),...(row.meta||[])].map(tidy).filter(Boolean);
    out.push({type:'song',number:tidy(row.number),title:tidy(row.title)||'（曲名未登録）',center:tidy(row.center),extras});
   }
  }
  return out;
 }
 function resolveLogoEntry(manifest,show){
  if(!manifest||!show)return null;
  const direct=manifest.shows?.[String(show.id||'')];
  if(typeof direct==='string')return {url:direct,mode:'side'};
  if(direct&&typeof direct.url==='string'&&(!direct.group||direct.group===show.group))return {url:direct.url,mode:direct.mode==='bg'?'bg':'side'};
  // Longer, more specific title match wins. No guesses from unrelated groups.
  const name=clean(show.title),arr=(manifest.tours||[]).filter(e=>e&&typeof e.match==='string'&&typeof e.url==='string'&&e.group===show.group&&clean(e.match)&&name.includes(clean(e.match)));
  arr.sort((a,b)=>clean(b.match).length-clean(a.match).length);
  const hit=arr[0];
  return hit?{url:hit.url,mode:hit.mode==='bg'?'bg':'side'}:null;
 }
 function resolveLogo(manifest,show){return resolveLogoEntry(manifest,show)?.url||'';}
 function measure(ctx,row,width,fontSize,useRightCredits=false){
  const titleSize=fontSize,metaSize=Math.max(10,Math.round(fontSize*.66)),line=titleSize*1.32,metaLine=metaSize*1.43;
  if(row.type==='event'){
   const text=squeeze(ctx,row.text,width-26,`600 ${Math.round(fontSize*.85)}px ${JP}`);
   const detail=row.details.flatMap(t=>squeeze(ctx,t,width-28,`${metaSize}px ${JP}`));
   return {...row,titleLines:text,metaLines:detail,height:text.length*fontSize*1.14+detail.length*metaLine+13,fontSize,metaSize};
  }
  const numberWidth=row.number?Math.max(58,Math.round(fontSize*2.6)):0;
  const credits=[...(row.center?[`C：${row.center}`]:[]),...row.extras];
  // One-column layout: use the right side for show-specific credits, while
  // leaving song numbers and titles on the left. No extra image is added.
  let rightCredits=!!(useRightCredits&&credits.length);
  const creditsWidth=rightCredits?Math.round(width*.31):0;
  const creditsGap=rightCredits?24:0;
  let contentWidth=Math.max(75,width-numberWidth-creditsWidth-creditsGap);
  let titleLines=squeeze(ctx,row.title,contentWidth,`bold ${fontSize}px ${JP}`);
  let metaLines=credits.flatMap(t=>squeeze(ctx,t,rightCredits?creditsWidth:contentWidth,`${metaSize}px ${JP}`));
  // A very long list of singers can be easier to read under that one song.
  // Revert only that row to full-width stacking instead of squeezing names.
  if(rightCredits&&metaLines.length>3){
   rightCredits=false;
   contentWidth=Math.max(75,width-numberWidth);
   titleLines=squeeze(ctx,row.title,contentWidth,`bold ${fontSize}px ${JP}`);
   metaLines=credits.flatMap(t=>squeeze(ctx,t,contentWidth,`${metaSize}px ${JP}`));
  }
  const titleHeight=titleLines.length*line;
  const metaHeight=metaLines.length*metaLine;
  const height=rightCredits?Math.max(titleHeight,metaHeight)+Math.max(10,fontSize*.32):titleHeight+metaHeight+Math.max(8,fontSize*.30);
  return {...row,titleLines,metaLines,height,numberWidth,contentWidth,fontSize,metaSize,
   rightCredits,creditsX:rightCredits?(width-creditsWidth):numberWidth};
 }
 function chunksWithSections(measured){
  const chunks=[];
  for(let i=0;i<measured.length;i++){
   const cur=measured[i];
   if(cur.type==='event'&&cur.section&&measured[i+1]){chunks.push([cur,measured[++i]]);}
   else chunks.push([cur]);
  }
  return chunks;
 }
 function splitColumns(measured){
  const chunks=chunksWithSections(measured);
  if(chunks.length<2)return [measured,[]];
  const vals=chunks.map(group=>group.reduce((s,r)=>s+r.height,0)),total=vals.reduce((a,b)=>a+b,0);
  let best=1,bestMax=Infinity,sum=0;
  for(let i=1;i<chunks.length;i++){sum+=vals[i-1];const cost=Math.max(sum,total-sum);
   if(cost<bestMax){bestMax=cost;best=i;}
  }
  return [chunks.slice(0,best).flat(),chunks.slice(best).flat()];
 }
 function plan(ctx,rawRows,header={},opts={}){
  const rows=normalizeRows(rawRows,opts.mode||'compact');
  if(!rows.length)throw Error('保存する内容がありません。');
  const logo=!!opts.hasLogo;
  const headerH=opts.hideTitle?82:(logo?250:184);
  const top=headerH+20,bottom=H-44,available=bottom-top;
  const widths=[W-2*MARGIN,(W-2*MARGIN-COLUMN_GAP)/2];
  const singleColumnSizes=(opts.singleColumnSizes||[32,31,30,29,28,27,26,25,24,23,22,21,20,19,18]).filter(Number.isFinite);
  const twoColumnSizes=(opts.twoColumnSizes||[32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,17,16,15,14,13,12,11,10]).filter(Number.isFinite);
  let chosen=null,fallback=null;
  for(const ncols of [1,2]){
   // 読みやすさ優先:1列・2列の両方を試し、より大きな文字で収まる方を選ぶ
   // (同サイズなら1列)。2列にしてもいいから見やすく、というユーザーの指定。
   const sizes=ncols===1?singleColumnSizes:twoColumnSizes;
   for(const fontSize of sizes){
    const measured=rows.map(r=>measure(ctx,r,widths[ncols-1],fontSize,ncols===1));
    const columns=ncols===1?[measured]:splitColumns(measured);
    const heights=columns.map(c=>c.reduce((s,r)=>s+r.height,0));
    const high=Math.max(...heights);
    if(high<=available){
     const cand={columns,heights,fontSize,cols:ncols,overflow:false,contentScale:1};
     if(!chosen||cand.fontSize>chosen.fontSize)chosen=cand;
     break;
    }
    if(ncols===2&&fontSize===sizes[sizes.length-1]){
     // Extreme input (>100 rows, long notes): preserve ALL content in one
     // exported image and warn. Never silently truncate any track.
     fallback={columns,heights,fontSize,cols:ncols,overflow:true,contentScale:available/high};
    }
   }
  }
  if(!chosen)chosen=fallback;
  // Spread only a modest amount of remaining height between rows. Keep the
  // order and upper alignment; avoid a conspicuous empty strip at the bottom.
  const rowGap=chosen.cols===1&&chosen.columns[0].length>1
   ?Math.min(16,Math.max(0,((available-chosen.heights[0]-24)/(chosen.columns[0].length-1))*.85))
   :0;
  return {...chosen,W,H,headerH,top,available,rowGap,rowCount:rows.length,headers:header||{},widths};
 }
 // タイトルはなるべく1行に収める。収まらなければ少し縮小し、それでも無理な
 // 場合は末尾の［DAY1］等の括弧だけを2行目に回す(ユーザー指定:本体の途中での
 // 改行は避け、括弧部分が分かれるのは可)。
 function titleLayout(ctx,title,maxWidth){
  const fits=(s,text)=>{ctx.font=`700 ${s}px ${JP}`;return ctx.measureText(text).width<=maxWidth;};
  for(let s=30;s>=20;s--)if(fits(s,title))return {lines:[title],size:s};
  const m=String(title).match(/^(.*?)\s*((?:［[^］]*］|【[^】]*】|\[[^\]]*\])\s*)$/);
  if(m&&m[1]){
   for(let s=30;s>=20;s--)if(fits(s,m[1])&&fits(s,m[2]))return {lines:[m[1],m[2]],size:s};
   const lines=squeeze(ctx,m[1],maxWidth,`700 24px ${JP}`).slice(0,2);
   lines.push(m[2]);
   return {lines,size:24};
  }
  return {lines:squeeze(ctx,title,maxWidth,`700 24px ${JP}`).slice(0,3),size:24};
 }
 function drawTitleBlock(ctx,header){
  const title=tidy(header.title)||'マイセットリスト';
  const {lines,size}=titleLayout(ctx,title,W-140);
  const step=Math.round(size*1.32);
  const titleY=Math.max(28,Math.round(86-(lines.length*step)/2-size*0.30));
  lines.forEach((s,i)=>drawCentered(ctx,s,titleY+i*step,size,COLORS.ink,true));
  drawCentered(ctx,[header.date,header.venue].filter(Boolean).join('　 /　 '),titleY+(lines.length-1)*step+size+14,18,COLORS.secondary);
 }
 // 素材をセトリ全体の背景に薄く敷く(ウォーターマーク)。リスト領域全体を
 // 覆うよう cover で敷き、はみ出しはクリップする。
 function drawWatermark(ctx,logo,data,alpha,wash){
  const areaW=W-2*MARGIN,areaH=Math.max(120,data.H-data.top-30);
  const wScale=Math.max(areaW/logo.width,areaH/logo.height);
  const dw=Math.round(logo.width*wScale),dh=Math.round(logo.height*wScale);
  const dx=Math.round(MARGIN+(areaW-dw)/2),dy=Math.round(data.top+(areaH-dh)/2);
  ctx.save();
  ctx.beginPath();ctx.rect(MARGIN,data.top,areaW,areaH);ctx.clip();
  ctx.globalAlpha=alpha;ctx.drawImage(logo,dx,dy,dw,dh);
  ctx.globalAlpha=wash;ctx.fillStyle=COLORS.paper;ctx.fillRect(MARGIN,data.top,areaW,areaH);
  ctx.restore();
 }
 function render(ctx,rawRows,header={},options={}){
  const data=plan(ctx,rawRows,header,options);ctx.save();ctx.fillStyle=COLORS.paper;ctx.fillRect(0,0,W,H);ctx.textBaseline='top';
  ctx.fillStyle='#f7f8fc';ctx.fillRect(0,0,W,13);
  const logo=options.logoImage||null;
  const sideMode=!!logo&&options.logoMode!=='bg';
  // 透かし(F)はロゴがある場合の共通要素として本文背景に敷く
  if(logo&&!options.hideTitle)drawWatermark(ctx,logo,data,sideMode?0.10:0.13,sideMode?0.25:0.22);
  if(options.hideTitle){ /* Title deliberately hidden by the user. */ }
  else if(logo&&options.logoMode==='bg'){
   // 背景モード:ヘッダーはタイトル文字のみ(素材は透かしとして全体に敷く)
   drawTitleBlock(ctx,header);
  }
  else if(logo){
   // サイド方式(B):ロゴを左に置き、タイトル文字を右に組む。ロゴだけでは
   // 読めない公演名を、文字のタイトルで必ず読めるようにする(ユーザー指定)。
   const maxW=320,maxH=170,scale=Math.min(maxW/logo.width,maxH/logo.height);
   const w=Math.round(logo.width*scale),h=Math.round(logo.height*scale);
   const lx=MARGIN,ly=Math.round((data.headerH-h)/2)+6;
   ctx.drawImage(logo,lx,ly,w,h);
   const tx=lx+w+28,tw=W-MARGIN-tx;
   const title=tidy(header.title)||'マイセットリスト';
   const {lines,size}=titleLayout(ctx,title,tw);
   const step=Math.round(size*1.32);
   const blockH=lines.length*step+32;
   const ty=Math.max(24,Math.round((data.headerH-blockH)/2));
   ctx.fillStyle=COLORS.ink;ctx.font=`700 ${size}px ${JP}`;
   lines.forEach((s,i)=>ctx.fillText(s,tx,ty+i*step));
   ctx.fillStyle=COLORS.secondary;ctx.font=`500 18px ${JP}`;
   ctx.fillText([header.date,header.venue].filter(Boolean).join('　 /　 '),tx,ty+(lines.length-1)*step+size+12);
  }else{
   drawTitleBlock(ctx,header);
  }
  ctx.fillStyle=COLORS.line;ctx.fillRect(MARGIN,data.headerH,W-2*MARGIN,1);
  const colW=data.widths[data.cols-1];
  if(data.cols===2){ctx.fillStyle='#edf0f6';ctx.fillRect(W/2-1,data.top,2,data.available);}
  for(let j=0;j<data.columns.length;j++){
   const x=MARGIN+j*(colW+COLUMN_GAP),scale=data.contentScale;
   ctx.save();ctx.translate(x,data.top);if(scale!==1)ctx.scale(1,scale);
   let y=0;
   for(const row of data.columns[j]){paintRow(ctx,row,0,y,colW);y+=row.height+data.rowGap;}
   ctx.restore();
  }
  ctx.restore();return data;
 }
 function drawCentered(ctx,text,y,size,color,bold=false){if(!text)return;ctx.font=`${bold?'700':'500'} ${size}px ${JP}`;ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(text,W/2,y);ctx.textAlign='left';}
 function paintRow(ctx,row,x,y,width){
  if(row.type==='event'){
   if(row.section){ctx.fillStyle=COLORS.section;ctx.fillRect(x,y,width,Math.min(row.height,36));}
   ctx.fillStyle=COLORS.accent;ctx.font=`600 ${Math.round(row.fontSize*.85)}px ${JP}`;
   let v=y+5;for(const s of row.titleLines){ctx.fillText(s,x+12,v);v+=row.fontSize*1.14;}
   ctx.fillStyle=COLORS.secondary;ctx.font=`${row.metaSize}px ${JP}`;
   for(const s of row.metaLines){ctx.fillText(s,x+14,v);v+=row.metaSize*1.43;}
   return;
  }
  if(row.number){ctx.fillStyle=COLORS.accent;ctx.font=`700 ${Math.round(row.fontSize*.8)}px ${JP}`;ctx.fillText(row.number,x,y+3);}
  const cx=x+row.numberWidth;let v=y;ctx.fillStyle=COLORS.ink;ctx.font=`700 ${row.fontSize}px ${JP}`;
  for(const line of row.titleLines){ctx.fillText(line,cx,v);v+=row.fontSize*1.32;}
  ctx.fillStyle=COLORS.secondary;ctx.font=`${row.metaSize}px ${JP}`;
  if(row.rightCredits){
   let creditY=y+Math.max(2,Math.round((row.fontSize-row.metaSize)*.30));
   for(const line of row.metaLines){ctx.fillText(line,x+row.creditsX,creditY);creditY+=row.metaSize*1.43;}
  }else{
   for(const line of row.metaLines){ctx.fillText(line,cx,v);v+=row.metaSize*1.43;}
  }
 }
 function download(blob,filename='setlist.png'){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
 }
 function loadImage(url){return new Promise(resolve=>{
  if(!url||!/^https?:\/\/|^\//i.test(url)){resolve(null);return;}
  const img=new Image();img.crossOrigin='anonymous';let done=false;
  const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>finish(null),5500);
  img.onload=()=>finish(img);img.onerror=()=>finish(null);img.src=url;
 });}
 // 一度読んだマニフェストとロゴ画像はキャッシュし、2回目以降の表示を待たせない
 const manifestCache=new Map(),imageCache=new Map();
 function fetchManifest(path){
  if(!manifestCache.has(path))manifestCache.set(path,fetch(path).then(r=>r.ok?r.json():null).catch(()=>null));
  return manifestCache.get(path);
 }
 function loadImageCached(url){
  if(!imageCache.has(url))imageCache.set(url,loadImage(url));
  return imageCache.get(url);
 }
 async function getLogo(manifestUrl,show){if(!show)return null;
  // R2-backed registration first. Keep static mapping as a fallback for older deployments.
  const paths=['/api/live-logos',manifestUrl||'/assets/live-logos.json'];
  for(const path of [...new Set(paths)]){
   try{
    const manifest=await fetchManifest(path);if(!manifest)continue;
    const entry=resolveLogoEntry(manifest,show);
    if(!entry)continue;
    const img=await loadImageCached(entry.url);if(img)return {image:img,mode:entry.mode};
   }catch(_){} // Missing logo never blocks the setlist export.
  }
  return null;
 }
 // 一覧表示中などのアイドル時間に、登録済みロゴを先読みしておく
 async function preloadLogos(manifestUrl,shows){
  try{
   const manifest=await fetchManifest(manifestUrl||'/assets/live-logos.json');if(!manifest)return 0;
   const urls=new Set();
   for(const show of shows||[]){const e=resolveLogoEntry(manifest,show);if(e)urls.add(e.url);}
   await Promise.all([...urls].map(u=>loadImageCached(u)));
   return urls.size;
  }catch(_){return 0;}
 }
 async function create(rawRows,header={},options={}){
  if(typeof document==='undefined')throw Error('ブラウザ上でのみ画像を生成できます');
  await document.fonts?.ready;
  const logoImage=options.logoImage||null;
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvasを使用できません。');
  const layout=render(ctx,rawRows,header,{...options,logoImage,hasLogo:!!logoImage&&options.logoMode!=='bg'});
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('画像を生成できませんでした。')),'image/png'));
  return {blob,layout};
 }
 return Object.freeze({version:'2.3.0',W,H,normalizeRows,resolveLogo,resolveLogoEntry,plan,render,getLogo,preloadLogos,create,download});
});
