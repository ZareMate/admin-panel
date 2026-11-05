import {useEffect,useRef} from 'react';

/** Animate tab content without remounting it or interrupting live updates. */
export function useTabTransition(tab:string) {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const element=ref.current;
    const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    if(!element||motion.matches)return;
    const animation=element.animate([
      {opacity:0.45,transform:'translateY(6px)'},
      {opacity:1,transform:'translateY(0)'}
    ],{duration:180,easing:'cubic-bezier(0.2, 0.7, 0.2, 1)'});
    const stop=()=>{if(motion.matches)animation.cancel();};
    motion.addEventListener('change',stop);
    return()=>{animation.cancel();motion.removeEventListener('change',stop);};
  },[tab]);
  return ref;
}
