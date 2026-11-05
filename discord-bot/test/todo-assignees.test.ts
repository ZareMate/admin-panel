import test from 'node:test';
import assert from 'node:assert/strict';
import type {Guild} from 'discord.js';
import {todoAssignees} from '../src/todo-assignees.js';
const guildId='12345678901234567',allowed='12345678901234568',deny='12345678901234569';
const ranks=[{roleId:deny,name:'blocked',assignable:false},{roleId:allowed,name:'developer',assignable:true}];
const member=(id:string,roles:string[],bot=false,pending=false)=>({id,displayName:'Nickname '+id,user:{bot},pending,roles:{cache:new Map(roles.map(role=>[role,{}]))}});
test('bot directory uses highest configured rank, excludes bots/pending members and caches results',async()=>{
 let calls=0;
 const members=new Map([['12345678901234570',member('12345678901234570',[allowed])],['12345678901234571',member('12345678901234571',[deny,allowed])],['12345678901234572',member('12345678901234572',[allowed],true)],['12345678901234573',member('12345678901234573',[allowed],false,true)]]);
 const guild={id:guildId,members:{list:async()=>{calls++;return members;}}} as unknown as Guild;
 const result=await todoAssignees(guild,guildId,{guildId,ranks});
 assert.equal(result.messages[0]!.assignees.length,1);assert.equal(result.messages[0]!.assignees[0]!.id,'12345678901234570');assert.equal(result.messages[0]!.assignees[0]!.rank,'developer');
 await todoAssignees(guild,guildId,{guildId,ranks});assert.equal(calls,1);
 await assert.rejects(todoAssignees(guild,guildId,{guildId:'12345678901234574',ranks}),/todo-guild-mismatch/);
});
test('bot directory paginates members rather than relying on gateway member cache',async()=>{
 let calls=0;
 const first=new Map(Array.from({length:1000},(_,i)=>{const id=String(12345678901235000n+BigInt(i));return [id,member(id,[])];}));
 const finalId='12345678901237000';
 const guild={id:guildId,members:{list:async(options:{after?:string})=>{calls++;if(calls===1)return first;assert.equal(options.after,'12345678901235999');return new Map([[finalId,member(finalId,[allowed])]]);}}} as unknown as Guild;
 const result=await todoAssignees(guild,guildId,{guildId,ranks});assert.equal(calls,2);assert.equal(result.messages[0]!.assignees[0]!.id,finalId);
});
