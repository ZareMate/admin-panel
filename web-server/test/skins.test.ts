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
