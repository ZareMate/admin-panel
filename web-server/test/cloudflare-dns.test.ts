import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudflareDns, dnsRecordsFromEnv } from '../src/cloudflare-dns.js';
import { fixture, login, headers } from './helpers.js';
import { GAME_PERMISSIONS, legacyPermissions } from '../src/permissions.js';
const DNS_RECORDS=[{key:'address',type:'A' as const,name:'mc.create-craft.net'},{key:'srv',type:'SRV' as const,name:'mc.create-craft.net'},{key:'minecraft',type:'SRV' as const,name:'_minecraft._tcp.mc.create-craft.net'}];
function mock(){
 const calls:{url:string;body:any}[]=[];
 const fetcher=(async(url:any,options:any)=>{
  const u=new URL(String(url)),body=options.body?JSON.parse(options.body):undefined;calls.push({url:String(url),body});
  if(body)return Response.json({success:true,result:{}});
  const type=u.searchParams.get('type'),name=u.searchParams.get('name');
  return Response.json({success:true,result:[{id:'a'.repeat(32),type,name,content:'192.0.2.1',data:type==='SRV'?{port:25565,target:'mc.create-craft.net',priority:0,weight:5}:undefined}]});
 }) as typeof fetch;
 return {calls,fetcher};
}
test('fixed records, narrow updates, validation and stale protection',async()=>{
 const m=mock(),dns=new CloudflareDns({apiToken:'secret',zoneId:'zone',records:DNS_RECORDS},m.fetcher);
 assert.equal((await dns.list()).records.length,3);
 await dns.update({key:'address',expected:'192.0.2.1',value:'192.0.2.2'});
 assert.deepEqual(m.calls.at(-1)!.body,{content:'192.0.2.2'});
 for(const spec of DNS_RECORDS.filter(r=>r.type==='SRV')){
  await dns.update({key:spec.key,expected:25565,value:25566});
  assert.deepEqual(m.calls.at(-1)!.body,{data:{port:25566,target:'mc.create-craft.net',priority:0,weight:5}});
 }
 for(const value of [0,65536,1.5,'25565'])await assert.rejects(dns.update({key:'srv',value}),/Port/);
 await assert.rejects(dns.update({key:'address',value:'::1'}),/IPv4/);
 await assert.rejects(dns.update({key:'evil',value:'192.0.2.1'}),/Unknown/);
 const writes=m.calls.filter(c=>c.body).length;
 await assert.rejects(dns.update({key:'srv',expected:1,value:25566}),/changed/);
 assert.equal(m.calls.filter(c=>c.body).length,writes);
});
test('configuration, ambiguous records and upstream failures are safe',async()=>{
 assert.match((await new CloudflareDns({records:DNS_RECORDS}).list()).records[0]!.error!,/Configure/);
 for(const result of [[],[{},{}]]){
  const dns=new CloudflareDns({apiToken:'secret',zoneId:'z',records:DNS_RECORDS},(async()=>Response.json({success:true,result})) as typeof fetch);
  await assert.rejects(dns.update({key:'address',expected:'192.0.2.1',value:'192.0.2.2'}),/Expected exactly one/);
 }
 const dns=new CloudflareDns({apiToken:'secret',zoneId:'z',records:DNS_RECORDS},(async()=>new Response('secret upstream',{status:403})) as typeof fetch);
 const rows=await dns.list();assert(!JSON.stringify(rows).includes('secret'));assert.match(rows.records[0]!.error!,/Cloudflare/);
});
test('DNS routes enforce auth, independent grants, CSRF and audit writes',async()=>{
 const m=mock(),f=await fixture({fetcher:m.fetcher});
 try{
  Object.assign(f.config.cloudflare!,{apiToken:'secret',zoneId:'z',records:DNS_RECORDS});
  const staff=await login(f),viewer=await login(f,'viewer');
  assert.equal((await f.app.inject({url:'/api/dns',headers:headers(f)})).statusCode,401);
  assert.equal((await f.app.inject({url:'/api/dns',headers:headers(f,viewer)})).statusCode,403);
  assert.equal((await f.app.inject({method:'POST',url:'/api/dns',headers:headers(f,viewer),payload:{}})).statusCode,403);
  assert.equal((await f.app.inject({method:'POST',url:'/api/dns',headers:{...headers(f,staff),'x-csrf-token':'bad'},payload:{}})).statusCode,403);
  assert.equal((await f.app.inject({url:'/api/dns',headers:headers(f,staff)})).statusCode,200);
  const saved=await f.app.inject({method:'POST',url:'/api/dns',headers:headers(f,staff),payload:{endpoint:'192.0.2.2:25566',expected:{address:'192.0.2.1',srv:25565,minecraft:25565}}});
  assert.equal(saved.statusCode,200);
  const audit=(await f.app.inject({url:'/api/audit',headers:headers(f,staff)})).json();
  assert(audit.some((row:any)=>row.action==='dns-update'&&row.state==='success'));
  assert(!JSON.stringify(audit).includes('secret'));
  f.config.users.get('admin')!.permissions=['panel.access','tab.dns'];const reader=await login(f);
  assert.equal((await f.app.inject({method:'POST',url:'/api/dns',headers:headers(f,reader),payload:{}})).statusCode,403);
  assert(!GAME_PERMISSIONS.has('tab.dns'));assert(!GAME_PERMISSIONS.has('dns.edit'));assert(!legacyPermissions('viewer').includes('tab.dns'));
 }finally{await f.close();}
});

test('authentication failures show safe codes and actionable setup without upstream secrets',async()=>{
 for(const status of [401,403]){
  const dns=new CloudflareDns({apiToken:'private-token',zoneId:'z',records:DNS_RECORDS},(async()=>Response.json({success:false,errors:[{code:10000,message:'private-token upstream secret'},{code:'unsafe-text'}]},{status})) as typeof fetch);
  const result=await dns.list(),message=result.records[0]!.error!;
  assert.match(message,new RegExp(`HTTP ${status}; code 10000`));
  assert.match(message,/Zone \/ DNS \/ Edit/);assert.match(message,/restart the web server/);
  assert(!JSON.stringify(result).includes('private-token'));assert(!message.includes('unsafe-text'));assert(!message.includes('upstream secret'));
 }
});

test('DNS names are explicitly configured with no defaults',async()=>{
 assert.deepEqual(dnsRecordsFromEnv({}),[]);
 assert.deepEqual(dnsRecordsFromEnv({CLOUDFLARE_A_RECORDS:' , ',CLOUDFLARE_SRV_RECORDS:''}),[]);
 const records=dnsRecordsFromEnv({CLOUDFLARE_A_RECORDS:' PLAY.example.net. , other.example.net',CLOUDFLARE_SRV_RECORDS:'_minecraft._tcp.play.example.net'});
 assert.deepEqual(records.map(r=>[r.type,r.name]),[['A','play.example.net'],['A','other.example.net'],['SRV','_minecraft._tcp.play.example.net']]);
 assert.throws(()=>dnsRecordsFromEnv({CLOUDFLARE_A_RECORDS:'https://example.net'}),/Invalid/);
 assert.throws(()=>dnsRecordsFromEnv({CLOUDFLARE_A_RECORDS:'mc.example.net,MC.example.net.'}),/Duplicate/);
 await assert.rejects(new CloudflareDns({}).list(),/CLOUDFLARE_A_RECORDS/);
 const m=mock(),dns=new CloudflareDns({apiToken:'secret',zoneId:'zone',records},m.fetcher);
 const result=await dns.list();assert.deepEqual(result.records.map(r=>r.name),records.map(r=>r.name));
 await dns.update({key:records[0]!.key,expected:'192.0.2.1',value:'192.0.2.2'});
 assert.deepEqual(m.calls.at(-1)!.body,{content:'192.0.2.2'});
 await assert.rejects(dns.update({key:'A:mc.create-craft.net',value:'192.0.2.2'}),/Unknown/);
});

test('one endpoint updates all configured records in one batch after checking every value',async()=>{
 const m=mock(),dns=new CloudflareDns({apiToken:'secret',zoneId:'z',records:DNS_RECORDS},m.fetcher);
 const expected={address:'192.0.2.1',srv:25565,minecraft:25565};
 const result=await dns.updateAll({endpoint:'192.0.2.2:25566',expected});
 assert.equal(result.updated,3);assert.equal(m.calls.filter(c=>c.body).length,1);
 assert.match(m.calls.at(-1)!.url,/\/batch$/);
 const patches=m.calls.at(-1)!.body.patches;
 assert.equal(patches[0].content,'192.0.2.2');
 for(const patch of patches.slice(1))assert.deepEqual(patch.data,{port:25566,target:'mc.create-craft.net',priority:0,weight:5});
 m.calls.length=0;
 await assert.rejects(dns.updateAll({endpoint:'192.0.2.2:25566',expected:{...expected,minecraft:1}}),/changed/);
 assert.equal(m.calls.filter(c=>c.body).length,0);
 await assert.rejects(dns.updateAll({endpoint:'192.0.2.2:25566',expected:{}}),/Configured records changed/);
 for(const endpoint of ['example.net:25565','::1:25565','192.0.2.1:0','192.0.2.1:65536','192.0.2.1','192.0.2.1:2.5'])await assert.rejects(dns.updateAll({endpoint,expected}),/IPv4:port/);
 m.calls.length=0;assert.equal((await dns.updateAll({endpoint:'192.0.2.1:25565',expected})).updated,0);assert(!m.calls.some(c=>c.body));
});

test('bulk update never writes with a missing record and surfaces failed batches safely',async()=>{
 const expected={address:'192.0.2.1',srv:25565,minecraft:25565};
 const m=mock();let writes=0,failBatch=false;
 const fetcher=(async(url:any,options:any)=>{
  if(options.body){writes++;assert.equal(options.method,'POST');return Response.json({success:false,errors:[{code:10000,message:'private upstream'}]},{status:403});}
  if(!failBatch&&new URL(String(url)).searchParams.get('name')?.startsWith('_minecraft'))return Response.json({success:true,result:[]});
  return m.fetcher(url,options);
 }) as typeof fetch;
 const dns=new CloudflareDns({apiToken:'secret',zoneId:'z',records:DNS_RECORDS},fetcher);
 await assert.rejects(dns.updateAll({endpoint:'192.0.2.2:25566',expected}),/Expected exactly one/);assert.equal(writes,0);
 failBatch=true;
 await assert.rejects(dns.updateAll({endpoint:'192.0.2.2:25566',expected}),error=>error instanceof Error&&error.message.includes('HTTP 403')&&!error.message.includes('private upstream'));
 assert.equal(writes,1);
 // Failed requests release the save lock.
 await assert.rejects(dns.updateAll({endpoint:'192.0.2.2:25566',expected}),/HTTP 403/);assert.equal(writes,2);
});
