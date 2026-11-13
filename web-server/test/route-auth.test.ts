import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { fixture, login, headers } from './helpers.js';

test('encoded API routes retain session, permission and CSRF checks',async()=>{
 const f=await fixture();try{
  for(const path of ['/%61pi/session','/a%70i/session','/api/%73ession','/%61pi/dns','/%61pi/access/ranks','/%61pi/tickets/counts']){
   const result=await f.app.inject({url:path,headers:headers(f)});assert.equal(result.statusCode,401,path);
  }
  const staff=await login(f),viewer=await login(f,'viewer');
  assert.equal((await f.app.inject({url:'/%61pi/session',headers:headers(f,staff)})).json().name,'admin');
  assert.equal((await f.app.inject({url:'/%61pi/dns',headers:headers(f,viewer)})).statusCode,403);
  assert.equal((await f.app.inject({method:'POST',url:'/%61pi/logout',headers:{...headers(f,staff),'x-csrf-token':'wrong'},payload:{}})).statusCode,403);
  assert.equal((await f.app.inject({url:'/api/session',headers:headers(f,staff)})).statusCode,200);
  assert.equal((await f.app.inject({method:'POST',url:'/%61pi/logout',headers:headers(f,staff),payload:{}})).statusCode,200);
  assert.equal((await f.app.inject({url:'/api/session',headers:headers(f,staff)})).statusCode,401);
  assert.equal((await f.app.inject({url:'/%61pi/auth/method',headers:headers(f)})).statusCode,200);
 }finally{await f.close();}
});
async function rejected(url:string,requestHeaders:Record<string,string>,status:number){
 const socket=new WebSocket(url,{headers:requestHeaders});socket.on('error',()=>{});
 try{
  const [,response]=await once(socket,'unexpected-response');assert.equal(response.statusCode,status);response.resume();
 }finally{socket.terminate();}
}
test('encoded service WebSockets reject missing or incorrect secrets before attachment',async()=>{
 const f=await fixture();try{
  f.config.ticketSyncToken='s'.repeat(43);
  const base=f.url.replace('http','ws');
  for(const path of ['/%62ridge','/b%72idge','/%74ickets-sync','/%74ickets-commands']){
   await rejected(base+path,{},401);
   await rejected(base+path,{Authorization:'Bearer incorrect'},401);
  }
  assert.equal(f.bridge.connected,false);
  // The correct credentials still authorize the encoded equivalent of each route.
  for(const [path,secret] of [['/%62ridge',f.config.bridgeToken],['/%74ickets-sync',f.config.ticketSyncToken],['/%74ickets-commands',f.config.ticketSyncToken]]){
   const socket=new WebSocket(base+path,{headers:{Authorization:'Bearer '+secret}});socket.on('error',()=>{});
   await once(socket,'open');if(path==='/%62ridge')assert.equal(f.bridge.connected,true);
   const closed=once(socket,'close');socket.close();await closed;
  }
 }finally{await f.close();}
});
test('encoded Minecraft issue endpoint requires bridge authentication and encoded live requires origin and session',async()=>{
 const f=await fixture();try{
  for(const path of ['/%61pi/auth/minecraft/issue','/api/auth/minecraft/%69ssue']){
   assert.equal((await f.app.inject({method:'POST',url:path,headers:{...headers(f),'content-type':'application/json'},payload:{}})).statusCode,401);
   // Authorized requests reach input validation without requiring a browser origin.
   assert.equal((await f.app.inject({method:'POST',url:path,headers:{host:new URL(f.url).host,authorization:'Bearer '+f.config.bridgeToken,'content-type':'application/json'},payload:{}})).statusCode,400);
  }
  const staff=await login(f),base=f.url.replace('http','ws');
  await rejected(base+'/%61pi/live',{Origin:f.config.origin},401);
  await rejected(base+'/%61pi/live',{Origin:'https://attacker.invalid',Cookie:staff.cookie},403);
  const socket=new WebSocket(base+'/%61pi/live',{headers:{Origin:f.config.origin,Cookie:staff.cookie}});socket.on('error',()=>{});
  await once(socket,'open');const closed=once(socket,'close');socket.close();await closed;
 }finally{await f.close();}
});
