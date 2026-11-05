import {useEffect,useRef,useState} from 'react';
import {skinPath} from '../src/skin';
import {retryDelay} from '../src/cache-policy';

/** Failed image elements need a new URL to retry while the profile remains open. */
export function useSkinImage(kind:'head'|'body',name:string){
 const [attempt,setAttempt]=useState(0),[loaded,setLoaded]=useState(false);
 const failures=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>{
  clearTimeout(timer.current);timer.current=undefined;failures.current=0;setAttempt(0);setLoaded(false);
  return()=>clearTimeout(timer.current);
 },[kind,name]);
 return {src:skinPath(kind,name)+(attempt?'&retry='+attempt:''),loaded,
  onLoad:()=>{clearTimeout(timer.current);timer.current=undefined;failures.current=0;setLoaded(true);},
  onError:()=>{
   setLoaded(false);if(timer.current!==undefined)return;
   failures.current++;
   timer.current=setTimeout(()=>{timer.current=undefined;setAttempt(value=>value+1);},retryDelay(failures.current));
  }};
}
