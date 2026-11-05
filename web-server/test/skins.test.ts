import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,writeFile,utimes,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {Skins} from '../src/skins.js';
import {SKIN_CACHE_MS} from '../src/skin.js';

test('one persistent skin cache serves heads and bodies across restarts without extending expiry',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'panel-skin-restart-'));let now=Date.now(),calls=0;
 try{
  const png=await sharp({create:{width:8,height:8,channels:4,background:'#4488cc'}}).png().toBuffer();
  const skins=new Skins(dir,async()=>{calls++;return new Response(new Uint8Array(png));},()=>now);await skins.init();
  const first=await skins.get('head','Explorer');await skins.get('body','Explorer');assert.equal(calls,2);
  const restarted=new Skins(dir,async()=>{throw new Error('Network must not be used for valid disk cache');},()=>now);await restarted.init();
  const head=await restarted.get('head','EXPLORER'),body=await restarted.get('body','explorer');
  assert.deepEqual(head.bytes,png);assert.deepEqual(body.bytes,png);
  assert(Math.abs(head.expires-first.expires)<2);
  now+=60*60*1000;
  assert.equal((await restarted.get('head','explorer')).expires,head.expires);
  assert.equal((await restarted.get('body','EXPLORER')).expires,body.expires);
  assert.deepEqual((await readdir(dir)).sort(),['body-explorer.png','head-explorer.png']);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('expired and corrupt persistent skin images are replaced instead of served',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'panel-skin-expiry-'));let now=Date.now(),calls=0;
 try{
  const old=await sharp({create:{width:8,height:8,channels:4,background:'#ff0000'}}).png().toBuffer();
  const fresh=await sharp({create:{width:8,height:8,channels:4,background:'#4488cc'}}).png().toBuffer();
  const skins=new Skins(dir,async()=>new Response(new Uint8Array(++calls===1?old:fresh)),()=>now);await skins.init();
  await skins.get('head','Explorer');now+=SKIN_CACHE_MS+1000;
  assert.deepEqual((await skins.get('head','Explorer')).bytes,fresh);assert.equal(calls,2);
  const restarted=new Skins(dir,async()=>{throw new Error('Fresh replacement must survive restart');},()=>now);await restarted.init();
  assert.deepEqual((await restarted.get('head','Explorer')).bytes,fresh);
  await writeFile(join(dir,'body-explorer.png'),'broken');
  const repair=new Skins(dir,async()=>{calls++;return new Response(new Uint8Array(fresh));},()=>now);await repair.init();
  assert.deepEqual((await repair.get('body','Explorer')).bytes,fresh);assert.equal(calls,3);
  assert.deepEqual(await readFile(join(dir,'body-explorer.png')),fresh);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('startup removes expired skin files and caps persistent cache without touching unrelated files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'panel-skin-limit-'));const now=Date.now();
 try{
  await writeFile(join(dir,'keep.txt'),'keep');
  await Promise.all(Array.from({length:514},async(_,i)=>{const path=join(dir,'head-user'+i.toString().padStart(4,'0')+'.png');await writeFile(path,'cached');await utimes(path,new Date(now-i),new Date(now-i));}));
  const expired=join(dir,'body-expired.png');await writeFile(expired,'old');await utimes(expired,new Date(now-SKIN_CACHE_MS-1),new Date(now-SKIN_CACHE_MS-1));
  await new Skins(dir,fetch,()=>now).init();
  const files=await readdir(dir);assert.equal(files.filter(name=>name.endsWith('.png')).length,512);assert(!files.includes('body-expired.png'));assert(files.includes('keep.txt'));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('skin and head failures persist increasing retry delays and reset on success',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'panel-skin-retries-'));let now=Date.now(),calls=0,success=false;
 const png=await sharp({create:{width:8,height:8,channels:4,background:'#4488cc'}}).png().toBuffer();
 const fetcher:typeof fetch=async()=>{calls++;return success?new Response(new Uint8Array(png)):new Response(null,{status:503});};
 try{
  for(const kind of ['head','body']){
   let skins=new Skins(dir,fetcher,()=>now);await skins.init();
   const before=calls,providers=1;
   await assert.rejects(skins.get(kind,'Explorer'));assert.equal(calls,before+providers);
   skins=new Skins(dir,fetcher,()=>now);await skins.init();
   now+=29_999;await assert.rejects(skins.get(kind,'Explorer'));assert.equal(calls,before+providers);
   now++;await assert.rejects(skins.get(kind,'Explorer'));assert.equal(calls,before+providers*2);
   now+=30_000;await assert.rejects(skins.get(kind,'Explorer'));assert.equal(calls,before+providers*2);
   now+=30_000;success=true;await skins.get(kind,'Explorer');assert.equal(calls,before+providers*2+1);
   const cachedCalls=calls;now+=SKIN_CACHE_MS-1;
   skins=new Skins(dir,fetcher,()=>now);await skins.init();await skins.get(kind,'Explorer');assert.equal(calls,cachedCalls);
   now+=2;success=false;await assert.rejects(skins.get(kind,'Explorer'));assert.equal(calls,cachedCalls+providers);
   now+=30_000;success=true;await skins.get(kind,'Explorer');assert.equal(calls,cachedCalls+providers+1);
   success=false;
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('UUID images use mineskin directly and persist across restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'panel-uuid-skins-'));
 const id='0d2da097-fa53-4951-a949-bda2b26c219c',urls:string[]=[];
 const png=await sharp({create:{width:8,height:8,channels:4,background:'#4488cc'}}).png().toBuffer();
 try{
  const skins=new Skins(dir,async url=>{urls.push(String(url));return new Response(new Uint8Array(png));});await skins.init();
  await skins.get('head',id);await skins.get('body',id);
  assert.deepEqual(urls,[`https://mineskin.eu/helm/${id.replaceAll('-','')}/32.png`,`https://mineskin.eu/armor/body/${id.replaceAll('-','')}/256.png`]);
  const restarted=new Skins(dir,async()=>{throw new Error('Cached UUID image must not fetch');});await restarted.init();
  assert.deepEqual((await restarted.get('head',id)).bytes,png);assert.deepEqual((await restarted.get('body',id)).bytes,png);
  await assert.rejects(skins.get('head','../'+id));await assert.rejects(skins.get('body',id+'?evil'));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('failed UUID skins check account existence, preserve retries and classify missing accounts',async()=>{
 const id='0d2da097-fa53-4951-a949-bda2b26c219c';
 for(const account of ['valid','missing','unknown'] as const){
  const dir=await mkdtemp(join(tmpdir(),'panel-skin-validation-'));let checks=0,calls=0;
  const profiles={validate:async(uuid:string)=>{checks++;assert.equal(uuid,id);return account;}};
  try{
   const skins=new Skins(dir,async()=>{calls++;return new Response(null,{status:502});},Date.now,profiles);await skins.init();
   await assert.rejects(skins.get('head',id),(error:unknown)=>{
    const failure=error as {statusCode:number;code?:string};
    assert.equal(failure.statusCode,account==='missing'?404:502);
    if(account==='missing')assert.equal(failure.code,'skin-profile-missing');return true;
   });
   assert.equal(checks,1);assert.equal(calls,1);
   const restarted=new Skins(dir,async()=>{calls++;throw new Error('Cooldown must prevent fetch');},Date.now,profiles);await restarted.init();
   await assert.rejects(restarted.get('head',id));assert.equal(checks,1);assert.equal(calls,1);
   await assert.rejects(skins.get('body','Explorer'));assert.equal(checks,1,'username requests do not validate a UUID');
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});

test('skin failures log and persist safe diagnostics once per provider attempt',async()=>{
 const {Skins}=await import('../src/skins.js');
 const id='0d2da097-fa53-4951-a949-bda2b26c219c';
 const cases:[string,()=>Promise<Response>,number|undefined,string|undefined][]=[
  ['http-error',async()=>new Response('SECRET_UPSTREAM_BODY',{status:429,headers:{'content-type':'text/html','set-cookie':'SECRET_COOKIE'}}),429,'text/html'],
  ['invalid-png',async()=>new Response('SECRET_INVALID_PNG',{headers:{'content-type':'text/plain'}}),200,'text/plain'],
  ['empty-response',async()=>new Response(null),200,undefined],
  ['response-too-large',async()=>new Response(new Uint8Array(1024*1024+1)),200,undefined],
  ['timeout',async()=>{throw new DOMException('SECRET_TIMEOUT','TimeoutError');},undefined,undefined],
  ['network-error',async()=>{throw new TypeError('SECRET_NETWORK_ERROR',{cause:{code:'ECONNRESET',message:'SECRET_CAUSE'}});},undefined,undefined],
 ];
 for(const [reason,fetcher,status,contentType] of cases){
  const dir=await mkdtemp(join(tmpdir(),'panel-skin-diagnostics-'));
  const logs:import('../src/skins.js').SkinFailureLog[]=[];let calls=0,now=100;
  try{
   const skins=new Skins(dir,async()=>{calls++;return fetcher();},()=>now,{validate:async()=> 'valid'},fields=>logs.push(fields));await skins.init();
   await Promise.all([assert.rejects(skins.get('head',id)),assert.rejects(skins.get('head',id))]);
   assert.equal(calls,1);assert.equal(logs.length,1);
   const detail=logs[0]!;assert.equal(detail.reason,reason);assert.equal(detail.upstreamStatus,status);assert.equal(detail.contentType,contentType);
   if(reason==='network-error')assert.equal(detail.networkCode,'ECONNRESET');
   assert.equal(detail.identity,id);assert.equal(detail.kind,'head');assert.equal(detail.account,'valid');assert.equal(detail.provider,'mineskin.eu');
   assert.equal(detail.retryAt,30100);assert.equal(detail.retryDelayMs,30000);assert.equal(detail.failures,1);
   assert.equal(detail.url,`https://mineskin.eu/helm/${id.replaceAll('-','')}/32.png`);
   const saved=JSON.parse(await readFile(join(dir,'retries.json'),'utf8'));assert.equal(saved[0][1].lastFailure.reason,reason);
   assert(!JSON.stringify(logs).includes('SECRET'));assert(!JSON.stringify(saved).includes('SECRET'));
   await assert.rejects(skins.get('head',id));assert.equal(logs.length,1,'cooldown requests do not repeat warnings');
   now=30100;await assert.rejects(skins.get('head',id));assert.equal(logs.length,2);assert.equal(logs[1]!.retryDelayMs,60000);
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});

test('changed canonical UUID URLs bypass old redirect failure cooldowns without renaming cache files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'panel-skin-redirect-'));
 const id='1e05172e-504d-488d-8b89-f69021978af5',now=Date.now();let calls=0;
 const png=await sharp({create:{width:8,height:8,channels:4,background:'#4488cc'}}).png().toBuffer();
 try{
  await writeFile(join(dir,'retries.json'),JSON.stringify([['head-'+id,{failures:5,retryAt:now+3600000,lastFailure:{url:`https://mineskin.eu/helm/${id}/32.png`}}]]));
  const skins=new Skins(dir,async url=>{
   calls++;assert.equal(String(url),`https://mineskin.eu/helm/${id.replaceAll('-','')}/32.png`);
   return new Response(new Uint8Array(png));
  },()=>now);await skins.init();
  assert.deepEqual((await skins.get('head',id)).bytes,png);assert.equal(calls,1);
  assert.deepEqual(await readFile(join(dir,`head-${id}.png`)),png);
  const retries=JSON.parse(await readFile(join(dir,'retries.json'),'utf8'));assert.equal(retries[0][1].failures,0);assert.equal(retries[0][1].lastFailure,undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('overdue retries recover after restart without any browser request and clear failure state',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'panel-overdue-skins-'));let now=100,calls=0;
 const png=await sharp({create:{width:8,height:8,channels:4,background:'#4488cc'}}).png().toBuffer();
 try{
  const failed=new Skins(dir,async()=>new Response(null,{status:503}),()=>now);await failed.init();
  await assert.rejects(failed.get('head','Explorer'));
  const recovered=new Skins(dir,async()=>{calls++;return new Response(new Uint8Array(png));},()=>now);await recovered.init();
  await recovered.retryDue();assert.equal(calls,0,'future retries must wait');
  now+=120000;recovered.startRetries();await recovered.retryDue();assert.equal(calls,1,'startup catches a missed timestamp without a request');
  assert.deepEqual(await readFile(join(dir,'head-explorer.png')),png);
  const saved=JSON.parse(await readFile(join(dir,'retries.json'),'utf8'));assert.equal(saved[0][1].failures,0);
  await recovered.retryDue();assert.equal(calls,1,'successful retries leave the queue');
  await recovered.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('background retries drain in bounded batches, keep exponential backoff and stop on shutdown',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'panel-retry-queue-'));let now=100,calls=0;
 const finish:((r:Response)=>void)[]=[];
 const skins=new Skins(dir,async()=>{calls++;return new Promise(resolve=>finish.push(resolve));},()=>now);
 try{
  await writeFile(join(dir,'retries.json'),JSON.stringify(['alpha','bravo','charlie'].map(name=>['head-'+name,{failures:1,retryAt:50}])));
  await skins.init();
  const batch=skins.retryDue();const duplicate=skins.retryDue();
  while(calls<2)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(calls,2);
  finish[0]!(new Response(null,{status:503}));finish[1]!(new Response(null,{status:503}));await Promise.all([batch,duplicate]);
  const second=skins.retryDue();while(calls<3)await new Promise(resolve=>setTimeout(resolve,1));
  finish[2]!(new Response(null,{status:503}));await second;assert.equal(calls,3);
  const entries=JSON.parse(await readFile(join(dir,'retries.json'),'utf8'));assert(entries.every((row:any)=>row[1].failures===2&&row[1].retryAt===60100));
  await skins.retryDue();assert.equal(calls,3);
  await skins.close();now+=120000;await skins.retryDue();assert.equal(calls,3);
 }finally{await skins.close();await rm(dir,{recursive:true,force:true});}
});
