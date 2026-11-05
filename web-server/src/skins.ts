import {mkdir,readFile,readdir,stat,writeFile,rename,rm,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Failure} from './common.js';
import {boundedBody} from './auth.js';
import {SKIN_CACHE_MS,validSkinName} from './skin.js';
type CachedSkin={bytes:Buffer;expires:number};
const validPng=(data:Buffer)=>{
 if(data.length<24||data.length>1024*1024||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return false;
 const width=data.readUInt32BE(16),height=data.readUInt32BE(20);
 return width>0&&height>0&&width<=2048&&height<=16384&&width*height<=4194304;
};
/** One shared provider pipeline and bounded, two-hour memory/disk cache. */
export class Skins {
 private cache=new Map<string,CachedSkin>();
 private pending=new Map<string,Promise<CachedSkin>>();
 private jobs=0;
 private pruning?:Promise<void>;
 constructor(private directory:string,private fetcher:typeof fetch=fetch,private now=Date.now){}
 async init(){await mkdir(this.directory,{recursive:true,mode:0o700});await this.prune();}
 async get(kind:string,name:string):Promise<CachedSkin> {
  if(!['head','body'].includes(kind)||!validSkinName(name))throw new Failure(404,'Not found');
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
  if(this.jobs>=2)throw new Failure(503,'Skin service busy');this.jobs++;
  try {
   const providers=kind==='head'
    ?[`https://minotar.net/helm/${name}/32.png`,`https://mc-heads.net/avatar/${name}/32`]
    :[`https://mineskin.eu/armor/body/${name}/256.png`];
   let failure:Error=new Failure(502,'Skin provider unavailable');
   let bytes:Buffer|undefined;
   for(const url of providers)try {
    const response=await this.fetcher(url,{redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!response.ok){await response.body?.cancel();throw new Failure(502,'Skin provider unavailable');}
    const image=await boundedBody(response,1024*1024);if(!validPng(image))throw new Failure(502,'Invalid skin image');
    bytes=image;break;
   }catch(error){failure=error instanceof Failure?error:new Failure(502,'Skin provider unavailable');}
   if(!bytes)throw failure;
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
  for(const name of await readdir(this.directory))if(/^(head|body)-[a-z0-9_]{3,16}\.png$/.test(name)){
   const file=join(this.directory,name),info=await stat(file).catch(()=>null);
   if(!info)continue;
   if(info.mtimeMs+SKIN_CACHE_MS<=this.now()||info.size>1024*1024)await rm(file,{force:true});
   else entries.push({file,modified:info.mtimeMs});
  }
  entries.sort((a,b)=>b.modified-a.modified);
  await Promise.all(entries.slice(512).map(entry=>rm(entry.file,{force:true})));
 }
}
