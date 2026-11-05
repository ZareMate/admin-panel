import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MojangNames} from '../src/mojang-names.js';
import {WEEK_MS} from '../src/persistent-cache.js';
const id='069a79f4-44e9-4726-a5be-fca90e38aaf5';
const profile={id:id.replaceAll('-',''),name:'Notch'};
test('deduplicates, persists names for seven days and local overrides survive restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'panel-names-'));let now=1,calls=0;
 const file=join(dir,'names.json');const fetcher:typeof fetch=async()=>{calls++;return Response.json(profile);};
 try{
  const names=new MojangNames(fetcher,()=>now,file);await names.init();
  assert.deepEqual(await Promise.all([names.resolve(id,id),names.resolve(id,null)]),['Notch','Notch']);assert.equal(calls,1);
  now+=WEEK_MS-1;
  const restarted=new MojangNames(fetcher,()=>now,file);await restarted.init();
  assert.equal(await restarted.resolve(id,null),'Notch');assert.equal(calls,1);
  now+=2;await restarted.resolve(id,null);assert.equal(calls,2);
  assert.equal(await restarted.resolve(id,'LocalName'),'LocalName');assert.equal(calls,2);
  const local=new MojangNames(fetcher,()=>now,file);await local.init();assert.equal(await local.resolve(id,null),'LocalName');assert.equal(calls,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('enriches all batched list entries with two concurrent lookups, and preserves snapshots',async()=>{
 let active=0,max=0,calls=0;
 const names=new MojangNames(async url=>{
  calls++;active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,1));active--;
  return Response.json({id:String(url).split('/').at(-1),name:'Player'+calls});
 });
 const input={players:Array.from({length:45},(_,i)=>({uuid:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,name:''}))};
 const result=await names.enrich(input);assert.equal(calls,45);assert.equal(max,2);assert(result.players.every(row=>row.name.startsWith('Player')));assert.equal(input.players[0]!.name,'');
 const detail=await names.enrich({uuid:id,name:'LocalName',identity:{name:id},tsa:{playerName:id}});
 assert.equal(detail.identity.name,'LocalName');assert.equal(detail.tsa.playerName,'LocalName');
});
test('failed lookups persist exponential retry delays, reset after success',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'panel-names-retry-'));let now=1,calls=0,success=false;
 const file=join(dir,'names.json');const fetcher:typeof fetch=async()=>{calls++;return success?Response.json(profile):new Response(null,{status:429});};
 try{
  let names=new MojangNames(fetcher,()=>now,file);await names.init();
  assert.equal(await names.resolve(id,null),id);assert.equal(calls,1);
  names=new MojangNames(fetcher,()=>now,file);await names.init();
  now+=29_999;await names.resolve(id,null);assert.equal(calls,1);
  now++;await names.resolve(id,null);assert.equal(calls,2);
  now+=30_000;await names.resolve(id,null);assert.equal(calls,2);
  now+=30_000;success=true;assert.equal(await names.resolve(id,null),'Notch');assert.equal(calls,3);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('local names arriving during remote requests remain authoritative',async()=>{
 let complete!:(response:Response)=>void;
 const names=new MojangNames(async()=>new Promise(resolve=>{complete=resolve;}));
 const remote=names.resolve(id,null);await names.resolve(id,'LocalName');complete(Response.json(profile));
 assert.equal(await remote,'LocalName');assert.equal(await names.resolve(id,null),'LocalName');
});
test('corrupt disk rows and invalid remote profiles are ignored',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'panel-names-corrupt-'));
 try{
  const file=join(dir,'names.json');await writeFile(file,JSON.stringify([null,1,['invalid',{}],[id,{name:'Wrong',expires:'invalid'}]]));
  const names=new MojangNames(async()=>Response.json({...profile,id:'wrong'}),Date.now,file);await names.init();assert.equal(await names.resolve(id,null),id);
 }finally{await rm(dir,{recursive:true,force:true});}
});
