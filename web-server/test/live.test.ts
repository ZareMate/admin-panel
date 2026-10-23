import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { fixture, login, headers, connect, gameFixture, playerId, type Fixture } from './helpers.js';
import { BatchReceiver } from '../src/batches.js';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(check:()=>boolean){const end=Date.now()+3000;while(!check()&&Date.now()<end)await delay(10);assert(check(),'Expected live condition');}
async function browser(f:Fixture,staff:{cookie:string;csrf:string}){
 const messages:any[]=[],batches=new BatchReceiver();
 const ws=new WebSocket(f.url.replace('http','ws')+'/api/live',{headers:{Origin:f.config.origin,Cookie:staff.cookie}});
 ws.on('message',data=>{const message=batches.accept(data.toString());if(message)messages.push(message);});ws.on('error',()=>{});await once(ws,'open');
 return {ws,messages};
}
test('live sockets require a staff session and the exact browser origin',async()=>{
 const f=await fixture();try{
  const staff=await login(f);
  for(const [cookie,origin,status] of [['',f.config.origin,401],[staff.cookie,'https://evil.example',403]] as const){
    const ws=new WebSocket(f.url.replace('http','ws')+'/api/live',{headers:{Cookie:cookie,Origin:origin}});ws.on('error',()=>{});
    const [,response]=await once(ws,'unexpected-response');assert.equal(response.statusCode,status);response.resume();ws.terminate();
  }
 }finally{await f.close();}
});
test('live snapshots are shared for lists, isolated by staff identity for details, and removed on logout',async()=>{
 const f=await fixture();try{
  const game=gameFixture();await connect(f,game.handler);
  const admin=await login(f),viewer=await login(f,'viewer');
  const a=await browser(f,admin),v=await browser(f,viewer);
  await until(()=>a.messages.some(m=>m.type==='players')&&v.messages.some(m=>m.type==='players'));
  assert.equal(game.messages.filter(m=>m.operation==='watch'&&m.target==='players').length,1);
  a.ws.send(JSON.stringify({type:'select',player:playerId}));v.ws.send(JSON.stringify({type:'select',player:playerId}));
  await until(()=>a.messages.some(m=>m.type==='player')&&v.messages.some(m=>m.type==='player'));
  const watches=game.messages.filter(m=>m.operation==='watch'&&m.target==='player');
  const adminId=watches[0]!.actor.uuid,viewerId=watches[1]!.actor.uuid;
  assert.notEqual(adminId,viewerId);
  const reads=game.messages.filter(m=>['players','player'].includes(m.operation)).length;
  game.players.serverPlayers=2;game.detail.location.x=123;game.detail.notes.push({id:'note',text:'Changed in game',canEdit:false});game.publish();
  await until(()=>a.messages.some(m=>m.type==='players'&&m.data.serverPlayers===2)&&v.messages.some(m=>m.type==='player'&&m.data.location.x===123));
  assert.equal(game.messages.filter(m=>['players','player'].includes(m.operation)).length,reads,'push needs no HTTP read');
  const closed=once(v.ws,'close');await f.app.inject({method:'POST',url:'/api/logout',headers:headers(f,viewer),payload:{}});assert.equal((await closed)[0],4001);
  await until(()=>game.messages.some(m=>m.operation==='unwatch'&&m.watchId!=='players'));
  assert(!game.messages.some(m=>m.operation==='unwatch'&&m.watchId==='players'),'remaining staff retain shared list');
  a.ws.close();await once(a.ws,'close');await until(()=>game.messages.some(m=>m.operation==='unwatch'&&m.watchId==='players'));
 }finally{await f.close();}
});
test('live watchers survive game reconnect, clear stale snapshots, and expire without another API call',async()=>{
 const f=await fixture();try{
  const game=gameFixture(),gameSocket=await connect(f,game.handler),staff=await login(f),client=await browser(f,staff);
  await until(()=>client.messages.some(m=>m.type==='players'));
  gameSocket.close();await once(gameSocket,'close');await until(()=>client.messages.some(m=>m.type==='status'&&!m.connected));
  const second=await browser(f,staff);await delay(50);assert(!second.messages.some(m=>m.type==='players'),'no stale snapshot on reconnect');
  game.players.serverPlayers=3;await connect(f,game.handler);
  await until(()=>client.messages.some(m=>m.type==='players'&&m.data.serverPlayers===3)&&second.messages.some(m=>m.type==='players'&&m.data.serverPlayers===3));
  const session=f.auth.get(staff.cookie.split('=')[1]!)!;session.expires=0;
  const c1=once(client.ws,'close'),c2=once(second.ws,'close');game.publish();assert.equal((await c1)[0],4001);assert.equal((await c2)[0],4001);assert(f.bridge.connected,'staff session expiry does not disconnect Minecraft');
 }finally{await f.close();}
});

test('live sockets bound tab counts and reject large subscription messages',async()=>{
 const f=await fixture();try{
  const game=gameFixture();await connect(f,game.handler);const staff=await login(f);
  const clients=[];for(let i=0;i<4;i++)clients.push(await browser(f,staff));
  const extra=await browser(f,staff);assert.equal((await once(extra.ws,'close'))[0],1013);
  const closed=once(clients[0]!.ws,'close');clients[0]!.ws.send('x'.repeat(257));assert.equal((await closed)[0],1009);
  assert.equal(game.messages.filter(m=>m.operation==='watch'&&m.target==='players').length,1);
 }finally{await f.close();}
});

test('live streams redact denied tabs and audit-only users cannot subscribe to players',async()=>{
 const f=await fixture();try{
  const game=gameFixture();await connect(f,game.handler);
  f.config.users.get('admin')!.permissions=['panel.access','tab.players','tab.notes'];
  const staff=await login(f),client=await browser(f,staff);
  client.ws.send(JSON.stringify({type:'select',player:playerId}));
  await until(()=>client.messages.some(m=>m.type==='player'));
  const detail=client.messages.find(m=>m.type==='player').data;
  assert('notes' in detail);assert(!('cases' in detail));assert(!('storage' in detail));assert(!('tsa' in detail));assert(!('location' in detail));
  assert(!('hasDetections' in client.messages.find(m=>m.type==='players').data.players[0]));
  f.config.users.get('viewer')!.permissions=['panel.access','tab.audit'];
  const audit=await browser(f,await login(f,'viewer'));audit.ws.send(JSON.stringify({type:'select',player:playerId}));
  await until(()=>audit.messages.some(m=>m.type==='live-error'));
  assert(!audit.messages.some(m=>m.type==='players'||m.type==='player'));
 }finally{await f.close();}
});
