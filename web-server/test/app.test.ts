import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture, login, headers, connect, gameFixture, playerId } from './helpers.js';
import { parseProperties, loadConfig } from '../src/config.js';
import { discordUuid, Failure } from '../src/common.js';

test('HTTP auth, CSRF, permission checks, audit, duplicate prevention, and bridge round trips',async()=>{
 const f=await fixture();try {
  assert.equal((await f.app.inject({url:'/api/players',headers:headers(f)})).statusCode,401);
  assert.equal((await f.app.inject({url:'/',headers:{host:'evil.example'}})).statusCode,403);
  const admin=await login(f),viewer=await login(f,'viewer'),moderator=await login(f,'moderator');
  assert.equal((await f.app.inject({url:'/api/players',headers:headers(f,admin)})).statusCode,503);
  const game=gameFixture(),ws=await connect(f,game.handler);
  const players=await f.app.inject({url:'/api/players',headers:headers(f,viewer)});assert.equal(players.statusCode,200);assert.equal(players.json().players.length,2);
  await Promise.all(Array.from({length:8},()=>f.bridge.players()));assert.equal(game.messages.filter(m=>m.operation==='players').length,1);
  const response=await f.app.inject({url:'/api/players/'+playerId,headers:headers(f,viewer)});assert.equal(response.json().name,'TestPlayer');
  const actor=game.messages.find(m=>m.operation==='player')!.actor;assert(actor.permissions.includes('tab.players'));assert(!actor.permissions.includes('punish.warn'));assert.equal(actor.hash,undefined);
  const mutate=(staff:typeof admin,body:Record<string,unknown>,id=randomUUID(),extra={})=>f.app.inject({method:'POST',url:'/api/players/'+playerId+'/punish',headers:{...headers(f,staff),'x-request-id':id,...extra},payload:body});
  assert.equal((await mutate(viewer,{type:'WARN'})).statusCode,403);
  assert.equal((await mutate(moderator,{type:'BAN'})).statusCode,403);
  assert.equal((await mutate(admin,{type:'WARN'},randomUUID(),{'x-csrf-token':'wrong'})).statusCode,403);
  assert.equal((await mutate(admin,{type:'WARN'},randomUUID(),{origin:'https://evil.example'})).statusCode,403);
  assert.equal(game.mutations,0);
  const id=randomUUID();assert.equal((await mutate(moderator,{type:'WARN',reason:'test',durationMinutes:0},id)).statusCode,200);
  assert.equal((await mutate(moderator,{type:'WARN',reason:'test',durationMinutes:0},id)).statusCode,409);assert.equal(game.mutations,1);
  assert.equal((await f.app.inject({url:'/api/audit',headers:headers(f,viewer)})).statusCode,403);
  const audit=await f.app.inject({url:'/api/audit',headers:headers(f,admin)});assert(audit.json().some((r:any)=>r.state==='requested'));assert(audit.json().some((r:any)=>r.state==='success'&&r.action==='punish'));
  assert((await readFile(f.dir+'/logs/admin-panel-audit.jsonl','utf8')).includes('requested'));
  assert.equal((await f.app.inject({method:'POST',url:'/api/icons',headers:headers(f,admin),payload:{ids:['../bad:id']}})).statusCode,400);
  assert.equal((await f.app.inject({method:'POST',url:'/api/icons',headers:headers(f,admin),payload:{ids:[]}})).statusCode,200);
  assert.equal((await f.app.inject({method:'POST',url:'/api/icons',headers:headers(f,admin),payload:{ids:['x'.repeat(17000)]}})).statusCode,413);
  await f.app.inject({method:'POST',url:'/api/logout',headers:headers(f,viewer),payload:{}});
  assert.equal((await f.app.inject({url:'/api/session',headers:headers(f,viewer)})).statusCode,401);
  ws.close();await once(ws,'close');
 }finally{await f.close();}
});

test('WebSocket rejects bad credentials and duplicate peers; disconnects fail pending commands without replay',async()=>{
 const f=await fixture({timeout:100});try {
  const bad=new WebSocket(f.url.replace('http','ws')+'/bridge');bad.on('error',()=>{});
  const [,response]=await once(bad,'unexpected-response');assert.equal(response.statusCode,401);response.resume();
  bad.terminate();
  const ws=await connect(f);const duplicate=await connect(f);const [code]=await once(duplicate,'close');assert.equal(code,1008);
  const pending=f.bridge.player(playerId,{name:'admin',rank:'admin',uuid:playerId});
  const failed=assert.rejects(pending,(e:Failure)=>e.statusCode===503);
  const closed=once(ws,'close');ws.close();await failed;await closed;
  let replayed=0;const replacement=await connect(f,()=>{replayed++;});await new Promise(r=>setTimeout(r,50));assert.equal(replayed,0);
  await assert.rejects(f.bridge.players(),(e:Failure)=>e.statusCode===504);replacement.terminate();
 }finally{await f.close();}
});

test('HTTPS origin behind hosting proxy uses secure cookies and does not require certificate files',async()=>{
 const f=await fixture({secure:true});try{
  const result=await f.app.inject({method:'POST',url:'/api/login',headers:headers(f),payload:{username:'admin',password:'browser-test-password'}});
  assert.equal(result.statusCode,200);assert(String(result.headers['set-cookie']).includes('Secure'));assert(String(result.headers['set-cookie']).includes('HttpOnly'));
  assert.equal(result.headers['strict-transport-security'],'max-age=31536000');
  assert.equal((await f.app.inject({url:'/',headers:{host:'evil.example','x-forwarded-host':'panel.example','x-forwarded-proto':'https'}})).statusCode,403);
  const ws=await connect(f,gameFixture().handler);assert.equal((await f.bridge.players() as any).serverPlayers,1);ws.terminate();
 }finally{await f.close();}
});

test('Discord OAuth state, rank precedence, login snapshot, local-login block, and rank persistence',async()=>{
 let calls=0;
 const fetcher:typeof fetch=async(input)=>{calls++;const url=String(input);return Response.json(url.endsWith('/token')?{access_token:'test-access',token_type:'Bearer',scope:'identify guilds.members.read',expires_in:3600}:url.endsWith('/@me')?{id:'12345678901234572',username:'Owner'}:{roles:['12345678901234570','12345678901234569'],user:{id:'12345678901234572'}});};
 const f=await fixture({discord:true,fetcher});try{
  assert.equal((await f.app.inject({method:'POST',url:'/api/login',headers:headers(f),payload:{username:'admin',password:'browser-test-password'}})).statusCode,403);
  const start=await f.app.inject({url:'/api/auth/discord/start',headers:headers(f)}),state=new URL(String(start.headers.location)).searchParams.get('state')!;
  const browser=String(start.headers['set-cookie']).split(';')[0]!;
  const wrong=await f.app.inject({url:'/api/auth/discord/callback?state='+state+'&code=code',headers:headers(f)});assert(String(wrong.headers.location).includes('loginError'));assert.equal(calls,0);
  const result=await f.app.inject({url:'/api/auth/discord/callback?state='+state+'&code=code',headers:{...headers(f),cookie:browser}});assert.equal(result.headers.location,'/');
  const cookies=result.headers['set-cookie'] as string[];const cookie=cookies.find(c=>c.startsWith('panel_session='))!.split(';')[0]!;
  const session=await f.app.inject({url:'/api/session',headers:{...headers(f),cookie}});assert.equal(session.json().rank,'owner');assert.equal(calls,3);
  const staff={cookie,csrf:session.json().csrf};await f.app.inject({method:'POST',url:'/api/icons',headers:headers(f,staff),payload:{ids:[]}});assert.equal(calls,3);
  const replay=await f.app.inject({url:'/api/auth/discord/callback?state='+state+'&code=code',headers:{...headers(f),cookie:browser}});assert(String(replay.headers.location).includes('loginError'));assert.equal(calls,3);
  assert.equal((await f.app.inject({method:'POST',url:'/api/access/ranks',headers:headers(f,staff),payload:{ranks:[{name:'mod',discordRoleId:'12345678901234570',access:'admin'}]}})).statusCode,400);
  assert.equal((await f.app.inject({method:'POST',url:'/api/access/ranks',headers:headers(f,staff),payload:{ranks:[{name:'owner',discordRoleId:'12345678901234569',access:'admin'}]}})).statusCode,200);
  const props=parseProperties(await readFile(f.config.path,'utf8'));assert.equal(props.get('discord.client-secret'),'test-secret');assert.equal(props.get('discord.rank-order'),'owner');
  assert.equal(f.config.ranks.length,1,'saved ranks replace the running policy');
  await connect(f,gameFixture().handler);
  const live=new WebSocket(f.url.replace('http','ws')+'/api/live',{headers:headers(f,staff)});await once(live,'open');const closed=once(live,'close');
  const applied=await f.app.inject({method:'POST',url:'/api/access/ranks',headers:headers(f,staff),payload:{ranks:[{name:'owner',discordRoleId:'12345678901234569',permissions:['panel.access','access.manage']}]}});
  assert.equal(applied.json().restartRequired,false);
  assert.equal((await closed)[0],4002,'old live subscriptions are closed on policy change');
  const current=await f.app.inject({url:'/api/session',headers:headers(f,staff)});assert.deepEqual(current.json().permissions,['panel.access','access.manage']);
  assert.equal((await f.app.inject({url:'/api/players',headers:headers(f,staff)})).statusCode,403,'existing sessions immediately lose removed grants');
  assert.equal(calls,3,'policy reloads do not make extra Discord requests');

 }finally{await f.close();}
});

test('configuration preserves Java escapes and rejects insecure public defaults',async()=>{
 const props=parseProperties('origin=https\\://panel.example\nuser.name=hello\\ world\nvalue=hello\\\n world\nunicode=\\u017b\n');
 assert.equal(props.get('origin'),'https://panel.example');assert.equal(props.get('value'),'helloworld');assert.equal(props.get('unicode'),'Ż');
 const f=await fixture();try{await assert.rejects(loadConfig({DATA_DIR:f.dir,ADMIN_PANEL_BRIDGE_TOKEN:f.config.bridgeToken,PUBLIC_ORIGIN:'http://example.com'}),/HTTPS/);}finally{await f.close();}
 assert.match(discordUuid('12345678901234572'),/^[a-f0-9-]{36}$/);
});

test('React duration values match the Minecraft moderation wire contract',async()=>{
 const {durationMinutes}=await import('../client/duration.js');
 assert.equal(durationMinutes('3d'),4320);assert.equal(durationMinutes('2h'),120);assert.equal(durationMinutes('30m'),30);assert.equal(durationMinutes('perm'),0);
 assert.throws(()=>durationMinutes('0m'));assert.throws(()=>durationMinutes('5000w'));assert.throws(()=>durationMinutes('invalid'));
});


test('TSA configuration permissions, CSRF, bridge operations and secret-free audit',async()=>{
 const f=await fixture();try {
  const admin=await login(f),viewer=await login(f,'viewer');
  assert.equal((await f.app.inject({url:'/api/tsa/settings',headers:headers(f)})).statusCode,401);
  assert.equal((await f.app.inject({url:'/api/tsa/settings',headers:headers(f,viewer)})).statusCode,403);
  f.config.users.get('moderator')!.permissions=['panel.access','tab.tsaConfig'];
  const readOnly=await login(f,'moderator');
  assert.equal((await f.app.inject({method:'POST',url:'/api/tsa/settings',headers:headers(f,readOnly),payload:{setting:'WEBHOOK_ENABLED',value:false}})).statusCode,403);
  f.config.users.get('moderator')!.permissions=['panel.access','tsa.configure'];
  const noTab=await login(f,'moderator');
  assert.equal((await f.app.inject({url:'/api/tsa/settings',headers:headers(f,noTab)})).statusCode,403);
  assert.equal((await f.app.inject({method:'POST',url:'/api/tsa/settings',headers:headers(f,noTab),payload:{setting:'WEBHOOK_ENABLED',value:false}})).statusCode,403);
  const messages:any[]=[];
  const ws=await connect(f,(request,socket)=>{messages.push(request);socket.send(JSON.stringify({id:request.id,result:{settings:[{key:'WEBHOOK_URL',type:'string',secret:true,configured:true}]}}));});
  assert.equal((await f.app.inject({url:'/api/tsa/settings',headers:headers(f,admin)})).statusCode,200);
  const payload={setting:'WEBHOOK_URL',value:'https://discord.example/super-secret'};
  assert.equal((await f.app.inject({method:'POST',url:'/api/tsa/settings',headers:headers(f,viewer),payload})).statusCode,403);
  assert.equal((await f.app.inject({method:'POST',url:'/api/tsa/settings',headers:{...headers(f,admin),'x-csrf-token':'wrong'},payload})).statusCode,403);
  assert.equal((await f.app.inject({method:'POST',url:'/api/tsa/settings',headers:headers(f,admin),payload})).statusCode,200);
  assert.equal(messages[0].operation,'tsa-settings');assert.equal(messages[1].operation,'tsa-setting-update');
  assert(messages[1].actor.permissions.includes('tsa.configure'));
  assert.equal(messages[1].body.value,payload.value);
  const audit=await readFile(f.dir+'/logs/admin-panel-audit.jsonl','utf8');assert(!audit.includes('super-secret'));assert(audit.includes('tsa-setting-update'));
  assert.equal((await f.app.inject({method:'POST',url:'/api/tsa/settings',headers:headers(f,admin),payload:{setting:'BAD KEY',value:true}})).statusCode,400);
  ws.close();await once(ws,'close');
 }finally{await f.close();}
});


test('TSA lists enforce separate list permission, validate inputs and dispatch independent operations',async()=>{
 const f=await fixture();try{
  const account=f.config.users.get('admin')!;
  account.permissions=['panel.access','tab.tsaConfig','tsa.lists.edit'];const editor=await login(f);
  account.permissions=['panel.access','tab.tsaConfig','tsa.configure'];const settingsOnly=await login(f);
  account.permissions=['panel.access','tsa.lists.edit'];const noTab=await login(f);
  const sent:any[]=[];const ws=await connect(f,(request,socket)=>{sent.push(request);socket.send(JSON.stringify({id:request.id,result:{lists:{ALLOWED:[],BLACKLISTED:[],ENFORCEMENT:[],FILENAMES:[]},changed:true}}));});
  const post=(staff:typeof editor,body:unknown,extra={})=>f.app.inject({method:'POST',url:'/api/tsa/lists',headers:{...headers(f,staff),...extra},payload:body as any});
  const body={list:'BLACKLISTED',action:'add',hash:'A'.repeat(64)};
  assert.equal((await post(settingsOnly,body)).statusCode,403);
  assert.equal((await post(noTab,body)).statusCode,403);
  assert.equal((await f.app.inject({url:'/api/tsa/lists',headers:headers(f,noTab)})).statusCode,403);
  assert.equal((await post(editor,body,{'x-csrf-token':'bad'})).statusCode,403);
  assert.equal((await post(editor,{...body,hash:'invalid'})).statusCode,400);
  assert.equal((await post(editor,{...body,list:'OTHER'})).statusCode,400);
  assert.equal((await post(editor,{...body,list:'GENERATED'})).statusCode,400);
  assert.equal(sent.length,0);
  assert.equal((await f.app.inject({url:'/api/tsa/lists',headers:headers(f,settingsOnly)})).statusCode,200);
  for(const list of ['ALLOWED','BLACKLISTED','ENFORCEMENT','FILENAMES'])for(const action of ['add','remove'])assert.equal((await post(editor,{...body,list,action,name:'file.jar',type:'MOD'})).statusCode,200);
  assert.equal(sent[0].operation,'tsa-lists');assert.equal(sent[1].operation,'tsa-list-update');assert.equal(sent[1].body.hash,'a'.repeat(64));
  assert(sent[1].actor.permissions.includes('tsa.lists.edit'));assert(!sent[1].actor.permissions.includes('tsa.configure'));
  const audit=await readFile(f.dir+'/logs/admin-panel-audit.jsonl','utf8');assert(audit.includes('tsa-list-add'));assert(audit.includes('tsa-list-remove'));
  ws.close();await once(ws,'close');
 }finally{await f.close();}
});


test('TSA board bounds filename batches and protects unlisted inventories',async()=>{
 const f=await fixture();try{
  f.config.users.get('admin')!.permissions=['panel.access','tab.tsaConfig'];const reader=await login(f),viewer=await login(f,'viewer');
  const sent:any[]=[];const ws=await connect(f,(request,socket)=>{sent.push(request);socket.send(JSON.stringify({id:request.id,result:request.operation==='tsa-names'?{names:{}}:{entries:[],playersScanned:0}}));});
  const post=(hashes:unknown,user=reader)=>f.app.inject({method:'POST',url:'/api/tsa/names',headers:headers(f,user),payload:{hashes}});
  assert.equal((await post(['a'.repeat(64)],viewer)).statusCode,403);assert.equal((await post(Array(51).fill('a'.repeat(64)))).statusCode,400);assert.equal((await post(['bad'])).statusCode,400);assert.equal(sent.length,0);
  assert.equal((await post(['a'.repeat(64)])).statusCode,200);assert.equal(sent[0].operation,'tsa-names');
  assert.equal((await f.app.inject({url:'/api/tsa/unlisted',headers:headers(f,viewer)})).statusCode,403);
  assert.equal((await f.app.inject({url:'/api/tsa/unlisted',headers:headers(f,reader)})).statusCode,200);assert.equal(sent[1].operation,'tsa-unlisted');
  ws.close();await once(ws,'close');
 }finally{await f.close();}
});
