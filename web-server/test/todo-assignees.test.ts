import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {once} from 'node:events';
import {fixture,headers,login} from './helpers.js';
const person={id:'12345678901234579',name:'Developer nickname',rank:'dev'};
const task={title:'Assigned task',description:'Details',status:'todo',priority:'normal',assignee:person.name,assigneeId:person.id};
test('bot-backed assignments persist IDs, reject arbitrary names and count only the signed-in user’s active tasks',async()=>{
 const f=await fixture();try{
  f.config.ticketSyncToken='a'.repeat(43);
  const bot=new WebSocket(f.url.replace('http','ws')+'/tickets-commands',{headers:{Authorization:'Bearer '+f.config.ticketSyncToken}});await once(bot,'open');
  let calls=0;bot.on('message',data=>{const c=JSON.parse(data.toString());assert.equal(c.action,'todo-assignees');calls++;
   bot.send(JSON.stringify({type:'item',id:c.id,message:{assignees:[person,{id:'12345678901234580',name:'Other developer',rank:'mod'}]}}));bot.send(JSON.stringify({type:'done',id:c.id}));});
  const account=f.config.users.get('admin')!;account.permissions=['panel.access','tab.todo','todo.create','todo.edit'];account.discordId=person.id;
  const staff=await login(f);const get=(path:string)=>f.app.inject({url:path,headers:headers(f,staff)});
  const post=(path:string,payload:unknown)=>f.app.inject({method:'POST',url:path,headers:headers(f,staff),payload:payload as object});
  assert.equal((await get('/api/session')).json().discordId,person.id);
  assert.equal((await get('/api/todos/assignees')).json().assignees[0].name,person.name);
  const created=await post('/api/todos',task);assert.equal(created.statusCode,200);const id=created.json().id;
  assert.equal((await post('/api/todos',{...task,assigneeId:'12345678901234581'})).statusCode,400);
  assert.equal((await post('/api/todos',{...task,assigneeId:undefined,assignee:'some arbitrary person'})).statusCode,400);
  await post('/api/todos',{...task,title:'In progress',status:'doing'});
  await post('/api/todos',{...task,title:'Done',status:'done'});
  await post('/api/todos',{...task,title:'Someone else',assigneeId:'12345678901234580'});
  assert.deepEqual((await get('/api/todos/mine')).json(),{todo:1,doing:1,total:2});
  const edited=await post('/api/todos/'+id+'/edit',{...task,status:'done',version:1});assert.equal(edited.statusCode,200);
  assert.deepEqual((await get('/api/todos')).json().mine,{todo:0,doing:1,total:1});
  assert.equal(calls,1,'assignee lookups reuse the bot directory cache');
  account.discordId='12345678901234580';const other=await login(f);
  assert.deepEqual((await f.app.inject({url:'/api/todos/mine',headers:headers(f,other)})).json(),{todo:1,doing:0,total:1});
  account.permissions=['panel.access','todo.create'];const denied=await login(f);
  assert.equal((await f.app.inject({url:'/api/todos/assignees',headers:headers(f,denied)})).statusCode,403);
  assert.equal((await f.app.inject({url:'/api/todos/mine',headers:headers(f,denied)})).statusCode,403);
 }finally{await f.close();}
});
test('unassigned tasks stay usable without the bot while new assignments fail safely',async()=>{
 const f=await fixture();try{
  const account=f.config.users.get('admin')!;account.permissions=['panel.access','tab.todo','todo.create','todo.edit'];const staff=await login(f);
  const post=(path:string,payload:unknown)=>f.app.inject({method:'POST',url:path,headers:headers(f,staff),payload:payload as object});
  const created=await post('/api/todos',{...task,assigneeId:'',assignee:''});assert.equal(created.statusCode,200);
  assert.equal((await post('/api/todos/'+created.json().id+'/edit',{...task,assigneeId:'',assignee:'',status:'doing',version:1})).statusCode,200);
  assert.equal((await post('/api/todos',task)).statusCode,503);
 }finally{await f.close();}
});
