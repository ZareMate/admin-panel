import test from 'node:test';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { MinecraftLogin } from '../src/minecraft-login.js';
import { fixture, headers, playerId } from './helpers.js';
const discordId='12345678901234572';
const member=(guildId:string)=>({messages:[{guildId,discordId,username:'Staff',pending:false,roles:['12345678901234569']}],hasMore:false});

test('Minecraft tickets are single use, expire, supersede old tickets and preserve both identities',async()=>{
 const f=await fixture({discord:true});try{
  let now=1000,calls=0;const login=new MinecraftLogin(f.config,{request:async c=>{calls++;assert.equal(c.guildId,f.config.guildId);assert.equal(c.discordId,discordId);return member(f.config.guildId);}},()=>now);
  const old=login.issue({minecraftUuid:playerId,discordId}).ticket;
  const ticket=login.issue({minecraftUuid:playerId,discordId}).ticket;assert.equal(ticket.length,86);
  await assert.rejects(login.redeem(old));assert.equal(calls,0);
  const [first,second]=await Promise.allSettled([login.redeem(ticket),login.redeem(ticket)]);
  assert.equal(first.status,'fulfilled');assert.equal(second.status,'rejected');
  if(first.status==='fulfilled'){assert.equal(first.value.uuid,playerId);assert.equal(first.value.discordId,discordId);assert.equal(first.value.rank,'owner');}
  assert.equal(calls,1);
  const expired=login.issue({minecraftUuid:playerId,discordId}).ticket;now+=60_000;await assert.rejects(login.redeem(expired));assert.equal(calls,1);
 }finally{await f.close();}
});
test('Minecraft login rejects wrong guild or identity, pending members, missing roles and conflicting mappings',async()=>{
 const f=await fixture({discord:true});try{
  for(const change of [{guildId:'12345678901234599'},{discordId:'12345678901234599'},{pending:true},{roles:[]}]){
   const login=new MinecraftLogin(f.config,{request:async()=>({messages:[{...member(f.config.guildId).messages[0],...change}]})});
   await assert.rejects(login.redeem(login.issue({minecraftUuid:playerId,discordId}).ticket));
  }
  f.config.mappings.set(discordId,'00000000-0000-0000-0000-000000000002');
  const login=new MinecraftLogin(f.config,{request:async()=>member(f.config.guildId)});
  assert.throws(()=>login.issue({minecraftUuid:playerId,discordId}));
 }finally{await f.close();}
});
test('only authenticated servers issue tickets; redemption enforces origin and never grants access when bot is offline',async()=>{
 const f=await fixture({discord:true});try{
  const payload={minecraftUuid:playerId,discordId},url='/api/auth/minecraft/issue';
  const denied=await f.app.inject({method:'POST',url,headers:headers(f),payload});assert.equal(denied.statusCode,401);
  const issued=await f.app.inject({method:'POST',url,headers:{host:new URL(f.config.origin).host,'content-type':'application/json',authorization:'Bearer '+f.config.bridgeToken},payload});assert.equal(issued.statusCode,200);
  const ticket=issued.json().ticket;
  const wrong=await f.app.inject({method:'POST',url:'/api/auth/minecraft/redeem',headers:{...headers(f),origin:'https://evil.example'},payload:{ticket}});assert.equal(wrong.statusCode,403);
  const offline=await f.app.inject({method:'POST',url:'/api/auth/minecraft/redeem',headers:headers(f),payload:{ticket}});assert.equal(offline.statusCode,503);
  const replay=await f.app.inject({method:'POST',url:'/api/auth/minecraft/redeem',headers:headers(f),payload:{ticket}});assert.equal(replay.statusCode,401);
 }finally{await f.close();}
});


test('Minecraft handoff creates normal cookie and CSRF session, snapshots rank and prevents replay',async()=>{
 const {WebSocket}=await import('ws');const {token}=await import('../src/common.js');
 const f=await fixture({discord:true});let socket:InstanceType<typeof WebSocket>|undefined;
 try{
  f.config.ticketSyncToken=token();
  socket=new WebSocket(f.url.replace('http','ws')+'/tickets-commands',{headers:{Authorization:'Bearer '+f.config.ticketSyncToken}});
  let calls=0;socket.on('message',data=>{const c=JSON.parse(data.toString());calls++;assert.equal(c.guildId,f.config.guildId);socket!.send(JSON.stringify({type:'item',id:c.id,message:member(f.config.guildId).messages[0]}));socket!.send(JSON.stringify({type:'done',id:c.id}));});
  await once(socket,'open');
  const issued=await f.app.inject({method:'POST',url:'/api/auth/minecraft/issue',headers:{host:new URL(f.config.origin).host,'content-type':'application/json',authorization:'Bearer '+f.config.bridgeToken},payload:{minecraftUuid:playerId,discordId}});
  assert.equal(issued.statusCode,200);const ticket=issued.json().ticket;
  const redeemed=await f.app.inject({method:'POST',url:'/api/auth/minecraft/redeem',headers:headers(f),payload:{ticket}});
  assert.equal(redeemed.statusCode,200);
  const cookies=redeemed.cookies.filter(c=>c.name==='panel_session'&&c.value);assert.equal(cookies.length,1);
  const cookie='panel_session='+cookies[0]!.value;
  for(let i=0;i<2;i++){
   const session=await f.app.inject({url:'/api/session',headers:{host:new URL(f.config.origin).host,cookie}});
   assert.equal(session.statusCode,200);assert.equal(session.json().rank,'owner');assert.ok(session.json().csrf);
  }
  assert.equal(calls,1);assert.equal(f.auth.get(cookies[0]!.value)!.user.uuid,playerId);assert.equal(f.auth.get(cookies[0]!.value)!.user.discordId,discordId);
  const replay=await f.app.inject({method:'POST',url:'/api/auth/minecraft/redeem',headers:headers(f),payload:{ticket}});assert.equal(replay.statusCode,401);
 }finally{socket?.terminate();await f.close();}
});


test('login stage logs share server correlation without logging the bearer ticket',async()=>{
 const f=await fixture({discord:true});try{
  const events:{event:string;fields:Record<string,unknown>}[]=[],loginId='00000000-0000-0000-0000-000000000007';
  const auth=new MinecraftLogin(f.config,{request:async c=>{assert.equal(c.loginId,loginId);return member(f.config.guildId);}},Date.now,(_level,event,fields)=>events.push({event,fields}));
  const issued=auth.issue({minecraftUuid:playerId,discordId,loginId});await auth.redeem(issued.ticket);
  assert.ok(events.some(e=>e.event==='minecraft_login_ticket_issued'));assert.ok(events.some(e=>e.event==='minecraft_login_authorized'));
  assert.ok(events.every(e=>e.fields.loginId===loginId));assert.ok(!JSON.stringify(events).includes(issued.ticket));
 }finally{await f.close();}
});

test('bot login errors reach the HTTP client as specific safe reasons',async()=>{
 const {WebSocket}=await import('ws');const {token}=await import('../src/common.js');
 const f=await fixture({discord:true});let socket:InstanceType<typeof WebSocket>|undefined;
 try{
  f.config.ticketSyncToken=token();socket=new WebSocket(f.url.replace('http','ws')+'/tickets-commands',{headers:{Authorization:'Bearer '+f.config.ticketSyncToken}});
  socket.on('message',data=>{const c=JSON.parse(data.toString());socket!.send(JSON.stringify({type:'done',id:c.id,error:true,errorCode:'login-member-missing',message:'private-upstream-error'}));});await once(socket,'open');
  const issue=await f.app.inject({method:'POST',url:'/api/auth/minecraft/issue',headers:{host:new URL(f.config.origin).host,'content-type':'application/json',authorization:'Bearer '+f.config.bridgeToken},payload:{minecraftUuid:playerId,discordId}});
  const redeem=await f.app.inject({method:'POST',url:'/api/auth/minecraft/redeem',headers:headers(f),payload:{ticket:issue.json().ticket}});
  assert.equal(redeem.statusCode,403);assert.match(redeem.json().error,/not a member of the auth guild/);assert.ok(!redeem.body.includes('private-upstream-error'));
 }finally{socket?.terminate();await f.close();}
});
