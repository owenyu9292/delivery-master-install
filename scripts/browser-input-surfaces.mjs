import assert from "node:assert/strict";
import {inspectControlSpacing} from './browser-control-spacing.mjs';

export async function runInputSurfaces({ev,send,seed,fixture,read,click,tab,pause,shot,checks}) {
  let total=0, controlCount=0, reachableButtons=0;
  const spacingProblems=[];
  const scan=async label=>{
    const original=await read();
    await ev('document.querySelectorAll("details").forEach(e=>e.open=true)');
    for(const [width,height] of [[411,762],[411,320],[360,430]]) {
      await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:2.63,mobile:true});await pause(100);
      const spacing=await ev('('+inspectControlSpacing.toString()+')()');
      controlCount+=spacing.controls;
      spacingProblems.push(...spacing.problems.map(p=>({screen:label,width,height,...p})));
      const fields=await ev('(()=>{const a=[...document.querySelectorAll("input,select,textarea")].filter(e=>e.type!=="file"&&!e.disabled&&e.checkVisibility());a.forEach((e,i)=>e.dataset.auditInput=String(i));return a.length})()');
      for(let i=0;i<fields;i++) {
        const bounds=await ev('(()=>{const e=document.querySelector("[data-audit-input=\\"'+i+'\\"]");e.scrollIntoView({block:"center"});e.focus();return true})()');
        assert(bounds);await pause(45);
        const box=await ev('(()=>{const e=document.querySelector("[data-audit-input=\\"'+i+'\\"]"),r=e.getBoundingClientRect(),n=document.querySelector(".tabbar").getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{id:e.id,type:e.type,top:r.top,bottom:r.bottom,left:r.left,right:r.right,nav:n.top,hit:e===hit||e.contains(hit)}})()');
        assert(box.top>=-1&&box.bottom<=box.nav+1&&box.left>=-1&&box.right<=width+1&&box.hit,
          label+"/"+width+"x"+height+": "+JSON.stringify(box));
        total++;
      }
      await ev('document.activeElement.blur()');
      const buttons=await ev('(()=>{const a=[...document.querySelectorAll("button")].filter(e=>!e.disabled&&e.checkVisibility()&&!e.closest(".tabbar"));a.forEach((e,i)=>e.dataset.auditButton=String(i));return a.length})()');
      for(let i=0;i<buttons;i++) {
        await ev('document.querySelector("[data-audit-button=\\"'+i+'\\"]").scrollIntoView({block:"center"})');await pause(25);
        const box=await ev('(()=>{const e=document.querySelector("[data-audit-button=\\"'+i+'\\"]"),r=e.getBoundingClientRect(),n=document.querySelector(".tabbar").getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{id:e.dataset.action,top:r.top,bottom:r.bottom,left:r.left,right:r.right,nav:n.top,hit:e===hit||e.contains(hit)}})()');
        assert(box.top>=-1&&box.bottom<=box.nav+1&&box.left>=-1&&box.right<=width+1&&box.hit,label+' button reachability '+JSON.stringify(box));
        reachableButtons++;
      }
      assert.equal(await ev('document.documentElement.scrollWidth>innerWidth'),false,label+" horizontal overflow");
    }
    assert.deepEqual(await read(),original,label+" focus changed stored day");
  };
  const empty=fixture();empty.status="draft";empty.timeline=[];empty.zones=[];
  await seed(empty);await scan("before-departure");
  assert(await ev('(()=>{const a=document.querySelector("#expected-count").getBoundingClientRect(),b=document.querySelector("[data-action=depart]").getBoundingClientRect();return b.top-a.bottom>=12})()'),'departure action must have at least 12px clearance');
  await shot('23-departure-spacing');
  await seed(fixture());await scan("active-hils");
  const miju=fixture(false,"miju");miju.zones[0].name="미주";miju.zones[0].kind="miju";
  await seed(miju);await scan("active-miju");
  await seed(fixture(true));await tab("log");
  for(const id of ["depart","arrive","start","sort","sorted","delivery","end","close"]) {
    await click('[data-action="open-log-edit"][data-event="'+id+'"]');
    await scan("log-"+id);
    await ev('document.activeElement.blur();window.__deliverySafety.back()');await pause();
  }
  await tab("backup");await scan("backup");
  await tab("stats");await scan("statistics");
  await tab("report");await scan("report");
  const planned=fixture();planned.zones.push({id:'spacing-alt',name:'대체배송 긴 이름 간격 확인',kind:'alt',order:2});
  await seed(planned);
  for(const [label,selector] of [
    ['route-plans','[data-action="open-route-plans"]'],
    ['route-edit','[data-action="open-route-editor"][data-zone="hils"]'],
    ['route-add','.add-zone[data-action="open-route-editor"]']
  ]) {
    await click(selector);
    for(const [width,height] of [[411,762],[411,320],[360,430]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2.63,mobile:true});await pause();
      const spacing=await ev('('+inspectControlSpacing.toString()+')()');controlCount+=spacing.controls;
      spacingProblems.push(...spacing.problems.map(p=>({screen:label,width,height,...p})));
      assert.equal(await ev('document.querySelector("dialog").scrollWidth>document.querySelector("dialog").clientWidth'),false,label+' overflow');
    }
    await shot('24-'+label+'-spacing');
    await click('[data-action="close-route-sheet"]');
  }
  await shot("22-input-surfaces");
  assert.deepEqual(spacingProblems,[],JSON.stringify(spacingProblems,null,2));
  checks.push(reachableButtons+' buttons scroll fully above fixed navigation and pass center hit testing at 3 sizes');
  checks.push(controlCount+' control touch-size and 8px separation checks across input surfaces; tab/segmented/building groups excluded from independent-control spacing');
  checks.push(total+" visible input bounds/hit checks: before work, active hils/miju, every core log event, backup/statistics at 3 viewport sizes; stored records unchanged");
  await send("Emulation.setDeviceMetricsOverride",{width:411,height:762,deviceScaleFactor:2.63,mobile:true});
  await seed(fixture());
}
