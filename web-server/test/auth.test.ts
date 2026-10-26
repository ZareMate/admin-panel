import test from 'node:test';
import assert from 'node:assert/strict';
import { Auth } from '../src/auth.js';
import { Failure } from '../src/common.js';
import { fixture } from './helpers.js';
const grant={access_token:'private-access',token_type:'Bearer',scope:'identify guilds.members.read',expires_in:3600};
const identity={id:'12345678901234572',username:'Staff'};
const member={roles:['12345678901234569'],user:{id:identity.id}};
function finish(auth:Auth){const start=auth.start();return auth.finish(new URL(start.location).searchParams.get('state')!,start.browser,'code',false);}

test('production OAuth rejects invalid grants, membership and explicit denial without fallback',async()=>{
 const f=await fixture({discord:true});try{
  for(const [stage,replacement] of [
   [0,{...grant,scope:'identify'}],[0,{...grant,token_type:'Basic'}],[0,{...grant,expires_in:0}],
   [1,{...identity,id:'invalid'}],[2,{...member,pending:true}],[2,{...member,user:{id:'12345678901234573'}}],
   [2,{roles:[]}],[2,{roles:'not-an-array'}]
  ] as const){
   let calls=0;const auth=new Auth(f.config,async()=>Response.json(calls++===stage?replacement:[grant,identity,member][calls-1]));
   await assert.rejects(finish(auth),Failure);
  }
  f.config.ranks[0]!.permissions=[];
  let calls=0;const denied=new Auth(f.config,async()=>Response.json([grant,identity,{...member,roles:['12345678901234569','12345678901234570']}][calls++]));
  await assert.rejects(finish(denied),/do not grant panel access/);
 }finally{await f.close();}
});

test('production Discord client classifies upstream failures, redacts bodies and honors cooldown',async()=>{
 const f=await fixture({discord:true});try{
  for(const stage of [0,1,2])for(const status of [400,401,403,404,429,500,502]){
   let calls=0;const auth=new Auth(f.config,async()=>calls++===stage?Response.json({error:'private-provider-secret'},{status,headers:{'retry-after':'60'}}):Response.json([grant,identity,member][calls-1]));
   await assert.rejects(finish(auth),(error:Failure)=>error.statusCode===([400,401].includes(status)?401:[403,404].includes(status)?403:503)&&!error.message.includes('private-provider-secret'));
   if(status===429){const before=calls;await assert.rejects(finish(auth),/rate-limited/);assert.equal(calls,before);}
  }
  for(const fetcher of [async()=>{throw new Error('private-network-details');},async()=>new Response('malformed-json')]){
   await assert.rejects(finish(new Auth(f.config,fetcher)),(error:Failure)=>error.statusCode===503&&!error.message.includes('private-network-details'));
  }
 }finally{await f.close();}
});

test('session permissions are immutable login snapshots and logout/expiration revoke access',async()=>{
 const f=await fixture();try{
  const user=f.config.users.get('admin')!,before=[...user.permissions!],id=f.auth.create(user);
  user.permissions!.length=0;assert.deepEqual(f.auth.get(id)!.user.permissions,before);
  f.auth.logout(id);assert.equal(f.auth.get(id),undefined);
  const expired=f.auth.create({...user,permissions:before},Date.now()-1);assert.equal(f.auth.get(expired),undefined);
  for(let i=0;i<10;i++)f.auth.allowLogin('test-ip');assert.throws(()=>f.auth.allowLogin('test-ip'),/Too many login/);
 }finally{await f.close();}
});
