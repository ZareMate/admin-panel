import {PersistentCache,WEEK_MS,retryDelay,validRetry,type RetryState} from './persistent-cache.js';
import {boundedBody} from './auth.js';
import {validSkinName} from './skin.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Entry=RetryState & {name:string;expires:number};
/** Web-owned fallback: no Minecraft cache writes or server-thread work. */
export class MojangNames {
 private store:PersistentCache<Entry>;
 private get cache(){return this.store.entries;}
 private active=0;
 private queue:(()=>void)[]=[];
 private pending=new Map<string,Promise<string>>();
 private retryAfter=0;
 constructor(private fetcher:typeof fetch=fetch,private now=Date.now,file?:string){
  this.store=new PersistentCache<Entry>(file,(key,value):value is Entry=>UUID.test(key)&&validRetry(value)&&typeof (value as Entry).name==='string'&&((value as Entry).name===key||validSkinName((value as Entry).name))&&Number.isFinite((value as Entry).expires));
 }
 async init(){await this.store.init();}
 async resolve(id:string,local:unknown):Promise<string> {
  if(typeof local==='string'&&validSkinName(local)){
   if(UUID.test(id)){
    const key=id.toLowerCase(),cached=this.cache.get(key);
    if(cached?.name!==local||cached.expires<=this.now())await this.store.set(key,{name:local,expires:this.now()+WEEK_MS,failures:0,retryAt:0});
   }
   return local;
  }
  if(!UUID.test(id))return typeof local==='string'?local:id;
  const key=id.toLowerCase(),cached=this.cache.get(key);
  if(cached&&(cached.expires>this.now()||cached.retryAt>this.now()))return cached.name;
  const pending=this.pending.get(key);if(pending)return pending;
  if(this.queue.length>=256||this.retryAfter>this.now())return cached?.name??id;
  const request=this.scheduledLookup(key).finally(()=>this.pending.delete(key));
  this.pending.set(key,request);return request;
 }
 private async scheduledLookup(id:string):Promise<string>{
  if(this.active>=2)await new Promise<void>(resolve=>this.queue.push(resolve));
  else this.active++;
  try{
   const cached=this.cache.get(id);
   if(cached&&(cached.expires>this.now()||cached.retryAt>this.now()))return cached.name;
   if(this.retryAfter>this.now())return cached?.name??id;
   return await this.lookup(id);
  }finally{const next=this.queue.shift();if(next)next();else this.active--;}
 }
 private async lookup(id:string):Promise<string> {
  const previous=this.cache.get(id);let name=previous?.name??id,success=false;
  try {
   const response=await this.fetcher('https://sessionserver.mojang.com/session/minecraft/profile/'+id.replaceAll('-',''),{redirect:'error',signal:AbortSignal.timeout(3000)});
   if(response.status===429||response.status>=500)this.retryAfter=this.now()+retryDelay((previous?.failures??0)+1);
   if(response.status===200){
    const profile=JSON.parse((await boundedBody(response,64*1024)).toString());
    if(typeof profile.id==='string'&&profile.id.toLowerCase()===id.replaceAll('-','')&&typeof profile.name==='string'&&validSkinName(profile.name)){name=profile.name;success=true;}
   }else await response.body?.cancel();
  }catch{this.retryAfter=this.now()+retryDelay((previous?.failures??0)+1);}
  // A local name received while this request was in flight remains authoritative.
  const current=this.cache.get(id);if(current!==previous&&current&&current.expires>this.now())return current.name;
  const failures=success?0:(previous?.failures??0)+1;
  await this.store.set(id,{name,expires:success?this.now()+WEEK_MS:0,failures,retryAt:success?0:this.now()+retryDelay(failures)});
  return name;
 }
 snapshot<T>(input:T):T {
  const data=structuredClone(input);
  const apply=(value:unknown)=>{
   if(!value||typeof value!=='object')return;
   const row=value as Record<string,unknown>;if(typeof row.uuid!=='string')return;
   const local=row.name;
   row.name=typeof local==='string'&&validSkinName(local)?local:this.cache.get(row.uuid.toLowerCase())?.name??row.uuid;
   if(row.identity&&typeof row.identity==='object')(row.identity as Record<string,unknown>).name=row.name;
   if(row.tsa&&typeof row.tsa==='object')(row.tsa as Record<string,unknown>).playerName=row.name;
  };
  if(data&&typeof data==='object'){
   const root=data as Record<string,unknown>;
   if(Array.isArray(root.players))root.players.forEach(apply);else apply(root);
  }
  return data;
 }
 async enrich<T>(input:T):Promise<T> {
  // Bridge snapshots can be reused by other requests; never mutate them.
  const data=structuredClone(input);
  const enrichPlayer=async(value:unknown)=>{
   if(!value||typeof value!=='object')return;
   const row=value as Record<string,unknown>;
   if(typeof row.uuid!=='string')return;
   row.name=await this.resolve(row.uuid,row.name);
   if(row.identity&&typeof row.identity==='object')(row.identity as Record<string,unknown>).name=row.name;
   if(row.tsa&&typeof row.tsa==='object')(row.tsa as Record<string,unknown>).playerName=row.name;
  };
  if(data&&typeof data==='object'){
   const root=data as Record<string,unknown>;
   if(Array.isArray(root.players)){
    for(let offset=0;offset<root.players.length;offset+=20)await Promise.all(root.players.slice(offset,offset+20).map(enrichPlayer));
   }
   else await enrichPlayer(root);
  }
  return data;
 }
}
