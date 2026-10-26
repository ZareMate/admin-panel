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
  f.config.users.get('moderator')!.permissions=['panel.access','tab.players','tab.notes','notes.edit'];
  const game=gameFixture();game.detail.storage.inventory.groups[0].slots[0].lore.push('Unicode 😀漢字 '+ 'batch-data '.repeat(9000));await connect(f,game.handler);
  const trigger=setInterval(()=>{
    if(!game.messages.some(m=>m.operation==='watch'&&m.target==='player'))return;
    clearInterval(trigger);setTimeout(()=>{game.detail.location.x=321;game.detail.storage.inventory.groups[0].slots[0].count=99;game.publish();},200);
  },25);trigger.unref();
  const browser=spawn('python3',['test/browser.py',f.url],{stdio:'inherit'});
  const timeout=setTimeout(()=>browser.kill('SIGKILL'),80000);
  try{const [code]=await once(browser,'exit');assert.equal(code,0,'React browser checks');}finally{clearTimeout(timeout);}
 }finally{await f.close();}
});


test('React rank editor works for an explicitly granted custom rank', {timeout:90000},async()=>{
 const f=await fixture({discord:true});try{
  const session=f.auth.create({name:'Permission manager',rank:'security-lead',uuid:'00000000-0000-0000-0000-000000000009',permissions:['panel.access','access.manage']});
  const browser=spawn('python3',['test/browser.py',f.url,'discord'],{stdio:'inherit',env:{...process.env,PANEL_TEST_SESSION:session}});
  const timeout=setTimeout(()=>browser.kill('SIGKILL'),80000);
  try{const [code]=await once(browser,'exit');assert.equal(code,0,'Rank editor browser checks');}finally{clearTimeout(timeout);}
  const {readFile}=await import('node:fs/promises');
  const {parseProperties}=await import('../src/config.js');
  const props=parseProperties(await readFile(f.config.path,'utf8'));
  assert(!props.get('discord.rank.owner.permissions')!.split(',').includes('notes.edit'));
  assert(props.get('discord.rank.owner.permissions')!.split(',').includes('access.manage'));
 }finally{await f.close();}
});
