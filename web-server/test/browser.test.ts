import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import sharp from 'sharp';
import { fixture, connect, gameFixture } from './helpers.js';
test('React production build in Chromium', {timeout:90000},async()=>{
 const png=await sharp({create:{width:16,height:16,channels:4,background:'#448833'}}).png().toBuffer();
 const f=await fixture({fetcher:async()=>new Response(new Uint8Array(png),{headers:{'content-type':'image/png'}})});
 try{
  await connect(f,gameFixture().handler);
  const browser=spawn('python3',['test/browser.py',f.url],{stdio:'inherit'});
  const timeout=setTimeout(()=>browser.kill('SIGKILL'),80000);
  try{const [code]=await once(browser,'exit');assert.equal(code,0,'React browser checks');}finally{clearTimeout(timeout);}
 }finally{await f.close();}
});
