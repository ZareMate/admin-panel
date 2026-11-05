import test from 'node:test';
import assert from 'node:assert/strict';
import {deathFixture} from './kill-feed-fixtures.js';
import {fixture,login,headers,connect} from './helpers.js';
test('kill feed has independent permissions, redacts inventory in summaries/details and validates pagination',async()=>{
 const f=await fixture();try{
  const row=deathFixture(),requests:any[]=[];
  await connect(f,(request,socket)=>{requests.push(request);socket.send(JSON.stringify({id:request.id,result:request.entry?row:{entries:[row],total:1,offset:request.offset,limit:request.limit}}));});
  const user=f.config.users.get('admin')!;user.permissions=['panel.access','killFeed.inventory'];let staff=await login(f);
  assert.equal((await f.app.inject({url:'/api/kill-feed',headers:headers(f,staff)})).statusCode,403);assert.equal(requests.length,0);
  user.permissions=['panel.access','tab.killFeed'];staff=await login(f);
  const list=await f.app.inject({url:'/api/kill-feed?q=Custom%20Blade&offset=0&limit=1',headers:headers(f,staff)});
  assert.equal(list.statusCode,200);assert(!list.json().entries[0].inventory);assert.equal(requests[0].query,'Custom Blade');
  const detail=await f.app.inject({url:'/api/kill-feed/'+row.id,headers:headers(f,staff)});assert.equal(detail.statusCode,200);assert(!detail.json().inventory);assert.equal(detail.json().weapon.customName,'Custom Blade');
  for(const query of ['offset=-1','limit=51','limit=NaN','q='+'a'.repeat(129)])assert.equal((await f.app.inject({url:'/api/kill-feed?'+query,headers:headers(f,staff)})).statusCode,400);
  assert.equal((await f.app.inject({url:'/api/kill-feed/bad',headers:headers(f,staff)})).statusCode,400);
  user.permissions=['panel.access','tab.killFeed','killFeed.inventory'];staff=await login(f);
  assert.equal((await f.app.inject({url:'/api/kill-feed/'+row.id,headers:headers(f,staff)})).json().inventory.inventory.groups[0].slots[0].name,'Victim armor');
  assert.deepEqual(requests.at(-1).actor.permissions,['panel.access','tab.killFeed','killFeed.inventory']);
  assert.equal((await f.app.inject({url:'/api/players',headers:headers(f,staff)})).statusCode,403);
 }finally{await f.close();}
});

test('directory, map and kill feed share cached names and the same UUID head cache',async()=>{
 const {gameFixture,playerId}=await import('./helpers.js');const sharp=(await import('sharp')).default;
 const png=await sharp({create:{width:8,height:8,channels:4,background:'#4488cc'}}).png().toBuffer();
 const urls:string[]=[];
 const f=await fixture({fetcher:async input=>{urls.push(String(input));assert(String(input).startsWith('https://mineskin.eu/'));return new Response(new Uint8Array(png));}});
 try{
  const game=gameFixture(),death=deathFixture();game.players.players[0]!.name='SharedName';game.detail.name='SharedName';
  death.victim={...death.victim,uuid:playerId,name:'HistoricalName'};
  await connect(f,(request,socket)=>{
   if(request.operation==='kill-feed')socket.send(JSON.stringify({id:request.id,result:request.entry?death:{entries:[death],total:1}}));
   else if(request.operation==='map-players')socket.send(JSON.stringify({id:request.id,result:{players:[{uuid:playerId,name:playerId}],dimensions:[]}}));
   else game.handler(request,socket);
  });
  const staff=await login(f),request=(url:string)=>f.app.inject({url,headers:headers(f,staff)});
  assert.equal((await request('/api/players')).json().players[0].name,'SharedName');
  assert.equal((await request('/api/map/players')).json().players[0].name,'SharedName');
  const list=(await request('/api/kill-feed')).json();assert.equal(list.entries[0].victim.name,'SharedName');assert(!list.entries[0].inventory);
  assert.equal((await request('/api/kill-feed/'+death.id)).json().victim.name,'SharedName');
  assert.equal((await request('/api/players/'+playerId)).json().name,'SharedName');
  const path='/api/skin/head/'+playerId;
  assert.equal((await request(path)).statusCode,200);assert.equal((await request(path)).statusCode,200);
  assert.equal(urls.length,1,'all views reuse the same image service and avoid Mojang for cached names');
  assert.equal(death.victim.name,'HistoricalName','history source remains unchanged');
 }finally{await f.close();}
});
