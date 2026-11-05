import {dirname,join} from 'node:path';
import {PersistentCache,WEEK_MS,retryDelay,validRetry,type RetryState} from './persistent-cache.js';
import {boundedBody} from './auth.js';
import {validSkinName} from './skin.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type AccountStatus='valid'|'missing'|'unknown';
type Entry=RetryState & {name:string;expires:number;account?:AccountStatus;accountExpires?:number;accountRetryAt?:number};
/** Web-owned fallback: no Minecraft cache writes or server-thread work. */
export class MojangNames {
 private store:PersistentCache<Entry>;
 private valid:PersistentCache<true>;
 private get cache(){return this.store.entries;}
 private active=0;
 private queue:(()=>void)[]=[];
 private pending=new Map<string,Promise<string>>();
 private retryAfter=0;
 constructor(private fetcher:typeof fetch=fetch,private now=Date.now,file?:string){
  this.valid=new PersistentCache<true>(file?join(dirname(file),'valid-uuids.json'):undefined,(key,value):value is true=>UUID.test(key)&&value===true);
  this.store=new PersistentCache<Entry>(file,(key,value):value is Entry=>UUID.test(key)&&validRetry(value)&&typeof (value as Entry).name==='string'&&((value as Entry).name===key||validSkinName((value as Entry).name))&&Number.isFinite((value as Entry).expires));
 }
 async init(){
  await this.store.init();await this.valid.init();
  let changed=false;
  for(const [id,entry] of this.cache){
   if(entry.account==='missing'){if(this.valid.entries.delete(id))changed=true;continue;}
   if(validSkinName(entry.name)&&!this.valid.entries.has(id)){this.valid.entries.set(id,true);changed=true;}
  }
  if(changed)await this.valid.save();
 }
 private async rememberValid(id:string){if(!this.valid.entries.has(id))await this.valid.set(id,true);}
 async resolve(id:string,local:unknown):Promise<string> {
  if(typeof local==='string'&&validSkinName(local)){
   if(UUID.test(id)){
    const key=id.toLowerCase(),cached=this.cache.get(key);
    if(cached?.name!==local||cached.expires<=this.now())await this.store.set(key,{...cached,name:local,expires:this.now()+WEEK_MS,failures:0,retryAt:0});
    if(cached?.account!=='missing')await this.rememberValid(key);
   }
   return local;
  }
  if(!UUID.test(id))return typeof local==='string'?local:id;
  const key=id.toLowerCase(),cached=this.cache.get(key);
  if(cached&&(cached.expires>this.now()||cached.retryAt>this.now()||(cached.account==='missing'&&(cached.accountExpires??0)>this.now())))return cached.name;
  const pending=this.pending.get(key);if(pending)return pending;
  if(this.queue.length>=256||this.retryAfter>this.now())return cached?.name??id;
  const request=this.scheduledLookup(key).finally(()=>this.pending.delete(key));
  this.pending.set(key,request);return request;
 }
 async validate(id:string):Promise<AccountStatus>{
  const raw=id.replaceAll('-','').toLowerCase();
  if(!/^[0-9a-f]{32}$/.test(raw))return 'missing';
  const key=`${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
  const status=()=>{
   if(this.valid.entries.has(key))return 'valid' as const;
   const entry=this.cache.get(key);
   return entry?.accountExpires&&entry.accountExpires>this.now()?entry.account:undefined;
  };
  const cached=status();if(cached)return cached;
  const pending=this.pending.get(key);if(pending)await pending;
  const resolved=status();if(resolved)return resolved;
  const entry=this.cache.get(key);
  if((entry?.accountRetryAt??0)>this.now()||this.retryAfter>this.now()||this.queue.length>=256)return 'unknown';
  const request=this.scheduledLookup(key,true).finally(()=>this.pending.delete(key));
  this.pending.set(key,request);await request;
  return status()??'unknown';
 }
 private async scheduledLookup(id:string,validate=false):Promise<string>{
  if(this.active>=2)await new Promise<void>(resolve=>this.queue.push(resolve));
  else this.active++;
  try{
   const cached=this.cache.get(id);
   if(validate){
    if(cached&&((cached.accountExpires??0)>this.now()||(cached.accountRetryAt??0)>this.now()))return cached.name;
   }else if(cached&&(cached.expires>this.now()||cached.retryAt>this.now()||(cached.account==='missing'&&(cached.accountExpires??0)>this.now())))return cached.name;
   if(this.retryAfter>this.now())return cached?.name??id;
   return await this.lookup(id);
  }finally{const next=this.queue.shift();if(next)next();else this.active--;}
 }
 private async lookup(id:string):Promise<string> {
  const previous=this.cache.get(id);let name=previous?.name??id,success=false;
  let account:AccountStatus='unknown';
  try {
   const response=await this.fetcher('https://sessionserver.mojang.com/session/minecraft/profile/'+id.replaceAll('-',''),{redirect:'error',signal:AbortSignal.timeout(3000)});
   if(response.status===429||response.status>=500)this.retryAfter=this.now()+retryDelay((previous?.failures??0)+1);
   if(response.status===204||response.status===404)account='missing';
   if(response.status===200){
    const profile=JSON.parse((await boundedBody(response,64*1024)).toString());
    if(typeof profile.id==='string'&&profile.id.toLowerCase()===id.replaceAll('-','')&&typeof profile.name==='string'&&validSkinName(profile.name)){name=profile.name;success=true;account='valid';}
   }else await response.body?.cancel();
  }catch{this.retryAfter=this.now()+retryDelay((previous?.failures??0)+1);}
  // A local name received while this request was in flight remains authoritative.
  const current=this.cache.get(id);
  const localOverride=current!==previous&&current&&current.expires>this.now()?current:undefined;
  const failures=success?0:(previous?.failures??0)+1;
  const result={name,expires:success?this.now()+WEEK_MS:0,failures,retryAt:success?0:this.now()+retryDelay(failures),...localOverride,
   account,accountExpires:account==='unknown'?0:this.now()+WEEK_MS,accountRetryAt:account==='unknown'?this.now()+retryDelay(failures):0};
  await this.store.set(id,result);
  if(account==='valid')await this.rememberValid(id);
  else if(account==='missing'&&this.valid.entries.delete(id))await this.valid.save();
  return result.name;
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
