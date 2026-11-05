import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export {WEEK_MS,retryDelay} from './cache-policy.js';
/** Serialized atomic snapshots prevent concurrent writers from losing newer entries. */
export class PersistentCache<T> {
 readonly entries=new Map<string,T>();
 private writing=Promise.resolve();
 constructor(private file:string|undefined,private valid:(key:string,value:unknown)=>value is T){}
 async init(){
  if(!this.file)return;
  try{const data=JSON.parse(await readFile(this.file,'utf8'));if(Array.isArray(data))for(const row of data){if(!Array.isArray(row)||row.length!==2)continue;const [key,value]=row;if(typeof key==='string'&&this.valid(key,value))this.entries.set(key,value);}}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
  this.trim();
 }
 private trim(){while(this.entries.size>10_000)this.entries.delete(this.entries.keys().next().value!);}
 async set(key:string,value:T){
  this.entries.delete(key);this.entries.set(key,value);this.trim();
  if(!this.file)return;
  const file=this.file,snapshot=JSON.stringify([...this.entries]);
  const write=this.writing.catch(()=>{}).then(async()=>{
   await mkdir(dirname(file),{recursive:true,mode:0o700});const temporary=file+'.'+randomUUID()+'.tmp';
   try{await writeFile(temporary,snapshot,{mode:0o600});await rename(temporary,file);}finally{await rm(temporary,{force:true});}
  });this.writing=write;await write;
 }
}
export type RetryState={failures:number;retryAt:number};
export const validRetry=(value:unknown):value is RetryState=>!!value&&typeof value==='object'&&Number.isInteger((value as RetryState).failures)&&(value as RetryState).failures>=0&&Number.isFinite((value as RetryState).retryAt);
