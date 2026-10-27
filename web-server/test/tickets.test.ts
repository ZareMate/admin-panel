import test from 'node:test';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Tickets } from '../src/tickets.js';
import { TICKET_CATEGORIES } from '../src/ticket-categories.js';
import { fixture,login,headers,ticketPush } from './helpers.js';
const row={id:'12345678901234567',guildId:'12345678901234568',name:'lost-items-or-airship-1619',category:'lost-items-or-airship',tags:['Open']};
const user={permissions:['tab.tickets','tickets.lost-items-or-airship']};
const batch=(tickets:unknown[],index=0,final=true,snapshot=randomUUID())=>({snapshot,index,final,categories:TICKET_CATEGORIES,tickets});
test('ticket snapshots are atomic, ordered, validated and remove old entries',()=>{
 const store=new Tickets();store.accept(batch([row]));
 const id=randomUUID();store.accept(batch([],0,false,id));assert.equal(store.list(user,undefined,0).total,1);
 assert.throws(()=>store.accept(batch([],2,true,id)),/out of order/);
 store.accept(batch([],1,true,id));assert.equal(store.list(user,undefined,0).total,0);
 assert.throws(()=>store.accept(batch([{...row,category:'secret'}])),/Invalid ticket/);
 assert.throws(()=>store.accept(batch([row,row])),/Duplicate ticket/);
 assert.throws(()=>store.list(user,undefined,-1),/offset/);
});
test('every category requires its own permission and the parent tab; pagination is bounded',()=>{
 const store=new Tickets();store.accept(batch(Array.from({length:120},(_,i)=>({...row,id:String(12345678901234567n+BigInt(i))}))));
 assert.equal(store.list(user,undefined,0).tickets.length,50);assert.equal(store.list(user,undefined,100).tickets.length,20);
 for(const c of TICKET_CATEGORIES){assert.throws(()=>store.list({permissions:['tab.tickets']},c.id,0),/permission/);assert.throws(()=>store.list({permissions:['tickets.'+c.id]},c.id,0),/tab.tickets/);}
 assert.deepEqual(store.list(user,undefined,0).categories,[TICKET_CATEGORIES[0]]);
 assert.equal(store.list({permissions:['tab.tickets']},undefined,0).total,0);
});
test('bot batches reach authenticated panel endpoint and cannot bypass staff category authorization',async()=>{
 const f=await fixture();try{
  f.config.ticketSyncToken='a'.repeat(43);
  await assert.rejects(ticketPush(f,batch([row]),'wrong'),/401/);
  const rows=Array.from({length:150},(_,i)=>({...row,id:String(12345678901234567n+BigInt(i))}));
  const snapshot=randomUUID();
  for(let i=0;i<3;i++)assert.equal((await ticketPush(f,batch(rows.slice(i*50,(i+1)*50),i,i===2,snapshot))).ok,true);
  assert.equal((await f.app.inject({url:'/api/tickets',headers:{host:new URL(f.config.origin).host}})).statusCode,401);
  f.config.users.get('admin')!.permissions=['panel.access',...user.permissions];const staff=await login(f);
  const get=(query='')=>f.app.inject({url:'/api/tickets'+query,headers:headers(f,staff)});
  assert.equal((await get()).json().total,150);assert.equal((await get('?category=report')).statusCode,403);
  assert.equal((await get()).json().categories.length,1);
 }finally{await f.close();}
});

test('conversation API enforces category and reply grants, CSRF, duplicate prevention and audit',async()=>{
 const {WebSocket}=await import('ws');
 const f=await fixture();let bot:InstanceType<typeof WebSocket>|undefined;
 try{
  f.config.ticketSyncToken='a'.repeat(43);await ticketPush(f,batch([row]));
  f.config.users.get('admin')!.permissions=['panel.access',...user.permissions];
  let staff=await login(f);const base='/api/tickets/'+row.id;
  const get=(id=row.id)=>f.app.inject({url:'/api/tickets/'+id+'/messages',headers:headers(f,staff)});
  const post=(id:string,csrf=true)=>f.app.inject({method:'POST',url:base+'/reply',headers:{...headers(f,staff),'x-request-id':id,...(!csrf?{'x-csrf-token':'bad'}:{})},payload:{content:'Helpful reply'}});
  assert.equal((await get()).statusCode,503);
  bot=new WebSocket(f.url.replace('http','ws')+'/tickets-commands',{headers:{Authorization:'Bearer '+f.config.ticketSyncToken}});await once(bot,'open');
  const commands:Record<string,unknown>[]=[];
  bot.on('message',data=>{const c=JSON.parse(data.toString());commands.push(c);bot!.send(JSON.stringify({type:'item',id:c.id,message:{id:row.id,author:'Player',content:'Help <script>',bot:false,createdAt:1,attachments:[],embeds:[]}}));bot!.send(JSON.stringify({type:'done',id:c.id,hasMore:false}));});
  assert.equal((await get()).json().messages[0].content,'Help <script>');
  assert.equal((await get('12345678901234569')).statusCode,403);
  assert.equal((await post(randomUUID())).statusCode,403);assert.equal(commands.length,1);
  f.config.users.get('admin')!.permissions!.push('tickets.reply');staff=await login(f);
  assert.equal((await post(randomUUID(),false)).statusCode,403);
  const id=randomUUID();assert.equal((await post(id)).statusCode,200);assert.equal((await post(id)).statusCode,409);
  assert.equal(commands.length,2);assert.equal(commands[1]!.actor,'admin');assert.equal(commands[1]!.rank,'admin');
  assert(f.audit.recent().some(r=>r.action==='ticket-reply'&&r.state==='success'));
 }finally{bot?.terminate();await f.close();}
});
