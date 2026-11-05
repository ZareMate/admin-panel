import {mkdir,readdir,readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {Failure} from './common.js';

export function mapDimension(value:unknown):string {
 if(typeof value!=='string'||value.length>128||!/^[-a-z0-9_.]+:[-a-z0-9_./]+$/.test(value))throw new Failure(400,'Invalid map dimension');
 return value;
}
export function mapRegion(value:unknown) {
 if(typeof value!=='string')throw new Failure(400,'Invalid region filename');
 const match=/^([0-9a-f]{5})-([0-9a-f]{5})(?:\(\d+\))?(?:\.zip)?$/i.exec(value);
 if(!match)throw new Failure(400,'Expected an FTB Chunks XXXXX-XXXXX.zip region');
 return {name:(match[1]+'-'+match[2]).toUpperCase(),x:parseInt(match[1]!,16)-60000,z:parseInt(match[2]!,16)-60000};
}
type ImportResult={archive:Uint8Array;png:Uint8Array;merged:boolean;chunks:number};
export class PlayerMap {
 private busy=false;
 private worker?:Worker;
 constructor(private directory:string){}
 private folder(dimension:string){return join(this.directory,encodeURIComponent(mapDimension(dimension)));}
 async regions(dimension:string) {
  const directory=this.folder(dimension);
  const files=await readdir(directory).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;});
  const regions=[];
  for(const file of files.sort())if(/^[0-9A-F]{5}-[0-9A-F]{5}\.png$/.test(file)){
   const region=mapRegion(file.slice(0,-4)),info=await stat(join(directory,file)).catch(()=>null);
   if(info)regions.push({...region,updatedAt:info.mtimeMs});
  }
  return {dimension,regions};
 }
 async tile(dimension:string,region:string) {
  try{return await readFile(join(this.folder(dimension),mapRegion(region).name+'.png'));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw new Failure(404,'Map region not found');throw error;}
 }
 private runWorker<T>(data:Record<string,unknown>):Promise<T> {
  return new Promise<T>((resolve,reject)=>{
   const worker=new Worker(new URL('./ftb/import-worker.js',import.meta.url),{workerData:data,resourceLimits:{maxOldGenerationSizeMb:192}});
   this.worker=worker;
   const timer=setTimeout(()=>{void worker.terminate();reject(new Failure(400,'Map import timed out'));},30000);
   worker.once('message',(message:T&{error?:string})=>{if(message.error)reject(new Failure(400,'Invalid FTB Chunks ZIP: '+message.error));else resolve(message);});
   worker.once('error',()=>reject(new Failure(400,'Map import failed')));
   worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new Failure(400,'Map import stopped'));});
  });
 }
 async import(dimension:string,filename:string,base64:unknown) {
  const directory=this.folder(dimension);
  if(!/^[^/\\]+\.zip$/i.test(filename)||filename.length>128)throw new Failure(400,'Expected an FTB Chunks region or cache ZIP');
  if(typeof base64!=='string'||!base64.length||base64.length>28*1024*1024||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new Failure(400,'Invalid ZIP data (maximum 20 MiB)');
  const incoming=Buffer.from(base64,'base64');
  if(incoming.length>20*1024*1024)throw new Failure(413,'ZIP exceeds 20 MiB');
  if(this.busy)throw new Failure(429,'A map import is already running; try again shortly');
  this.busy=true;
  try {
   const upload=await this.runWorker<{regions:{name:string;archive:Uint8Array}[];palette:Record<string,string>}>({mode:'extract',incoming,filename,dimension});
   const current=await this.regions(dimension);
   const names=new Set([...current.regions.map(item=>item.name),...upload.regions.map(item=>item.name)]);
   if(names.size>512)throw new Failure(409,'Map dimension has reached the 512-region limit');
   let merged=false,chunks=0;
   for(const item of upload.regions){
    const result=await this.importRegion(directory,item.name,Buffer.from(item.archive),upload.palette);
    merged=merged||result.merged;chunks+=result.chunks;
   }
   return {region:mapRegion(upload.regions[0]!.name),regions:upload.regions.length,merged,chunks};
  }finally{this.busy=false;this.worker=undefined;}
 }
 private async importRegion(directory:string,name:string,incoming:Buffer,uploadedPalette:Record<string,string>) {
  const region=mapRegion(name),temporary=join(directory,region.name+'.'+randomUUID());
  try{
   const previous=await readFile(join(directory,region.name+'.zip')).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
   const previousPalette=await readFile(join(directory,region.name+'.palette.json'),'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return '{}';throw error;});
   const palette={...JSON.parse(previousPalette) as Record<string,string>,...uploadedPalette};
   const result=await this.runWorker<ImportResult>({incoming,previous,region:region.name,palette});
   await mkdir(directory,{recursive:true});
   await writeFile(temporary+'.zip',result.archive,{mode:0o600});
   await writeFile(temporary+'.png',result.png,{mode:0o600});
   await writeFile(temporary+'.palette.json',JSON.stringify(palette),{mode:0o600});
   await rename(temporary+'.zip',join(directory,region.name+'.zip'));
   await rename(temporary+'.png',join(directory,region.name+'.png'));
   await rename(temporary+'.palette.json',join(directory,region.name+'.palette.json'));
   return result;
  }finally{
   await Promise.all(['.zip','.png','.palette.json'].map(suffix=>rm(temporary+suffix,{force:true})));
  }
 }
 async remove(dimension:string,region:string) {
  const directory=this.folder(dimension),name=mapRegion(region).name;
  if(this.busy)throw new Failure(429,'A map import is running; try again shortly');
  await Promise.all([rm(join(directory,name+'.zip'),{force:true}),rm(join(directory,name+'.png'),{force:true}),rm(join(directory,name+'.palette.json'),{force:true})]);
  return {removed:true};
 }
 close(){void this.worker?.terminate();}
}
