import assert from "node:assert/strict";

// This exercises native-sized WebView geometry, not a real Android IME.
export async function runKeyboardChecks({ev,send,seed,fixture,read,click,input,tab,pause,shot,checks}) {
  let cases=0;
  for(const mode of ["quantity","hour","minute","name"]){
    await seed(fixture());
    await send("Emulation.setDeviceMetricsOverride",{width:411,height:762,deviceScaleFactor:2.63,mobile:true});
    let selector="#hils-count",value="100";
    if(mode==="hour"||mode==="minute"){
      await tab("log");await click('[data-action="open-log-edit"][data-event="start"]');
      selector="#log-edit-start-time-"+mode;value=mode==="hour"?"12":"30";
    } else if(mode==="name") {
      await click('[data-action="open-route-editor"][data-zone="hils"]');await click('[name="route-mode"][value="alt"]');
      selector="#route-name";value="입력 여백 확인";
    }
    const before=await read();await input(selector,value);
    // Force a stale second IME subtraction: native layout must ignore this visual gap.
    await ev('window.__viewportDescriptor=Object.getOwnPropertyDescriptor(window,"visualViewport");Object.defineProperty(window,"visualViewport",{configurable:true,value:{height:100,offsetTop:0}});true');
    for(const height of [520,430,320]){
      await send("Emulation.setDeviceMetricsOverride",{width:411,height,deviceScaleFactor:2.63,mobile:true});
      await ev(`document.querySelector(${JSON.stringify(selector)}).focus();window.dispatchEvent(new Event("resize"))`);await pause(180);
      const bounds=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),n=document.querySelector('.tabbar').getBoundingClientRect(),d=e.closest('dialog'),s=getComputedStyle(document.documentElement);return {top:r.top,bottom:r.bottom,limit:d?d.getBoundingClientRect().bottom:n.top,navBottom:n.bottom,inset:s.getPropertyValue('--app-keyboard-inset'),height:s.getPropertyValue('--app-visible-height'),value:e.value,hit:e===document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)}})()`);
      assert.equal(bounds.inset,"0px",`${mode}: double IME padding`);
      assert.equal(bounds.height,height+"px");assert(Math.abs(bounds.navBottom-height)<2);
      assert(bounds.top>=0&&bounds.bottom<=bounds.limit&&bounds.hit,`${mode}/${height} hidden: `+JSON.stringify(bounds));
      assert.equal(bounds.value,value);assert.deepEqual(await read(),before);cases++;
      if(height===430)await shot("20-native-keyboard-"+mode);
    }
    await ev('Object.defineProperty(window,"visualViewport",window.__viewportDescriptor);document.activeElement.blur()');
    await send("Emulation.setDeviceMetricsOverride",{width:411,height:762,deviceScaleFactor:2.63,mobile:true});await pause(180);
    assert.equal(await ev('getComputedStyle(document.documentElement).getPropertyValue("--app-keyboard-inset")'),"0px");
    assert(await ev('Math.abs(document.querySelector(".tabbar").getBoundingClientRect().bottom-762)<2'));
    assert.equal(await ev(`document.querySelector(${JSON.stringify(selector)}).value`),value);
    assert.deepEqual(await read(),before);cases++;
  }
  checks.push(`native-sized keyboard geometry ${cases} checks: quantity/hour/minute/name, 3 IME heights plus close, stale visual gap never counted twice, input accessible and records unchanged`);
  await seed(fixture());
}
