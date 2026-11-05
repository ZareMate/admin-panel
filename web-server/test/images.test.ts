import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import sharp from 'sharp';
import { Skins } from '../src/skins.js';
import { Images } from '../src/images.js';

test('host-side icons preserve exported PNGs, layered textures, static blocks, and missing-asset fallback',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'node-icons-'));const put=async(path:string,data:string|Buffer)=>{await mkdir(dirname(join(dir,path)),{recursive:true});await writeFile(join(dir,path),data);};
 try {
  const png=await sharp({create:{width:16,height:32,channels:4,background:'#ff3300'}}).png().toBuffer();
  await put('icons/test__export.png',png);await put('assets/test/textures/item/red.png',png);
  await put('assets/test/models/item/flat.json',JSON.stringify({parent:'minecraft:item/generated',textures:{layer0:'test:item/red'}}));
  await put('assets/test/models/item/block.json',JSON.stringify({parent:'minecraft:block/cube_all',textures:{all:'test:item/red'}}));
  await put('assets/test/models/item/tint.json',JSON.stringify({elements:[{from:[0,0,0],to:[16,16,16],faces:{south:{texture:'test:item/red',tintindex:0}}}]}));
  const images=new Images(dir,dir);await images.init();const result=await images.icons(['test:export','test:flat','test:block','test:tint','test:missing']);
  assert.equal(result['test:export'],'data:image/png;base64,'+png.toString('base64'));
  for(const id of ['test:flat','test:block']){assert(result[id]?.startsWith('data:image/png;base64,'),id);const image=sharp(Buffer.from(result[id]!.split(',')[1]!,'base64'));const meta=await image.metadata();assert.equal(meta.width,64);assert.equal(meta.height,64);const stats=await image.stats();assert(stats.channels[3]!.max>0,'render is not transparent');}
  assert.equal(result['test:missing'],'');assert.equal(result['test:tint'],'');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('production image resolver rejects cycles, custom renderers, traversal and invalid skins',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'node-image-safety-'));try{
  await mkdir(join(dir,'assets/test/models/item'),{recursive:true});
  for(const [id,model] of Object.entries({cycle:{parent:'test:item/cycle'},texture:{parent:'item/generated',textures:{layer0:'#loop',loop:'#loop'}},custom:{loader:'custom:renderer'},escape:{parent:'../../private'}}))await writeFile(join(dir,'assets/test/models/item/'+id+'.json'),JSON.stringify(model));
  const {validItem}=await import('../src/images.js');
  for(const id of ['test:../private','../test:item','test:/private','test:a//b'])assert(!validItem(id));
  const png=await sharp({create:{width:16,height:16,channels:4,background:'#ff3300'}}).png().toBuffer();
  let calls=0;const images=new Images(dir,dir);await images.init();const skins=new Skins(join(dir,'skins'),async()=>{calls++;return new Response(new Uint8Array(png));});await skins.init();
  assert.deepEqual(await images.icons(['test:cycle','test:texture','test:custom','test:escape']),{'test:cycle':'','test:texture':'','test:custom':'','test:escape':''});
  await assert.rejects(skins.get('invalid','Player'));await assert.rejects(skins.get('body','../bad'));assert.equal(calls,0);
  assert.deepEqual((await skins.get('head','Player')).bytes,png);assert.deepEqual((await skins.get('head','player')).bytes,png);assert.equal(calls,1);
  await assert.rejects(new Skins(join(dir,'invalid'),async()=>new Response('not-a-png')).get('head','Player'),/Invalid skin/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('head proxy falls back on provider failures and deduplicates concurrent skin requests',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'panel-head-fallback-'));try{
  const png=await sharp({create:{width:8,height:8,channels:4,background:'#4488cc'}}).png().toBuffer();
  const urls:string[]=[];
  const skins=new Skins(join(dir,'skins'),async input=>{
   const url=String(input);urls.push(url);
   return url.startsWith('https://minotar.net/')?new Response('bad gateway',{status:502}):new Response(new Uint8Array(png));
  });
  const [first,second]=await Promise.all([skins.get('head','Explorer'),skins.get('head','explorer')]);
  assert.deepEqual(first.bytes,png);assert.deepEqual(second.bytes,png);
  assert.equal(urls.length,2);assert(urls[0]!.startsWith('https://minotar.net/'));assert(urls[1]!.startsWith('https://mc-heads.net/'));
  assert.deepEqual((await skins.get('head','Explorer')).bytes,png);assert.equal(urls.length,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
