import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers.js';
test('Material UI receives a fresh page style nonce without allowing inline scripts or arbitrary styles',async()=>{
 const f=await fixture();try{
  const first=await f.app.inject({url:'/',headers:{host:new URL(f.url).host}}),second=await f.app.inject({url:'/',headers:{host:new URL(f.url).host}});
  const nonce=/<meta name="style-nonce" content="([A-Za-z0-9_-]+)">/.exec(first.body)?.[1];
  assert(nonce);assert(!second.body.includes(nonce));
  const policy=String(first.headers['content-security-policy']);
  assert(policy.includes("style-src 'self' 'nonce-"+nonce+"'"));
  assert(policy.includes("script-src 'self';"));assert(!policy.includes("'unsafe-inline'"));
 }finally{await f.close();}
});
