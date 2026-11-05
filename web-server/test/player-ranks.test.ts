import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {once} from 'node:events';
import {fixture,headers,login,connect,gameFixture} from './helpers.js';
test('player ranks use linked Discord IDs without exposing IDs or requiring to-do access',async()=>{
 const f=await fixture();try{
  const game=gameFixture();Object.assign(game.players.players[0]!,{discordId:'12345678901234579'});Object.assign(game.players.players[1]!,{discordId:''});
  await connect(f,game.handler);
  f.config.ranks=[{name:'owner',discordRoleId:'12345678901234569',permissions:['panel.access']},{name:'viewer',discordRoleId:'12345678901234571',permissions:['panel.access','tab.players']}];
  f.config.ticketSyncToken='a'.repeat(43);
  const bot=new WebSocket(f.url.replace('http','ws')+'/tickets-commands',{headers:{Authorization:'Bearer '+f.config.ticketSyncToken}});await once(bot,'open');
  bot.on('message',data=>{const command=JSON.parse(data.toString());assert.equal(command.action,'todo-assignees');assert.ok(command.ranks.find((rank:{name:string;assignable:boolean})=>rank.name==='viewer')?.assignable);bot.send(JSON.stringify({type:'item',id:command.id,message:{assignees:[{id:'12345678901234579',name:'Different Discord nickname',rank:'owner'}]}}));bot.send(JSON.stringify({type:'done',id:command.id}));});
  const user=f.config.users.get('admin')!;user.permissions=['panel.access','tab.players'];const staff=await login(f);
  const response=await f.app.inject({url:'/api/player-ranks',headers:headers(f,staff)});assert.equal(response.statusCode,200);
  assert.deepEqual(response.json().players,game.players.players.map((player,index)=>({uuid:player.uuid,rank:index===0?'owner':null})));
  assert.ok(!response.body.includes('12345678901234579'));
  const list=await f.app.inject({url:'/api/players',headers:headers(f,staff)});assert.ok(!list.body.includes('discordId'));assert.ok(!list.body.includes('hasDetections'));
  user.permissions=['panel.access'];const denied=await login(f);assert.equal((await f.app.inject({url:'/api/player-ranks',headers:headers(f,denied)})).statusCode,403);
 }finally{await f.close();}
});
