// Measure rendered control boxes, not CSS declarations or successful clicks alone.
export function inspectControlSpacing() {
  const grouped = '.tabbar,.stats-subtabs,.route-mode,.building-grid';
  const elements = [...document.querySelectorAll('button,input,select,textarea')]
    .filter(e => e.checkVisibility() && e.type !== 'file' && e.type !== 'hidden'
      && !['radio','checkbox'].includes(e.type));
  const boxes = elements.map(e => ({e,r:e.getBoundingClientRect(),
    id:e.id || e.dataset.action || e.textContent.trim().slice(0,32)}));
  const problems = [];
  let pairs = 0;
  for (let i=0;i<boxes.length;i++) {
    const a=boxes[i];
    if(a.r.width<43.5 || a.r.height<43.5) problems.push({kind:'touch-size',id:a.id,width:a.r.width,height:a.r.height});
    for(let j=i+1;j<boxes.length;j++) {
      const b=boxes[j];
      if(a.e.closest('dialog')!==b.e.closest('dialog')) continue;
      // Fixed navigation overlaps scrolling content by design; reachability is checked after scrolling each control.
      if(Boolean(a.e.closest('.tabbar'))!==Boolean(b.e.closest('.tabbar'))) continue;
      if(a.e.closest(grouped) && a.e.closest(grouped)===b.e.closest(grouped)) continue;
      const x=Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left);
      const y=Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top);
      if(x>1 && y>1) problems.push({kind:'overlap',a:a.id,b:b.id,x,y});
      else if((x>1 && y>-8) || (y>1 && x>-8)) {
        problems.push({kind:'gap',a:a.id,b:b.id,gap:Math.max(-x,-y)});
      }
      pairs++;
    }
  }
  return {controls:boxes.length,pairs,problems};
}
