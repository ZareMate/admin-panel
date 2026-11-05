import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {zipSync} from 'fflate';
import {PlayerMap,mapRegion,mapDimension} from '../src/player-map.js';
import {inspectRegionBuffer,writePng,readZipEntry,zipEntries} from '../src/ftb/codec.js';
import {regionZip,cacheZip} from './map-fixtures.js';
import {fixture,login,headers,connect} from './helpers.js';

test('FTB region coordinates, persistent imports, newest-chunk merging and dimension isolation',async()=>{
 assert.deepEqual(mapRegion('0EA5F-0EA60(2).zip'),{name:'0EA5F-0EA60',x:-1,z:0});
 for(const name of ['../0EA60-0EA60.zip','0EA60-0EA60.zip/evil','foo.zip'])assert.throws(()=>mapRegion(name));
 assert.throws(()=>mapDimension('../../tmp'));
 const dir=await mkdtemp(join(tmpdir(),'panel-map-')),map=new PlayerMap(dir);
 try{
  const first=await map.import('minecraft:overworld','0EA60-0EA60.zip',regionZip().toString('base64'));
  assert.equal(first.merged,false);assert.equal(first.chunks,1);
  const image=await map.tile('minecraft:overworld','0EA60-0EA60');
  const metadata=await sharp(image).metadata();assert.equal(metadata.width,512);assert.equal(metadata.height,512);
  const pixels=await sharp(image).raw().toBuffer();assert(pixels.some(byte=>byte>0));
  assert.equal((await new PlayerMap(dir).regions('minecraft:overworld')).regions.length,1);
  assert.equal((await map.regions('minecraft:the_nether')).regions.length,0);
  assert.equal((await map.import('minecraft:overworld','0EA60-0EA60.zip',regionZip(200,1).toString('base64'))).chunks,2);
  await map.import('minecraft:overworld','0EA60-0EA60.zip',regionZip(50,0).toString('base64'));
  let archive=await readFile(join(dir,'minecraft%3Aoverworld','0EA60-0EA60.zip'));
  let info=inspectRegionBuffer(archive,'0EA60-0EA60');
  assert.deepEqual(info.chunks.map(chunk=>chunk.lastModified),[100,200]);
  await map.import('minecraft:overworld','0EA60-0EA60.zip',regionZip(300,0).toString('base64'));
  archive=await readFile(join(dir,'minecraft%3Aoverworld','0EA60-0EA60.zip'));
  info=inspectRegionBuffer(archive,'0EA60-0EA60');assert.deepEqual(info.chunks.map(chunk=>chunk.lastModified),[300,200]);
  await map.remove('minecraft:overworld','0EA60-0EA60');
  assert.equal((await map.regions('minecraft:overworld')).regions.length,0);
  await assert.rejects(map.tile('minecraft:overworld','0EA60-0EA60'),/not found/);
 }finally{map.close();await rm(dir,{recursive:true,force:true});}
});

test('invalid FTB archives and oversized layers cannot replace terrain',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'panel-map-bad-')),map=new PlayerMap(dir);
 try{
  const original=regionZip();await map.import('minecraft:overworld','0EA60-0EA60.zip',original.toString('base64'));
  const tile=await map.tile('minecraft:overworld','0EA60-0EA60');
  const entries=zipEntries(original),bad:Record<string,Uint8Array>={};
  for(const name of entries.keys())bad[name]=readZipEntry(original,entries,name)!;
  bad['data.png']=writePng({width:1,height:1,rgba:Buffer.alloc(4)});
  const corrupt=Buffer.from(original),central=corrupt.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));corrupt.writeUInt32LE(0,central+16);
  for(const input of [corrupt.toString('base64'),'not base64',Buffer.from('not a zip').toString('base64'),Buffer.from(zipSync({'../evil':new Uint8Array([1])})).toString('base64'),Buffer.from(zipSync(bad)).toString('base64')])
   await assert.rejects(map.import('minecraft:overworld','0EA60-0EA60.zip',input));
  assert.deepEqual(await map.tile('minecraft:overworld','0EA60-0EA60'),tile);
 }finally{map.close();await rm(dir,{recursive:true,force:true});}
});

test('map endpoints require independent view/upload/remove permissions, CSRF and audit successful imports',async()=>{
 const head=await sharp({create:{width:8,height:8,channels:4,background:'#4488cc'}}).png().toBuffer();
 const f=await fixture({fetcher:async()=>new Response(new Uint8Array(head),{headers:{'content-type':'image/png'}})});try{
  const operations:string[]=[];
  await connect(f,(request,socket)=>{operations.push(request.operation+(request.includeOffline?':offline':''));socket.send(JSON.stringify({id:request.id,result:{players:[{uuid:'00000000-0000-0000-0000-000000000001',name:'Explorer',dimension:'minecraft:overworld',x:1,y:64,z:-2}],updatedAt:1}}));});
  const user=f.config.users.get('admin')!;
  user.permissions=['panel.access'];let staff=await login(f);
  for(const path of ['/api/map/players','/api/map/regions','/api/map/claims','/api/map/tiles/0EA60-0EA60'])assert.equal((await f.app.inject({url:path,headers:headers(f,staff)})).statusCode,403);
  assert.equal((await f.app.inject({url:'/api/skin/head/Explorer',headers:headers(f,staff)})).statusCode,403);
  assert.equal(operations.length,0);
  user.permissions=['panel.access','tab.map'];staff=await login(f);
  assert.equal((await f.app.inject({url:'/api/map/players',headers:headers(f,staff)})).json().players[0].name,'Explorer');
  assert.equal((await f.app.inject({url:'/api/map/players?offline=true',headers:headers(f,staff)})).statusCode,200);assert(operations.includes('map-players:offline'));
  assert.equal((await f.app.inject({url:'/api/map/players?offline=invalid',headers:headers(f,staff)})).statusCode,400);
  const headResponse=await f.app.inject({url:'/api/skin/head/Explorer',headers:headers(f,staff)});assert.equal(headResponse.statusCode,200);
  const headAge=Number(/max-age=(\d+)/.exec(String(headResponse.headers['cache-control']))?.[1]);assert(headAge>0&&headAge<=7200);
  assert.equal((await f.app.inject({url:'/api/skin/body/Explorer',headers:headers(f,staff)})).statusCode,403);
  assert.equal((await f.app.inject({url:'/api/players',headers:headers(f,staff)})).statusCode,403);
  assert.equal((await f.app.inject({url:'/api/map/claims?dimension=minecraft%3Athe_nether',headers:headers(f,staff)})).statusCode,200);assert(operations.includes('map-claims'));
  assert.equal((await f.app.inject({url:'/api/map/claims?dimension=bad',headers:headers(f,staff)})).statusCode,400);
  const payload={dimension:'minecraft:overworld',filename:'0EA60-0EA60.zip',data:regionZip().toString('base64')};
  const post=(url:string,body:unknown,h=headers(f,staff))=>f.app.inject({method:'POST',url,headers:h,payload:body as object});
  assert.equal((await post('/api/map/import',payload)).statusCode,403);
  user.permissions=['panel.access','tab.map','map.upload'];staff=await login(f);
  assert.equal((await post('/api/map/import',payload,{...headers(f,staff),'x-csrf-token':'bad'})).statusCode,403);
  assert.equal((await post('/api/map/import',payload)).statusCode,200);
  const tile=await f.app.inject({url:'/api/map/tiles/0EA60-0EA60',headers:headers(f,staff)});assert.equal(tile.headers['content-type'],'image/png');
  assert.equal((await post('/api/map/remove',{dimension:payload.dimension,region:'0EA60-0EA60'})).statusCode,403);
  user.permissions=['panel.access','tab.map','map.remove'];staff=await login(f);
  assert.equal((await post('/api/map/import',payload)).statusCode,403);
  assert.equal((await post('/api/map/remove',{dimension:payload.dimension,region:'0EA60-0EA60'})).statusCode,200);
  assert.equal((await f.app.inject({url:'/api/map/tiles/0EA60-0EA60',headers:headers(f,staff)})).statusCode,404);
  const log=await readFile(join(f.dir,'logs/admin-panel-audit.jsonl'),'utf8');assert(log.includes('map-import'));assert(log.includes('map-remove'));assert(!log.includes(payload.data));
 }finally{await f.close();}
});


test('full cache exports import selected-dimension regions with v3 records and persistent exported palettes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'panel-map-cache-')),map=new PlayerMap(dir);
 try{
  const archive=cacheZip({'0EA60-0EA60.zip':regionZip(100,0,3,'ABCDEF'),'0EA61-0EA60.zip':regionZip(100,0,3,'ABCDEF')});
  const result=await map.import('minecraft:overworld','server-cache.zip',archive.toString('base64'));
  assert.equal(result.regions,2);assert.equal(result.chunks,2);
  assert.equal((await map.regions('minecraft:overworld')).regions.length,2);
  assert.equal((await map.regions('minecraft:the_nether')).regions.length,0);
  const image=await sharp(await map.tile('minecraft:overworld','0EA60-0EA60')).ensureAlpha().raw().toBuffer();
  assert.equal(image[3],255,'exported block index must render instead of remaining unknown/transparent');
  const restarted=new PlayerMap(dir);
  await restarted.import('minecraft:overworld','0EA60-0EA60.zip',regionZip(200,0,3,'ABCDEF').toString('base64'));
  const after=await sharp(await restarted.tile('minecraft:overworld','0EA60-0EA60')).ensureAlpha().raw().toBuffer();assert.equal(after[3],255,'individual updates preserve cached block palette');
  const source=await readFile(join(dir,'minecraft%3Aoverworld','0EA60-0EA60.zip'));
  await assert.rejects(map.import('minecraft:overworld','broken-cache.zip',cacheZip({'0EA60-0EA60.zip':regionZip(400),'0EA61-0EA60.zip':Buffer.from('invalid')}).toString('base64')));
  assert.deepEqual(await readFile(join(dir,'minecraft%3Aoverworld','0EA60-0EA60.zip')),source,'bad nested regions must fail before writing any region');
  await assert.rejects(map.import('minecraft:overworld','future.zip',cacheZip({'0EA60-0EA60.zip':regionZip(100,0,4)}).toString('base64')),/Unsupported chunks.dat version/);
  await assert.rejects(map.import('minecraft:the_end','server-cache.zip',archive.toString('base64')),/selected dimension/);
  await assert.rejects(map.import('minecraft:overworld','unsafe.zip',Buffer.from(zipSync({'dimensions.txt':Buffer.from('minecraft:overworld'),'../bad.zip':regionZip()})).toString('base64')),/Unsafe ZIP entry path/);
 }finally{map.close();await rm(dir,{recursive:true,force:true});}
});
