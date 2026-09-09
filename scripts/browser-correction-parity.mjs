import assert from "node:assert/strict";

export async function runCorrectionParity({ev,seed,fixture,read,click,input,tab,until,pause,checks,date}) {
  const select=async(selector,value)=>{
    await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing select');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await pause();
  };
  const target=async(id)=>{await select("#correction-target",id);await click('[data-action="select-correction-target"]');};
  const source=fixture(true);source.zones[0].kind="alt";source.zones[0].name="대체배송";
  await seed(source);await tab("backup");
  await ev('window.confirm=()=>true');
  for(const restoreKind of ["alt","hils","miju"]){
    await target("zone:hils");await select("#correction-zone-kind","paid_received");
    await click('[data-action="save-zone-correction"]');
    await until('!!document.querySelector("[data-action=save-helper-correction]")');
    let day=await read();assert.equal(day.helpers.length,1);assert.equal(day.helpers[0].quantity,100);
    assert.equal(day.helpers[0].kind,"paid_received");
    const helperId=day.helpers[0].id;
    await target("helper:"+helperId);
    await select('[data-helper-kind="'+helperId+'"]',"free_received");
    await click('[data-action="save-helper-correction"][data-helper="'+helperId+'"]');
    day=await read();assert.equal(day.helpers[0].kind,"free_received");assert.equal(day.helpers[0].quantity,100);
    await target("helper:"+helperId);
    await select('[data-helper-zone-restore="'+helperId+'"]',restoreKind);
    await click('[data-action="restore-helper-zone"][data-helper="'+helperId+'"]');
    await until('!!document.querySelector("#correction-zone-kind")');
    day=await read();assert.equal(day.helpers.length,0);assert.equal(day.zones[0].id,"hils");
    assert.equal(day.zones[0].kind,restoreKind);
    assert.equal(day.timeline.find(e=>e.type==="zone_end").payload.delivered,100);
    for(const id of ["start","sort","sorted","delivery","end"]){
      assert.equal(day.timeline.find(e=>e.id===id).at,source.timeline.find(e=>e.id===id).at);
    }
  }
  checks.push("completed zone->paid100->free100->zone repeated for alt/hils/miju; original visit ID/times/count preserved and editor remains available");

  await target("zone:hils");await select("#correction-zone-kind","alt");
  await input("#correction-zone-name","반복 정정");await select("#correction-zone-quantity-mode","actual");
  await input("#correction-zone-delivered","88");await click('[data-action="save-zone-correction"]');
  assert.equal((await read()).timeline.find(e=>e.type==="zone_end").payload.delivered,88);
  await target("zone:hils");await input("#correction-zone-delivered","100");
  await click('[data-action="save-zone-correction"]');
  assert.equal((await read()).timeline.find(e=>e.type==="zone_end").payload.delivered,100);
  checks.push("restored same record quantity100->88->100 and name edit repeatedly without disappearing");

  const legacy=fixture(true);legacy.zones=[];
  legacy.timeline=legacy.timeline.filter(e=>!e.zoneId);
  legacy.timeline.push({id:"legacy-helper-event",type:"helper_add",at:date+"T11:00:00+09:00",source:"manual",createdAt:date+"T11:00:00+09:00",updatedAt:date+"T11:00:00+09:00",payload:{helperId:"legacy-helper",helperKind:"paid_received",quantity:100,sourceZoneId:"gone"}});
  legacy.helpers=[{id:"legacy-helper",name:"옛 도우미",kind:"paid_received",quantity:100,linkedEventIds:["legacy-helper-event"]}];
  await seed(legacy);await ev('window.confirm=()=>true');await tab("backup");
  await target("helper:legacy-helper");await select('[data-helper-zone-restore="legacy-helper"]',"alt");
  await click('[data-action="restore-helper-zone"][data-helper="legacy-helper"]');
  const restoredLegacy=await read();
  assert.equal(restoredLegacy.timeline.find(e=>e.type==="zone_start").at,restoredLegacy.timeline.find(e=>e.type==="zone_end").at);
  await tab("report");assert.match(await ev('document.querySelector(".report").innerText'),/실제 효율: 시간당 -/);
  assert.equal(restoredLegacy.timeline.find(e=>e.type==="zone_end").payload.delivered,100);
  checks.push("legacy helper without original time restores count100 but no invented5min efficiency; log time correction remains required");

  await seed(fixture(true));await tab("stats");
  assert(await ev('!!document.querySelector(".ratio-card")'));
  assert.match(await ev('document.querySelector(".ratio-card").innerText'),/%/);
  const week=await ev('document.body.innerText');await click('[data-action="stats-week-prev"]');
  assert.notEqual(await ev('document.body.innerText'),week);
  await click('[data-action="stats-week-next"]');
  await click('[data-action="set-stats-tab"][data-stats-tab="month"]');
  const month=await ev('document.body.innerText');
  for(let n=0;n<12;n++)await click('[data-action="stats-month-prev"]');
  assert.notEqual(await ev('document.body.innerText'),month);
  for(let n=0;n<12;n++)await click('[data-action="stats-month-next"]');
  assert.equal(await ev('document.body.innerText'),month);
  await click('[data-action="set-stats-tab"][data-stats-tab="date"]');
  await select("#stats-date-input",date);
  assert.match(await ev('document.body.innerText'),/100/);
  checks.push("ratio percentage visible; week back/forward, month12 back/12 forward, chosen date100 in current UI");
}
