import test from 'node:test';
import { WebSocket } from 'ws';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { TICKET_CATEGORIES } from '../src/ticket-categories.js';
import { fixture, connect, gameFixture, ticketPush } from './helpers.js';
test('React production build in Chromium', {timeout:90000},async()=>{
 const png=await sharp({create:{width:16,height:16,channels:4,background:'#448833'}}).png().toBuffer();
 const f=await fixture({fetcher:async()=>new Response(new Uint8Array(png),{headers:{'content-type':'image/png'}})});
 try{
  f.config.ticketSyncToken='a'.repeat(43);
  const synced=await ticketPush(f,{snapshot:randomUUID(),index:0,final:true,categories:TICKET_CATEGORIES,tickets:[{id:'12345678901234567',guildId:'12345678901234568',category:'lost-items-or-airship',name:'lost-items-or-airship-1619',tags:['Open <review>']}]});
  assert.equal(synced.ok,true);
  const ticketBot=new WebSocket(f.url.replace('http','ws')+'/tickets-commands',{headers:{Authorization:'Bearer '+f.config.ticketSyncToken}});await once(ticketBot,'open');
  let suggestionTags=['12345678901234575'];
  const suggestion=()=>({id:'12345678901234574',guildId:'12345678901234568',name:'Build a spawn station',tagIds:suggestionTags,archived:false,locked:false});
  ticketBot.on('message',async data=>{const c=JSON.parse(data.toString());if(c.action==='suggestions-list')await new Promise(resolve=>setTimeout(resolve,300));const item=(message:unknown)=>ticketBot.send(JSON.stringify({type:'item',id:c.id,message}));
    if(c.action==='suggestions-list'){item({name:'Server ideas',forumId:'12345678901234573',guildId:'12345678901234568',tags:[{id:'12345678901234575',name:'Planned',moderated:false},{id:'12345678901234576',name:'In review',moderated:false}]});if((!c.untagged||suggestionTags.length===0)&&(c.tags??[]).every((id:string)=>suggestionTags.includes(id)))item(suggestion());}
    else if(c.action==='suggestions-tags'){suggestionTags=c.tags;item(suggestion());}
    else item({id:(c.action==='reply'||c.action==='suggestions-reply')?'12345678901234570':'12345678901234569',author:(c.action==='reply'||c.action==='suggestions-reply')?'Support bot':'LostPilot',bot:(c.action==='reply'||c.action==='suggestions-reply'),content:(c.action==='reply'||c.action==='suggestions-reply')?c.content:c.action==='suggestions-history'?'A station would help new players.':'I lost my airship <script>alert(1)</script>',createdAt:(c.action==='reply'||c.action==='suggestions-reply')?Date.now():1,attachments:[],embeds:[]});
    ticketBot.send(JSON.stringify({type:'done',id:c.id,hasMore:false}));
  });
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
