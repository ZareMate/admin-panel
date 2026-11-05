import type {MojangNames,AccountStatus} from './mojang-names.js';
import {PersistentCache,retryDelay,validRetry,type RetryState} from './persistent-cache.js';
import {mkdir,readFile,readdir,stat,writeFile,rename,rm,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Failure} from './common.js';
import {boundedBody} from './auth.js';
import {SKIN_CACHE_MS,validSkinIdentity} from './skin.js';
type FailureReason='http-error'|'invalid-png'|'empty-response'|'response-too-large'|'timeout'|'network-error';
export type SkinFailureLog={event:'skin_lookup_failed';identity:string;kind:string;provider:string;url:string;
 reason:FailureReason;upstreamStatus?:number;contentType?:string;responseBytes?:number;errorType?:string;networkCode?:string;
 elapsedMs:number;account:AccountStatus|'not-checked';failures:number;retryAt:number;retryDelayMs:number};
type SkinRetry=RetryState & {account?:AccountStatus;lastFailure?:SkinFailureLog};
type CachedSkin={bytes:Buffer;expires:number};
const validPng=(data:Buffer)=>{
 if(data.length<24||data.length>1024*1024||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return false;
 const width=data.readUInt32BE(16),height=data.readUInt32BE(20);
 return width>0&&height>0&&width<=2048&&height<=16384&&width*height<=4194304;
};
/** One shared provider pipeline and bounded, seven-day memory/disk cache. */
export class Skins {
 private cache=new Map<string,CachedSkin>();
 private pending=new Map<string,Promise<CachedSkin>>();
 private jobs=0;
 private retries:PersistentCache<SkinRetry>;
 private pruning?:Promise<void>;
 private retryTimer?:ReturnType<typeof setInterval>;
 private retrying?:Promise<void>;
 private stopped=false;
 constructor(private directory:string,private fetcher:typeof fetch=fetch,private now=Date.now,private profiles?:Pick<MojangNames,'validate'>,private warn:(fields:SkinFailureLog)=>void=()=>{}){
  this.retries=new PersistentCache(join(directory,'retries.json'),(key,value):value is SkinRetry=>['head-','body-'].some(prefix=>key.startsWith(prefix)&&validSkinIdentity(key.slice(prefix.length)))&&validRetry(value));
 }
 async init(){await mkdir(this.directory,{recursive:true,mode:0o700});await this.prune();await this.retries.init();}
 /** Recover overdue persisted failures, including those missed while offline. */
 startRetries(){
  if(this.retryTimer||this.stopped)return;
  this.retryTimer=setInterval(()=>{void this.retryDue();},1000);this.retryTimer.unref();
  void this.retryDue();
 }
 async retryDue():Promise<void>{
  if(this.stopped)return;
  if(this.retrying)return this.retrying;
  this.retrying=this.retryBatch().finally(()=>{this.retrying=undefined;});
  return this.retrying;
 }
 private async retryBatch(){
  const slots=Math.max(0,2-Math.max(this.jobs,this.pending.size));
  const due=[...this.retries.entries].filter(([key,retry])=>retry.failures>0&&retry.retryAt<=this.now()&&!this.pending.has(key))
   .sort((a,b)=>a[1].retryAt-b[1].retryAt).slice(0,slots);
  await Promise.all(due.map(async([key])=>{
   const separator=key.indexOf('-');
   try{
    await this.get(key.slice(0,separator),key.slice(separator+1));
    if(this.retries.entries.get(key)?.failures)await this.retries.set(key,{failures:0,retryAt:0});
   }catch{/* Failure details and backoff are persisted by load(). */}
  }));
 }
 async close(){
  this.stopped=true;clearInterval(this.retryTimer);this.retryTimer=undefined;
  await this.retrying;
 }
 async get(kind:string,name:string):Promise<CachedSkin> {
  if(!['head','body'].includes(kind)||!validSkinIdentity(name))throw new Failure(404,'Not found');
  const key=kind+'-'+name.toLowerCase(),cached=this.cache.get(key);
  if(cached&&cached.expires>this.now())return cached;
  this.cache.delete(key);
  const existing=this.pending.get(key);if(existing)return existing;
  const request=this.load(kind,name,key);this.pending.set(key,request);
  try{return await request;}finally{this.pending.delete(key);}
 }
 private remember(key:string,value:CachedSkin){
  if(this.cache.size>=512)this.cache.delete(this.cache.keys().next().value!);
  this.cache.set(key,value);return value;
 }
 private async load(kind:string,name:string,key:string):Promise<CachedSkin> {
  const file=join(this.directory,key+'.png');
  try {
   const info=await stat(file);
   if(info.isFile()&&info.size<=1024*1024&&info.mtimeMs+SKIN_CACHE_MS>this.now()) {
    const bytes=await readFile(file);
    if(validPng(bytes))return this.remember(key,{bytes,expires:info.mtimeMs+SKIN_CACHE_MS});
   }
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  // Mineskin redirects hyphenated UUIDs; use its canonical URL directly.
  const identity=name.length>16?name.replaceAll('-','').toLowerCase():name;
  const url=kind==='head'?`https://mineskin.eu/helm/${identity}/32.png`:`https://mineskin.eu/armor/body/${identity}/256.png`;
  const savedRetry=this.retries.entries.get(key);
  const changedUrl=savedRetry?.lastFailure&&savedRetry.lastFailure.url!==url;
  const retry=changedUrl?undefined:savedRetry;
  if(retry&&retry.retryAt>this.now()){
   if(retry.account==='missing')throw new Failure(404,'No Mojang account exists for this UUID','skin-profile-missing');
   throw new Failure(503,'Skin provider cooling down; retry later');
  }
  if(this.jobs>=2)throw new Failure(503,'Skin service busy');this.jobs++;
  try {
   const providers=[url];
   let failure:Error=new Failure(502,'Skin provider unavailable');
   let bytes:Buffer|undefined;
   const started=this.now();
   let reason:FailureReason='network-error',upstreamStatus:number|undefined,contentType:string|undefined,responseBytes:number|undefined,errorType:string|undefined,networkCode:string|undefined;
   for(const url of providers)try {
    const response=await this.fetcher(url,{redirect:'error',signal:AbortSignal.timeout(8000)});
    upstreamStatus=response.status;
    const mediaType=response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    contentType=mediaType&&['image/png','image/jpeg','image/webp','text/html','text/plain','application/json','application/octet-stream'].includes(mediaType)?mediaType:mediaType?'other':undefined;
    if(!response.ok){reason='http-error';await response.body?.cancel();throw new Failure(502,'Skin provider unavailable');}
    const image=await boundedBody(response,1024*1024);responseBytes=image.length;
    if(!validPng(image)){reason='invalid-png';throw new Failure(502,'Invalid skin image');}
    bytes=image;break;
   }catch(error){
    if(error instanceof Failure){
     if(error.message==='Empty upstream response')reason='empty-response';
     else if(error.message==='Upstream response too large')reason='response-too-large';
    }else{
     errorType=error instanceof Error&&['TimeoutError','AbortError','TypeError'].includes(error.name)?error.name:'Error';
     const cause=error instanceof Error?error.cause:undefined;
     const code=cause&&typeof cause==='object'&&'code' in cause?cause.code:undefined;
     if(typeof code==='string'&&['ENOTFOUND','EAI_AGAIN','ECONNREFUSED','ECONNRESET','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID'].includes(code))networkCode=code;
     reason=errorType==='TimeoutError'||errorType==='AbortError'?'timeout':'network-error';
    }
    failure=error instanceof Failure?error:new Failure(502,'Skin provider unavailable');
   }
   if(!bytes){
    const failures=(retry?.failures??0)+1;
    let account:AccountStatus|undefined;
    if(this.profiles&&/^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(name)){
     try{account=await this.profiles.validate(name);}catch{account='unknown';}
    }
    const delay=retryDelay(failures),retryAt=this.now()+delay;
    const detail:SkinFailureLog={event:'skin_lookup_failed',identity:name,kind,provider:'mineskin.eu',url:providers[0]!,
     reason,upstreamStatus,contentType,responseBytes,errorType,networkCode,elapsedMs:Math.max(0,this.now()-started),account:account??'not-checked',failures,retryAt,retryDelayMs:delay};
    this.warn(detail);
    await this.retries.set(key,{failures,retryAt,account,lastFailure:detail});
    if(account==='missing')throw new Failure(404,'No Mojang account exists for this UUID','skin-profile-missing');
    throw failure;
   }
   if(savedRetry)await this.retries.set(key,{failures:0,retryAt:0});
   await mkdir(this.directory,{recursive:true,mode:0o700});
   const temporary=file+'.'+randomUUID()+'.tmp';
   try{await writeFile(temporary,bytes,{mode:0o600});await utimes(temporary,new Date(this.now()),new Date(this.now()));await rename(temporary,file);}finally{await rm(temporary,{force:true});}
   const value=this.remember(key,{bytes,expires:this.now()+SKIN_CACHE_MS});
   await this.prune();return value;
  }finally{this.jobs--;}
 }
 private prune():Promise<void> {
  if(this.pruning)return this.pruning;
  this.pruning=this.pruneFiles().finally(()=>{this.pruning=undefined;});return this.pruning;
 }
 private async pruneFiles(){
  const entries=[];
  for(const name of await readdir(this.directory))if(name.endsWith('.png')&&['head-','body-'].some(prefix=>name.startsWith(prefix)&&validSkinIdentity(name.slice(prefix.length,-4)))){
   const file=join(this.directory,name),info=await stat(file).catch(()=>null);
   if(!info)continue;
   if(info.mtimeMs+SKIN_CACHE_MS<=this.now()||info.size>1024*1024)await rm(file,{force:true});
   else entries.push({file,modified:info.mtimeMs});
  }
  entries.sort((a,b)=>b.modified-a.modified);
  await Promise.all(entries.slice(512).map(entry=>rm(entry.file,{force:true})));
 }
}
