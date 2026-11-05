import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
import { fixture, login, headers, connect, gameFixture, playerId } from './helpers.js';
import { PERMISSIONS, PERMISSION_GROUPS, GAME_PERMISSIONS, gamePermissionsFor, filterDetail, legacyPermissions } from '../src/permissions.js';
import { loadConfig, saveRanks, validateRanks } from '../src/config.js';

test('explicit permissions override rank names and gate every tab and mutation before bridge dispatch',async()=>{
 const f=await fixture();try{
  const account=f.config.users.get('admin')!;
  account.permissions=['panel.access','tab.players','tab.notes','notes.edit'];
  const staff=await login(f),game=gameFixture();await connect(f,game.handler);
  const get=async(path:string)=>(await f.app.inject({url:'/api'+path,headers:headers(f,staff)}));
  const mutate=async(action:string,body:Record<string,unknown>)=>f.app.inject({method:'POST',url:'/api/players/'+playerId+'/'+action,headers:{...headers(f,staff),'x-request-id':randomUUID()},payload:body});
  const session=(await get('/session')).json();assert.deepEqual(session.permissions,account.permissions);
  const detail=(await get('/players/'+playerId)).json();assert('notes' in detail);for(const key of ['cases','punish','storage','tsa','ass','location','discord','teams','clockin','playtime'])assert(!(key in detail),key);
  assert(!('hasDetections' in (await get('/players')).json().players[0]));
  assert.equal((await get('/audit')).statusCode,403);assert.equal((await get('/access/ranks')).statusCode,403);
  assert.equal((await mutate('note-edit',{noteId:randomUUID(),text:'Only edit allowed'})).statusCode,200);
  for(const action of ['note-add','note-remove','revoke','remove-punishment'])assert.equal((await mutate(action,{})).statusCode,403,action);
  for(const type of ['WARN','KICK','MUTE','BAN','OFFENSE'])assert.equal((await mutate('punish',{type,reason:'Denied',durationMinutes:0})).statusCode,403,type);
  assert.equal(game.mutations,1);
  account.permissions=['panel.access','tab.players','tab.cases','punish.ban','punish.remove'];
  const narrow=await login(f);const post=async(action:string,body:Record<string,unknown>)=>f.app.inject({method:'POST',url:'/api/players/'+playerId+'/'+action,headers:{...headers(f,narrow),'x-request-id':randomUUID()},payload:body});
  assert.equal((await post('punish',{type:'BAN',reason:'Ban only',durationMinutes:0})).statusCode,200);
  assert.equal((await post('punish',{type:'WARN',reason:'No warn',durationMinutes:0})).statusCode,403);
  assert.equal((await post('remove-punishment',{recordId:2,reason:'Reviewed'})).statusCode,200);
  assert.equal((await post('revoke',{caseId:2,reason:'Denied'})).statusCode,403);
  assert.equal((await f.app.inject({method:'POST',url:'/api/icons',headers:headers(f,narrow),payload:{ids:[]}})).statusCode,403);
 }finally{await f.close();}
});

test('permission config round trips, rejects unknown grants, allows arbitrary rank managers, and blocks lockout',async()=>{
 const f=await fixture({discord:true});try{
  const ranks=[{name:'security-lead',discordRoleId:'12345678901234569',permissions:['panel.access','access.manage','tab.security']},{name:'blocked',discordRoleId:'12345678901234570',permissions:[]}];
  await saveRanks(f.config,ranks);
  const config=await loadConfig({DATA_DIR:f.dir,ADMIN_PANEL_BRIDGE_TOKEN:f.config.bridgeToken});
  assert.deepEqual(config.ranks.map(r=>r.permissions),ranks.map(r=>r.permissions));
  assert(!(await readFile(f.config.path,'utf8')).includes('.access='));
  assert.throws(()=>validateRanks([{...ranks[0],permissions:['*']}]),/Unknown permission/);
  assert.throws(()=>validateRanks([{...ranks[0],access:'admin',permissions:null}]),/Unknown permission/);
  assert.throws(()=>validateRanks([{...ranks[0],permissions:['access.manage']}]),/Keep a rank/);
  assert.deepEqual(validateRanks([{...ranks[0],access:'admin',permissions:[]}],false)[0]!.permissions,[],'empty explicit list never inherits admin');
 }finally{await f.close();}
 const local=await fixture();try{
  await appendFile(local.config.path,'\npermissions.admin=panel.access,tab.audit\n');
  const config=await loadConfig({DATA_DIR:local.dir,ADMIN_PANEL_BRIDGE_TOKEN:local.config.bridgeToken});
  assert.deepEqual(config.users.get('admin')!.permissions,['panel.access','tab.audit']);
  local.config.users.get('admin')!.permissions=[];
  await assert.rejects(login(local),/Invalid username/);
 }finally{await local.close();}
});

test('each data tab is independent and Java/TypeScript permission catalogs agree',async()=>{
 const raw={uuid:playerId,name:'TestPlayer',online:true,secret:'not an allowed field',location:{x:1},playtime:{},discord:{},teams:{},clockin:{},cases:[],punish:{},notes:[],notesAvailable:true,hasDetections:true,tsa:{},ass:{},storage:{source:'live',inventory:{},enderChest:{},curios:{}}};
 const groups:Record<string,string[]>={overview:['location','playtime','discord','teams','clockin'],cases:['cases','punish'],notes:['notes','notesAvailable'],security:['hasDetections','tsa','ass']};
 for(const [tab,keys] of Object.entries(groups))assert.deepEqual(Object.keys(filterDetail(raw,{permissions:['tab.'+tab]}) as object).sort(),['uuid','name','online',...keys].sort());
 for(const tab of ['inventory','enderChest','curios'])assert.deepEqual(Object.keys((filterDetail(raw,{permissions:['tab.'+tab]}) as any).storage).sort(),[tab,'source'].sort());
 const source=await readFile('../src/main/java/com/zaremate/admin_panel/Permissions.java','utf8');
 const catalog=source.split('ALL=Set.of(')[1]!.split(');')[0]!;
 assert.deepEqual([...catalog.matchAll(/"([^"]+)"/g)].map(m=>m[1]).sort(),[...PERMISSIONS].sort());
 assert(!legacyPermissions('viewer').includes('notes.edit'));
});

test('permission editor groups cover each grant exactly once',()=>{
 const keys=PERMISSION_GROUPS.flatMap(group=>group.keys);
 assert.equal(new Set(keys).size,keys.length);
 assert.deepEqual([...keys].sort(),[...PERMISSIONS].sort());
});

test('game bridge omits web-only grants while preserving TSA and player permissions',async()=>{
 const f=await fixture();try{
  const account=f.config.users.get('admin')!;
  account.permissions=['panel.access','tab.players','tab.notes','notes.edit','tab.tsaConfig','tsa.configure','tsa.lists.edit','tab.suggestions','suggestions.status','tab.todo','todo.create','tab.killFeed','killFeed.inventory'];
  const staff=await login(f),game=gameFixture();await connect(f,game.handler);
  assert.equal((await f.app.inject({url:'/api/players/'+playerId,headers:headers(f,staff)})).statusCode,200);
  assert.equal((await f.app.inject({url:'/api/tsa/lists',headers:headers(f,staff)})).statusCode,200);
  const expected:Record<string,string[]>={player:['panel.access','tab.players','tab.notes','notes.edit'],'tsa-lists':['panel.access','tab.tsaConfig','tsa.configure','tsa.lists.edit']};
  for(const operation of ['player','tsa-lists']){
   const sent=game.messages.find(message=>message.operation===operation);
   assert(sent,operation);
   assert.deepEqual([...sent.actor.permissions].sort(),[...expected[operation]!].sort());
  }
  assert(GAME_PERMISSIONS.has('tab.tsaConfig'));
  assert(!GAME_PERMISSIONS.has('suggestions.status'));
 }finally{await f.close();}
});


test('kill-feed grants never reach TSA or player requests against older mods',()=>{
 const actor=['panel.access','tab.players','tab.notes','notes.edit','tab.tsaConfig','tsa.configure','tsa.lists.edit','tab.killFeed','killFeed.inventory','suggestions.status'];
 assert.deepEqual(gamePermissionsFor('tsa-lists',actor),['panel.access','tab.tsaConfig','tsa.configure','tsa.lists.edit']);
 assert.deepEqual(gamePermissionsFor('tsa-setting-update',actor),['panel.access','tab.tsaConfig','tsa.configure','tsa.lists.edit']);
 assert.deepEqual(gamePermissionsFor('player',actor),['panel.access','tab.players','tab.notes','notes.edit']);
 assert.deepEqual(gamePermissionsFor('watch',actor),['panel.access','tab.players','tab.notes','notes.edit']);
 assert.deepEqual(gamePermissionsFor('kill-feed',actor),['panel.access','tab.killFeed','killFeed.inventory']);
 assert.deepEqual(gamePermissionsFor('tsa-lists',['tab.killFeed','killFeed.inventory']),[],'feature permissions must not grant TSA access');
});
