/* A historical date filter shared by all draft candidates. The date index is
   generated from verified public member-joining and departure records. */
(function(root){
  'use strict';
  const periods={
    keyaki:['2015-08-21','2020-10-13'],
    sakura:['2020-10-14',null],
    hiragana:['2015-11-30','2019-02-10'],
    hinata:['2019-02-11',null],
    nogi:['2011-08-21',null]
  };
  const isDate = s => {
    if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
    const d=new Date(`${s}T00:00:00Z`);
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;
  };
  function available(){
    const data=root.SakamichiDraftTimeline;
    return !!(data&&data.version===1&&data.ready&&data.members&&typeof data.members==='object');
  }
  function record(member){return root.SakamichiDraftTimeline?.members?.[member?.id] || null;}
  function departureAt(member,selectedDate){
    if(!isDate(selectedDate))return false;
    const item=record(member);
    return !!item?.left&&item.left<selectedDate;
  }
  function eligible(member,group,selectedDate,includeFormer=false){
    if(!isDate(selectedDate)||!available()||!member)return false;
    if(!(member.groups||[member.group]).includes(group))return false;
    const item=record(member),range=periods[group];
    if(!item||!isDate(item.joined)||!range)return false;
    // A group must exist on the chosen date. Membership from one era cannot
    // retroactively put members in a successor group that did not yet exist.
    if(selectedDate<range[0]||(range[1]&&selectedDate>range[1]))return false;
    if(item.joined>selectedDate)return false;
    if(!includeFormer){
      if(item.uncertainEnd)return false;
      if(item.left&&item.left<selectedDate)return false;
    }
    // At rename, members who had already departed the predecessor are not
    // retroactively members of the successor (even if "include former" is on).
    if(['sakura','hinata'].includes(group) && item.left && item.left<range[0])return false;
    return true;
  }
  root.SakamichiDraftEra=Object.freeze({isDate,available,eligible,record,departureAt,periods});
})(typeof window==='undefined'?globalThis:window);
