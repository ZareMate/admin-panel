import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fixture, playerId } from './helpers.js';
import { PERMISSIONS, legacyPermissions } from '../src/permissions.js';
import { discordUuid } from '../src/common.js';

test('production Java BridgeClient connects to Fastify and executes commands with identity and permissions', {skip:!process.env.JAVA_BRIDGE_CLASSPATH,timeout:25000},async()=>{
 const f=await fixture();
 const child=spawn('java',['-cp',process.env.JAVA_BRIDGE_CLASSPATH!,'com.zaremate.admin_panel.NodeBridgeFixture',f.url.replace('http','ws')+'/bridge'],{env:{...process.env,TEST_BRIDGE_TOKEN:f.config.bridgeToken},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
 try {
  const end=Date.now()+10000;while(!f.bridge.connected&&Date.now()<end&&child.exitCode===null)await new Promise(r=>setTimeout(r,25));assert(f.bridge.connected,stderr);
  assert.equal((await f.bridge.players() as any).javaBridge,true);
  const snapshots:any[]=[],profiles:any[]=[];
  const waitFor=async(check:()=>boolean)=>{const end=Date.now()+4000;while(!check()&&Date.now()<end)await new Promise(r=>setTimeout(r,20));assert(check(),'live Java snapshot arrived');};
  const unlist=f.bridge.watch('players',{target:'players'},data=>{if(data)snapshots.push(data);});
  await waitFor(()=>snapshots.length>0);
  await new Promise(r=>setTimeout(r,1200));assert.equal(snapshots.length,1,'capture timestamps do not resend unchanged state');
  const user={name:'Node staff',rank:'owner',permissions:[...PERMISSIONS],uuid:discordUuid('12345678901234572')};
  const unprofile=f.bridge.watch('java-profile',{target:'player',player:playerId,actor:user},data=>{if(data)profiles.push(data);});
  await waitFor(()=>profiles.length>0);assert.equal(profiles[0].notes[0].viewer,user.uuid);
  const detail=await f.bridge.player(playerId,user) as any;assert.equal(detail.notes[0].viewer,user.uuid);assert.equal(detail.notes[0].rank,'owner');
  const result=await f.bridge.mutate(playerId,user,'note-add',{text:'Round trip'}) as any;assert.equal(result.mutations,1);
  await assert.rejects(f.bridge.mutate(playerId,{...user,permissions:legacyPermissions('viewer')},'note-add',{text:'Denied'}),/Permission required/);
  assert.equal((await f.bridge.players() as any).mutations,1);
  assert.equal((await f.bridge.mutate(playerId,user,'punish',{type:'WARN',reason:'Wire contract',durationMinutes:0,silent:false}) as any).mutations,2);
  assert.equal((await f.bridge.mutate(playerId,user,'revoke',{caseId:1,reason:'Wire contract'}) as any).mutations,3);
  await waitFor(()=>snapshots.at(-1)?.mutations===3&&profiles.at(-1)?.notes[0]?.mutations===3);
  snapshots.length=0;profiles.length=0;
  for(const socket of f.app.websocketServer.clients)socket.close(1001,'Reconnect test');
  await new Promise(r=>setTimeout(r,100));assert.equal(f.bridge.connected,false);
  const reconnectEnd=Date.now()+10000;while(!f.bridge.connected&&Date.now()<reconnectEnd)await new Promise(r=>setTimeout(r,50));
  assert(f.bridge.connected,'Java reconnects');assert.equal((await f.bridge.players() as any).mutations,3,'No commands replayed on reconnect');
  await waitFor(()=>snapshots.length>0&&profiles.length>0);assert.equal(profiles[0].notes[0].viewer,user.uuid);
  unlist();unprofile();await new Promise(r=>setTimeout(r,200));snapshots.length=0;profiles.length=0;
  await f.bridge.mutate(playerId,user,'note-add',{text:'No watchers'});await new Promise(r=>setTimeout(r,1200));assert.equal(snapshots.length,0);assert.equal(profiles.length,0);
 }finally{child.kill('SIGTERM');await once(child,'exit');await f.close();}
});

test('large Java responses and live snapshots cross both WebSocket hops in bounded batches', {skip:!process.env.JAVA_BRIDGE_CLASSPATH,timeout:60000},async()=>{
 const {login}=await import('./helpers.js');const {BatchReceiver,MAX_FRAME_BYTES}=await import('../src/batches.js');const {WebSocket}=await import('ws');
 const f=await fixture();const child=spawn('java',['-cp',process.env.JAVA_BRIDGE_CLASSPATH!,'com.zaremate.admin_panel.NodeBridgeFixture',f.url.replace('http','ws')+'/bridge'],{env:{...process.env,TEST_BRIDGE_TOKEN:f.config.bridgeToken,TEST_LARGE_BRIDGE:'1'},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
 try{
  const until=async(check:()=>boolean)=>{const end=Date.now()+15000;while(!check()&&Date.now()<end&&child.exitCode===null)await new Promise(r=>setTimeout(r,20));assert(check(),stderr||'Expected large transfer');};
  await until(()=>f.bridge.connected);
  let gameFrames=0;for(const ws of f.app.websocketServer.clients)ws.on('message',data=>{assert(Buffer.byteLength(data.toString())<=MAX_FRAME_BYTES);gameFrames++;});
  const players=await f.bridge.players() as any;assert.equal(players.large,'😀漢字'+'x'.repeat(9*1024*1024));assert(gameFrames>1000);
  const user={name:'Large reader',rank:'reader',permissions:legacyPermissions('viewer'),uuid:playerId};
  const profile=await f.bridge.player(playerId,user) as any;assert.equal(profile.notes[0].text,players.large);
  const staff=await login(f),receiver=new BatchReceiver();let liveList:any,liveProfile:any,browserFrames=0;
  const browser=new WebSocket(f.url.replace('http','ws')+'/api/live',{headers:{Origin:f.config.origin,Cookie:staff.cookie},maxPayload:MAX_FRAME_BYTES});
  browser.on('message',data=>{browserFrames++;const message=receiver.accept(data.toString());if(message?.type==='players')liveList=message.data;if(message?.type==='player')liveProfile=message.data;});
  await once(browser,'open');await until(()=>!!liveList);assert.equal(liveList.large,players.large);
  browser.send(JSON.stringify({type:'select',player:playerId}));await until(()=>!!liveProfile);assert.equal(liveProfile.notes[0].text,players.large);assert(browserFrames>2000);
  browser.close();await once(browser,'close');
 }finally{child.kill('SIGTERM');await once(child,'exit');await f.close();}
});
