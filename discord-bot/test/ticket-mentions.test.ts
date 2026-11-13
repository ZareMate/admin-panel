import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketMentionUsers, invalidateTicketMentions } from '../src/tickets.js';
const me='22345678901234567',other='22345678901234568';
const message=(id:string,users:string[])=>({id,mentions:{users:new Map(users.map(id=>[id,{id}])),roles:new Map([['role',{id:'role'}]]),everyone:true}});
test('scans all pages, caches unchanged tickets, incrementally scans new messages and rebuilds after edits/deletes',async()=>{
 let calls=0,edited=false;
 const channel={id:'ticket-test',lastMessageId:'32345678901234700',messages:{fetch:async(options:{before?:string})=>{
  calls++;
  if(options.before)return new Map([['old',message('32345678901234567',edited?[]:[me])]]);
  return new Map(Array.from({length:100},(_,i)=>{const id=String(32345678901234700n-BigInt(i));return [id,message(id,i===0?[other]:[])];}));
 }}};
 assert.deepEqual(new Set(await ticketMentionUsers(channel)),new Set([other,me]));assert.equal(calls,2);
 await ticketMentionUsers(channel);assert.equal(calls,2);
 channel.lastMessageId='32345678901234701';
 assert.deepEqual(new Set(await ticketMentionUsers(channel)),new Set([other,me]));assert.equal(calls,3);
 edited=true;invalidateTicketMentions(channel.id);
 assert.deepEqual(await ticketMentionUsers(channel),[other]);assert.equal(calls,5);
 invalidateTicketMentions(channel.id);
});
test('role/everyone mentions do not count and a failed history fetch is retried',async()=>{
 let fail=true;
 const channel={id:'ticket-failure',lastMessageId:null,messages:{fetch:async()=>{
  if(fail)throw new Error('no history access');
  return new Map([['message',message('32345678901234567',[])]]);
 }}};
 await assert.rejects(ticketMentionUsers(channel),/no history/);fail=false;
 assert.deepEqual(await ticketMentionUsers(channel),[]);invalidateTicketMentions(channel.id);
});
