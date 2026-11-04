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


test('TSA configuration typed saves and independent read-only tab in Chromium',{timeout:90000},async()=>{
 const f=await fixture();try{
  const settings:any[]=[{key:'LOGIN_CHECK_DELAY_SECONDS',type:'integer',value:5,secret:false},{key:'WEBHOOK_ENABLED',type:'boolean',value:true,secret:false},{key:'FILENAME_DETECTION_KEYWORDS',type:'list',value:['xray'],secret:false},{key:'ENFORCEMENT_MODE',type:'string',value:'off',secret:false},{key:'WEBHOOK_URL',type:'string',secret:true,configured:true}];
  const updates:any[]=[];
  await connect(f,(request,socket)=>{
   if(request.operation==='tsa-unlisted'){socket.send(JSON.stringify({id:request.id,result:{entries:[],playersScanned:0}}));return;}
   if(request.operation==='tsa-lists'){socket.send(JSON.stringify({id:request.id,result:{lists:{ALLOWED:[],BLACKLISTED:[],ENFORCEMENT:[],FILENAMES:[]}}}));return;}
   if(request.operation==='tsa-setting-update'){updates.push(request.body);const row=settings.find(row=>row.key===request.body.setting);if(!row.secret)row.value=request.body.value;}
   socket.send(JSON.stringify({id:request.id,result:{settings}}));
  });
  for(const readonly of [false,true]){
   const session=f.auth.create({name:'TSA staff',rank:'custom',uuid:'00000000-0000-0000-0000-000000000009',permissions:['panel.access','tab.tsaConfig',...(readonly?[]:['tsa.configure'])]});
   const browser=spawn('python3',['test/browser.py',f.url,'tsa'],{stdio:'inherit',env:{...process.env,PANEL_TEST_SESSION:session,PANEL_TSA_READ_ONLY:readonly?'1':'0'}});
   const [code]=await once(browser,'exit');assert.equal(code,0,'TSA browser checks');
  }
  assert.deepEqual(updates.map(row=>row.setting),['LOGIN_CHECK_DELAY_SECONDS','FILENAME_DETECTION_KEYWORDS','WEBHOOK_URL']);
  assert.equal(updates[0].value,25);assert.deepEqual(updates[1].value,['one','two']);
 }finally{await f.close();}
});


test('TSA hash and filename list editing in Chromium',{timeout:90000},async()=>{
 const f=await fixture();try{
  const lists:Record<string,any[]>={ALLOWED:[],BLACKLISTED:['a'.repeat(64)],ENFORCEMENT:[],FILENAMES:[]};const updates:any[]=[];
  await connect(f,(request,socket)=>{
   if(request.operation==='tsa-settings'){socket.send(JSON.stringify({id:request.id,result:{settings:[{key:'FILENAME_DETECTION_KEYWORDS',type:'list',value:['esp','observed'],secret:false},{key:'RAY_FILENAME_ALLOWLIST',type:'list',value:[],secret:false}]}}));return;}
   if(request.operation==='tsa-unlisted'){socket.send(JSON.stringify({id:request.id,result:{entries:[{hash:'a'.repeat(64),filename:'observed.jar',type:'MOD',playerCount:1},{hash:'c'.repeat(64),filename:'unlisted.jar',type:'MOD',playerCount:1},{hash:'c'.repeat(64),filename:'alias.jar',type:'MOD',playerCount:1},{hash:'d'.repeat(64),filename:'other.jar',type:'MOD',playerCount:1}],playersScanned:1}}));return;}
   if(request.operation==='tsa-names'){socket.send(JSON.stringify({id:request.id,result:{names:Object.fromEntries(request.hashes.map((hash:string)=>[hash,[{hash,type:'MOD',filename:'observed.jar'}]]))}}));return;}
   if(request.operation==='tsa-list-update'){
    const body=request.body;updates.push(body);const value=body.list==='FILENAMES'?body.name:body.hash;
    if(body.action==='add'){if(!lists[body.list].includes(value))lists[body.list].push(value);}else lists[body.list]=lists[body.list].filter(entry=>JSON.stringify(entry)!==JSON.stringify(value));
   }
   socket.send(JSON.stringify({id:request.id,result:{lists,changed:true}}));
  });
  for(const readonly of [false,true]){
   // Existing files/API clients may leave overlapping memberships. Allowlist must win in the board.
   if(readonly){lists.BLACKLISTED.push('a'.repeat(64),'e'.repeat(64),'f'.repeat(64));lists.ENFORCEMENT.push('a'.repeat(64),'f'.repeat(64));}
   const session=f.auth.create({name:'List staff',rank:'custom',uuid:'00000000-0000-0000-0000-000000000009',permissions:['panel.access','tab.tsaConfig',...(readonly?[]:['tsa.lists.edit'])]});
   const browser=spawn('python3',['test/browser.py',f.url,'tsa-lists'],{stdio:'inherit',env:{...process.env,PANEL_TEST_SESSION:session,PANEL_TSA_READ_ONLY:readonly?'1':'0'}});
   const [code]=await once(browser,'exit');assert.equal(code,0,'TSA list browser checks');
  }
  assert(updates.some(body=>body.list==='ENFORCEMENT'&&body.action==='add'));assert(updates.some(body=>body.list==='ENFORCEMENT'&&body.action==='remove'));assert(updates.some(body=>body.list==='ALLOWED'&&body.action==='add'));assert(updates.some(body=>body.list==='BLACKLISTED'&&body.action==='remove'));
  assert.equal(lists.BLACKLISTED.length,4);assert(lists.ALLOWED.includes('a'.repeat(64)));assert(!lists.ENFORCEMENT.includes('c'.repeat(64)));assert(!lists.BLACKLISTED.includes('c'.repeat(64)));assert.equal(lists.FILENAMES[0],'trusted.jar');
 }finally{await f.close();}
});


test('moving overlapping allowed hashes clears punishment sources before revoking allowance',{timeout:90000},async()=>{
 const f=await fixture();try{
  const a='a'.repeat(64),b='b'.repeat(64);
  const lists:Record<string,string[]>={ALLOWED:[a,b],BLACKLISTED:[a,b],ENFORCEMENT:[a,b],FILENAMES:[]};
  const operations:any[]=[];
  await connect(f,(request,socket)=>{
   if(request.operation==='tsa-settings'){socket.send(JSON.stringify({id:request.id,result:{settings:[]}}));return;}
   if(request.operation==='tsa-unlisted'){socket.send(JSON.stringify({id:request.id,result:{playersScanned:1,entries:[a,b].map(hash=>({hash,type:'MOD',filename:hash[0]+'.jar'}))}}));return;}
   if(request.operation==='tsa-names'){socket.send(JSON.stringify({id:request.id,result:{names:Object.fromEntries(request.hashes.map((hash:string)=>[hash,[{hash,type:'MOD',filename:hash[0]+'.jar'}]]))}}));return;}
   if(request.operation==='tsa-list-update'){
    const {list,action,hash}=request.body;operations.push(request.body);
    if(list==='ALLOWED'&&action==='remove'){
     assert(!lists.ENFORCEMENT.includes(hash),'Enforcement must be cleared while the allowance still protects the hash');
     if(hash===a)assert(!lists.BLACKLISTED.includes(hash),'Unlisting must clear blacklist before allowance');
    }
    if(action==='add'){if(!lists[list].includes(hash))lists[list].push(hash);}else lists[list]=lists[list].filter(value=>value!==hash);
   }
   socket.send(JSON.stringify({id:request.id,result:{lists,changed:true}}));
  });
  const session=f.auth.create({name:'List editor',rank:'custom',uuid:'00000000-0000-0000-0000-000000000009',permissions:['panel.access','tab.tsaConfig','tsa.lists.edit']});
  const browser=spawn('python3',['test/browser.py',f.url,'tsa-safe-moves'],{stdio:'inherit',env:{...process.env,PANEL_TEST_SESSION:session}});
  const [code]=await once(browser,'exit');assert.equal(code,0,'Safe allowance moves');
  assert.deepEqual(lists.ALLOWED,[]);assert.deepEqual(lists.ENFORCEMENT,[]);assert.deepEqual(lists.BLACKLISTED,[b]);
  assert.equal(operations.length,6);
 }finally{await f.close();}
});

test('TSA uses a shared card-height budget and adjustable reference page size',{timeout:90000},async()=>{
 const f=await fixture();try{
  const hash=(value:number)=>value.toString(16).padStart(64,'0');
  const blacklist=Array.from({length:32},(_,i)=>hash(i+1));
  const allowed=Array.from({length:32},(_,i)=>hash(i+101));
  const unlisted=Array.from({length:32},(_,i)=>({
   hash:hash(i+201),type:'MOD',filename:'unlisted-'+i+'.jar',playerCount:1
  }));
  const name=(value:string)=>{
   const n=parseInt(value,16);
   return n<=32?'ray-'+n+'-long-named-resource-pack-with-description.jar':
    n<=132?'allowed-'+n+'.jar':'unlisted-'+n+'.jar';
  };
  await connect(f,(request,socket)=>{
   if(request.operation==='tsa-settings'){
    socket.send(JSON.stringify({id:request.id,result:{settings:[{key:'FILENAME_DETECTION_KEYWORDS',type:'list',value:['ray'],secret:false}]}}));return;
   }
   if(request.operation==='tsa-unlisted'){
    socket.send(JSON.stringify({id:request.id,result:{entries:unlisted,playersScanned:1}}));return;
   }
   if(request.operation==='tsa-names'){
    socket.send(JSON.stringify({id:request.id,result:{names:Object.fromEntries(request.hashes.map((item:string)=>[item,[{hash:item,type:'MOD',filename:name(item)}]]))}}));return;
   }
   socket.send(JSON.stringify({id:request.id,result:{lists:{BLACKLISTED:blacklist,ALLOWED:allowed,ENFORCEMENT:blacklist,FILENAMES:[]}}}));
  });
  const session=f.auth.create({name:'List auditor',rank:'custom',uuid:'00000000-0000-0000-0000-000000000009',permissions:['panel.access','tab.tsaConfig']});
  const browser=spawn('python3',['test/browser.py',f.url,'tsa-pagination'],{stdio:'inherit',env:{...process.env,PANEL_TEST_SESSION:session}});
  const [code]=await once(browser,'exit');assert.equal(code,0,'TSA measured pagination browser checks');
 }finally{await f.close();}
});
