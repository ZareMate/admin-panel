import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fixture, playerId } from './helpers.js';
import { discordUuid } from '../src/common.js';

test('production Java BridgeClient connects to Fastify and executes commands with identity and permissions', {skip:!process.env.JAVA_BRIDGE_CLASSPATH,timeout:25000},async()=>{
 const f=await fixture();
 const child=spawn('java',['-cp',process.env.JAVA_BRIDGE_CLASSPATH!,'com.zaremate.admin_panel.NodeBridgeFixture',f.url.replace('http','ws')+'/bridge'],{env:{...process.env,TEST_BRIDGE_TOKEN:f.config.bridgeToken},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
 try {
  const end=Date.now()+10000;while(!f.bridge.connected&&Date.now()<end&&child.exitCode===null)await new Promise(r=>setTimeout(r,25));assert(f.bridge.connected,stderr);
  assert.equal((await f.bridge.players() as any).javaBridge,true);
  const user={name:'Node staff',role:'admin' as const,rank:'owner',uuid:discordUuid('12345678901234572')};
  const detail=await f.bridge.player(playerId,user) as any;assert.equal(detail.viewer,user.uuid);assert.equal(detail.rank,'owner');
  const result=await f.bridge.mutate(playerId,user,'note-add',{text:'Round trip'}) as any;assert.equal(result.mutations,1);
  await assert.rejects(f.bridge.mutate(playerId,{...user,role:'viewer'},'note-add',{text:'Denied'}),/Moderator/);
  assert.equal((await f.bridge.players() as any).mutations,1);
  assert.equal((await f.bridge.mutate(playerId,user,'punish',{type:'WARN',reason:'Wire contract',durationMinutes:0,silent:false}) as any).mutations,2);
  assert.equal((await f.bridge.mutate(playerId,user,'revoke',{caseId:1,reason:'Wire contract'}) as any).mutations,3);
  for(const socket of f.app.websocketServer.clients)socket.close(1001,'Reconnect test');
  await new Promise(r=>setTimeout(r,100));assert.equal(f.bridge.connected,false);
  const reconnectEnd=Date.now()+10000;while(!f.bridge.connected&&Date.now()<reconnectEnd)await new Promise(r=>setTimeout(r,50));
  assert(f.bridge.connected,'Java reconnects');assert.equal((await f.bridge.players() as any).mutations,3,'No commands replayed on reconnect');
 }finally{child.kill('SIGTERM');await once(child,'exit');await f.close();}
});
