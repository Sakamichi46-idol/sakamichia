/* Pure rules for one-player condition draft; mirrored from Discord Bot. */
(function(root){
 'use strict';
 const ORDER=['nogi','keyaki','sakura','hiragana','hinata'];
 const LABELS={nogi:'乃木坂46',keyaki:'欅坂46',sakura:'櫻坂46',hiragana:'けやき坂46',hinata:'日向坂46'};
 const MODES={generation:'期別',birthday:'誕生月',birth_year:'生まれ年',school_year:'学年',zodiac:'干支',hometown:'出身地'};
 const ZODIAC=['申','酉','戌','亥','子','丑','寅','卯','辰','巳','午','未'];
 function schoolYear(y,m,d){return m<4||(m===4&&d===1)?y-1:y;}
 function conditionValue(m, mode, meta){
  if(mode==='generation')return m.generation;
  const d=meta?.[m.id];if(!d)return null;
  const b=d.birthday;
  if(mode==='hometown')return d.hometown||null;
  if(!Array.isArray(b)||b.length!==3)return null;
  if(mode==='birthday')return b[1];
  if(mode==='birth_year')return b[0];
  if(mode==='school_year')return schoolYear(...b);
  if(mode==='zodiac')return ZODIAC[b[0]%12];
  return null;
 }
 function conditionLabel(mode,value){
  if(mode==='generation')return value===0?'交換留学生':`${value}期生`;
  if(mode==='birthday')return `${value}月生まれ`;
  if(mode==='birth_year')return `${value}年生まれ`;
  if(mode==='school_year')return `${value}年度生まれ`;
  if(mode==='zodiac')return `${value}年`;
  return String(value);
 }
 function key(x){return [x.group,x.mode,String(x.value)].join('|');}
 function inGroup(m,g){return (m.groups||[m.group]).includes(g);}
 function combinations(members,meta,opts){
  const groups=opts.groups||ORDER,modes=opts.mode==='random'?Object.keys(MODES):[opts.mode];
  const acquired=new Set(opts.acquired||[]),used=new Set(opts.used||[]),repeat=opts.repeat!==false;
  const bucket=new Map();
  for(const m of members){
   if(acquired.has(m.id)||(opts.status==='active'&&m.graduated)||(opts.status==='graduate'&&!m.graduated))continue;
   for(const g of groups){
    if(!inGroup(m,g))continue;
    for(const mode of modes){
     const value=conditionValue(m,mode,meta);if(value===null||value===undefined||value==='')continue;
     const x={group:g,mode,value};const k=key(x);
     if(!repeat&&used.has(k))continue;
     if(!bucket.has(k))bucket.set(k,{...x,memberIds:[]});
     bucket.get(k).memberIds.push(m.id);
    }
   }
  }
  return [...bucket.values()];
 }
 function choose(items,rng=Math.random){if(!items.length)return null;return items[Math.floor(Math.min(.999999999,Math.max(0,rng()))*items.length)];}
 root.SakamichiSoloEngine=Object.freeze({ORDER,LABELS,MODES,ZODIAC,schoolYear,conditionValue,conditionLabel,key,inGroup,combinations,choose});
})(typeof window==='undefined'?globalThis:window);
