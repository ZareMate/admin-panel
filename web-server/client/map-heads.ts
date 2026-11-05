import {skinPath,validSkinIdentity,SKIN_CACHE_MS} from '../src/skin';
import {useEffect,useRef,useState} from 'react';

/** A persistent queue avoids aborting all heads whenever map visibility changes. */
export class MapHeadLoader {
 private wanted=new Set<string>();
 private pending=new Map<string,AbortController>();
 private expires=new Map<string,number>();
 private failures=new Map<string,{attempts:number;retryAt:number}>();
 private timer:ReturnType<typeof setTimeout>|undefined;
 private closed=false;
 constructor(readonly images:Map<string,ImageBitmap>,private changed:()=>void,
  private fetcher:typeof fetch=(...args)=>fetch(...args),
  private decode:(blob:Blob)=>Promise<ImageBitmap>=blob=>createImageBitmap(blob),
  private retryDelay=1000,private now=Date.now){}
 update(names:string[]) {
  this.wanted=new Set(names.filter(name=>validSkinIdentity(name)).slice(0,128));
  for(const name of this.failures.keys())if(!this.wanted.has(name))this.failures.delete(name);
  this.pump();
 }
 private pump() {
  if(this.closed)return;
  clearTimeout(this.timer);
  let nextRetry=Infinity;
  for(const name of this.wanted){
   if(this.images.has(name)){
    const expires=this.expires.get(name)??0;
    if(expires>this.now()){nextRetry=Math.min(nextRetry,expires);continue;}
    this.images.get(name)!.close();this.images.delete(name);this.expires.delete(name);this.changed();
   }
   if(this.pending.has(name))continue;
   const retryAt=this.failures.get(name)?.retryAt??0;
   if(retryAt>this.now()){nextRetry=Math.min(nextRetry,retryAt);continue;}
   if(this.pending.size<2)void this.load(name);
  }
  if(Number.isFinite(nextRetry))this.timer=setTimeout(()=>this.pump(),Math.max(1,nextRetry-this.now()));
 }
 private async load(name:string) {
  const abort=new AbortController();this.pending.set(name,abort);
  const timeout=setTimeout(()=>abort.abort(),20000);
  try{
   const response=await this.fetcher(skinPath('head',name),{signal:abort.signal});
   if(!response.ok){await response.body?.cancel();throw new Error('Head unavailable');}
   const image=await this.decode(await response.blob());
   if(this.closed){image.close();return;}
   if(this.images.size>=128){
    const oldest=[...this.images.keys()].find(key=>!this.wanted.has(key))??this.images.keys().next().value!;
    this.images.get(oldest)!.close();this.images.delete(oldest);this.expires.delete(oldest);
   }
   const seconds=/max-age=(\d+)/i.exec(response.headers.get('cache-control')||'')?.[1];
   const ttl=seconds===undefined?SKIN_CACHE_MS:Math.min(SKIN_CACHE_MS,Number(seconds)*1000);
   const responseDate=Date.parse(response.headers.get('date')||'');
   this.expires.set(name,Math.max(this.now()+1000,Math.min(this.now()+SKIN_CACHE_MS,Number.isFinite(responseDate)?responseDate+ttl:this.now()+ttl)));
   this.images.set(name,image);this.failures.delete(name);this.changed();
  }catch{
   if(!this.closed&&this.wanted.has(name)){
    const attempts=(this.failures.get(name)?.attempts??0)+1;
    this.failures.set(name,{attempts,retryAt:this.now()+Math.min(30000,this.retryDelay*2**Math.min(attempts-1,5))});
   }
  }finally{clearTimeout(timeout);this.pending.delete(name);this.pump();}
 }
 dispose(){
  this.closed=true;clearTimeout(this.timer);for(const abort of this.pending.values())abort.abort();
  for(const image of this.images.values())image.close();this.images.clear();this.failures.clear();this.expires.clear();
 }
}

export function useMapHeads(names:string[]) {
 const cache=useRef(new Map<string,ImageBitmap>()),loader=useRef<MapHeadLoader|null>(null);
 const [version,setVersion]=useState(0);
 const key=JSON.stringify([...new Set(names)].sort());
 useEffect(()=>{
  const current=new MapHeadLoader(cache.current,()=>setVersion(old=>old+1));loader.current=current;
  return()=>{current.dispose();loader.current=null;};
 },[]);
 useEffect(()=>loader.current?.update(JSON.parse(key) as string[]),[key]);
 return {images:cache.current,version};
}
