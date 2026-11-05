import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, login, headers, connect } from './helpers.js';

test('statistics API requires its own grant and only returns anonymized aggregates',async()=>{
 const f=await fixture();try{
  const user=f.config.users.get('admin')!;
  user.permissions=['panel.access','tab.players'];
  const denied=await login(f);
  assert.equal((await f.app.inject({url:'/api/stats',headers:headers(f,denied)})).statusCode,403);
  user.permissions=['panel.access','tab.stats'];
  const granted=await login(f);
  const requests:string[]=[];
  await connect(f,(request,socket)=>{
   requests.push(request.operation);
   socket.send(JSON.stringify({id:request.id,result:{totalPlayers:10,types:['ray','esp'],players:[{types:['ray']},{types:['ray']},{types:['esp']}]}}));
  });
  const response=await f.app.inject({url:'/api/stats',headers:headers(f,granted)});
  assert.equal(response.statusCode,200);
  assert.equal(response.json().totalPlayers,10);
  assert.equal(response.json().players.length,3);
  assert(requests.includes('stats'));
  assert(!('uuid' in response.json().players[0]));
  assert.equal((await f.app.inject({url:'/api/players',headers:headers(f,granted)})).statusCode,403);
 }finally{await f.close();}
});
