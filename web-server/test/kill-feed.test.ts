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
