import test from 'node:test';
import assert from 'node:assert/strict';
import { Todos } from '../src/todos.js';
import { fixture,login,headers } from './helpers.js';
const draft={title:'Fix airship physics',description:'Reproduce the launch bug',status:'todo',priority:'high',assignee:'Pilot'};
test('tasks persist across reloads, reject stale edits and deduplicate suggestion imports',async()=>{
 const f=await fixture();try{
  const store=new Todos(f.dir+'/tasks-test.json');await store.load();const created=await store.mutate('Dev',draft) as any;
  const reopened=new Todos(f.dir+'/tasks-test.json');await reopened.load();assert.equal(reopened.list()[0]!.title,draft.title);
  await reopened.mutate('Other dev',{...draft,status:'doing',version:1},created.id);
  await assert.rejects(reopened.mutate('Dev',{...draft,version:1},created.id),/changed/);
  const source={id:'12345678901234567',guildId:'12345678901234568'};await reopened.mutate('Dev',{...draft,source});await assert.rejects(reopened.mutate('Dev',{...draft,source}),/already has a task/);
  await reopened.mutate('Dev',{version:2},created.id,true);assert.equal(reopened.list().length,1);
  const last=new Todos(f.dir+'/tasks-test.json');await last.load();assert.equal(last.list().length,1);
 }finally{await f.close();}
});
test('to-do API enforces independent grants, CSRF and validated task fields',async()=>{
 const f=await fixture();try{
  const account=f.config.users.get('admin')!;account.permissions=['panel.access','tab.todo'];let staff=await login(f);
  const post=(path:string,payload:unknown)=>f.app.inject({method:'POST',url:path,headers:headers(f,staff),payload:JSON.stringify(payload)});
  assert.equal((await post('/api/todos',draft)).statusCode,403);
  account.permissions.push('todo.create');staff=await login(f);
  const created=await post('/api/todos',draft);assert.equal(created.statusCode,200);const id=created.json().id;
  assert.equal((await post('/api/todos/'+id+'/edit',{...draft,version:1})).statusCode,403);
  assert.equal((await post('/api/todos/'+id+'/delete',{version:1})).statusCode,403);
  assert.equal((await post('/api/todos',{...draft,title:' '})).statusCode,400);
  assert.equal((await f.app.inject({method:'POST',url:'/api/todos',headers:{...headers(f,staff),'x-csrf-token':'bad'},payload:draft})).statusCode,403);
  account.permissions=['panel.access','todo.create'];staff=await login(f);assert.equal((await post('/api/todos',draft)).statusCode,403);
  assert.equal((await f.app.inject({url:'/api/todos',headers:headers(f,staff)})).statusCode,403);
 }finally{await f.close();}
});
