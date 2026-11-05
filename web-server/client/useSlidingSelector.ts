import {useLayoutEffect,useRef} from 'react';

/** Move one highlight between selected buttons, including wrapped and scrolled rows. */
export function useSlidingSelector(selection:string,enabled=true) {
 const ref=useRef<HTMLDivElement>(null);
 const lastGeometry=useRef('');
 const previousButton=useRef<HTMLElement|null>(null);
 useLayoutEffect(()=>{
  const group=ref.current;if(!group||!enabled)return;
  const marker=group.querySelector<HTMLElement>(':scope > .selector-highlight');
  const selected=group.querySelector<HTMLElement>(':scope > button.selected, :scope > button.active');
  if(!marker)return;
  if(!selected){marker.hidden=true;return;}
  const changed=previousButton.current!==selected;
  previousButton.current=selected;
  const update=(animate=false)=>{
   const next={transform:`translate(${selected.offsetLeft}px, ${selected.offsetTop}px)`,width:selected.offsetWidth+'px',height:selected.offsetHeight+'px'};
   const geometry=[selected.offsetLeft,selected.offsetTop].join(',');
   marker.style.width=next.width;marker.style.height=next.height;
   if(lastGeometry.current===geometry&&!marker.hidden)return;
   lastGeometry.current=geometry;
   const computed=getComputedStyle(marker);
   const before={transform:computed.transform};
   const initialized=!marker.hidden;
   marker.getAnimations().forEach(animation=>animation.cancel());
   Object.assign(marker.style,next);marker.hidden=false;
   if(animate&&initialized&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches)marker.animate([before,{transform:next.transform}],{duration:420,easing:'cubic-bezier(.4,0,.2,1)'});
  };
  update(changed);const observer=new ResizeObserver(()=>update());observer.observe(group);observer.observe(selected);
  return()=>observer.disconnect();
 },[selection,enabled]);
 return ref;
}
