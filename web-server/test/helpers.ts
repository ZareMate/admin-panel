import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pbkdf2Sync, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { loadConfig, type Config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { token } from '../src/common.js';
import { batchFrames } from '../src/batches.js';
import { Bridge } from '../src/bridge.js';
export const playerId='00000000-0000-0000-0000-000000000001';
const salt='00112233445566778899aabbccddeeff';
const encoded=salt+':'+pbkdf2Sync('browser-test-password',Buffer.from(salt,'hex'),600000,32,'sha256').toString('hex');
export async function fixture(options:{discord?:boolean;fetcher?:typeof fetch;timeout?:number;secure?:boolean}={}) {
  const dir=await mkdtemp(join(tmpdir(),'panel-node-'));await mkdir(join(dir,'config'));
  const file=join(dir,'config/admin-panel.properties');
  await writeFile(file,`enabled=true\nbind=127.0.0.1\nport=0\norigin=http://localhost\nauth.mode=${options.discord?'discord':'local'}\n`+
    ['admin','moderator','viewer'].map(role=>`user.${role}=${role},${randomUUID()},${encoded}`).join('\n')+
    '\ndiscord.client-id=12345678901234567\ndiscord.client-secret=test-secret\ndiscord.guild-id=12345678901234568\ndiscord.rank-order=owner,mod,viewer\ndiscord.rank.owner.role-id=12345678901234569\ndiscord.rank.owner.access=admin\ndiscord.rank.mod.role-id=12345678901234570\ndiscord.rank.mod.access=moderator\ndiscord.rank.viewer.role-id=12345678901234571\ndiscord.rank.viewer.access=viewer\n');
  const config=await loadConfig({DATA_DIR:dir,ADMIN_PANEL_BRIDGE_TOKEN:token()});if(options.secure){config.origin='https://panel.example';config.secure=true;}
  const result=await createApp(config,{fetcher:options.fetcher,bridge:new Bridge(options.timeout),publicDir:resolve('dist/client')});
  const url=await result.app.listen({host:'127.0.0.1',port:0});if(!options.secure)config.origin=url;
  return {...result,config,url,dir,async close(){await result.app.close();await rm(dir,{recursive:true,force:true});}};
}
export type Fixture=Awaited<ReturnType<typeof fixture>>;
export async function login(f:Fixture,role='admin') {
  const response=await f.app.inject({method:'POST',url:'/api/login',headers:{host:new URL(f.config.origin).host,origin:f.config.origin,'content-type':'application/json'},payload:{username:role,password:'browser-test-password'}});
  if(response.statusCode!==200)throw new Error(response.body);
  const cookie=String(response.headers['set-cookie']).split(';')[0]!;
  const session=await f.app.inject({url:'/api/session',headers:{host:new URL(f.config.origin).host,cookie}});
  return {cookie,csrf:session.json().csrf as string};
}
export function headers(f:Fixture,staff?:{cookie:string;csrf:string}) {return {host:new URL(f.config.origin).host,origin:f.config.origin,'content-type':'application/json',...(staff?{cookie:staff.cookie,'x-csrf-token':staff.csrf}:{})};}
export async function connect(f:Fixture,onRequest?:(request:Record<string,any>,ws:WebSocket)=>void) {
  const ws=new WebSocket(f.url.replace('http','ws')+'/bridge',{headers:{Authorization:'Bearer '+f.config.bridgeToken,Host:new URL(f.config.origin).host}});
  ws.on('error',()=>{});
  if(onRequest)ws.on('message',data=>onRequest(JSON.parse(data.toString()),ws));
  await once(ws,'open');return ws;
}
export function gameFixture() {
  const detail:Record<string,any>={uuid:playerId,name:'TestPlayer',online:true,notesAvailable:true,notes:[],cases:[],punish:{available:true,offenses:[{id:'xray',name:'X-Ray',group:'Cheating',steps:['warn','ban']}]},tsa:{available:true,packetChecks:42,detections:['<img src=x onerror=window.xss=true>']},ass:{},teams:{},discord:{},clockin:{},
    location:{available:true,source:'live',dimension:'minecraft:overworld',x:1,y:64,z:2},playtime:{available:true,seconds:3700},
    storage:{source:'live',capturedAt:Date.now(),inventory:{available:true,groups:[{name:'Hotbar',slots:[{empty:false,label:'Hotbar 1',id:'test:gem',name:'<img src=x onerror=window.xss=true>',count:12,maxDamage:100,damage:5,enchantments:['Unbreaking 3'],lore:['A gem']},{empty:true,label:'Hotbar 2'}]}]},enderChest:{available:true,groups:[]},curios:{available:false,reason:'Curios unavailable'}}};
  const players={players:[{uuid:playerId,name:'TestPlayer',online:true,hasDetections:true},{uuid:'00000000-0000-0000-0000-000000000002',name:'OfflinePlayer',online:false}],serverPlayers:1,maxPlayers:20,punishAvailable:true};
  const watches=new Map<WebSocket,Map<string,Record<string,any>>>();
  const publish=()=>{for(const [ws,entries] of watches)if(ws.readyState===WebSocket.OPEN)for(const [watchId,request] of entries){
    const data=request.target==='players'?players:{...detail,uuid:request.player,notes:detail.notes.map((n:any)=>({...n,canEdit:n.author===request.actor.name}))};
    for(const frame of batchFrames(JSON.stringify({event:'snapshot',watchId,data}),randomUUID()))ws.send(frame);
  }};
  let mutations=0;const messages:Record<string,any>[]=[];
  return {detail,players,publish,messages,get mutations(){return mutations;},handler(request:Record<string,any>,ws:WebSocket){
    messages.push(request);let result:unknown;
    if(request.operation==='watch'){
      if(!watches.has(ws)){watches.set(ws,new Map());ws.on('close',()=>watches.delete(ws));}
      watches.get(ws)!.set(request.watchId,request);result={};
    }else if(request.operation==='unwatch'){watches.get(ws)?.delete(request.watchId);result={};}
    else if(request.operation==='players')result=players;
    else if(request.operation==='player')result=detail;
    else {
      if(request.action==='punish' && request.body.type!=='OFFENSE' && !Number.isSafeInteger(request.body.durationMinutes)) {ws.send(JSON.stringify({id:request.id,status:400,error:'durationMinutes must be an integer'}));return;}
      if(request.action==='revoke' && !Number.isSafeInteger(request.body.caseId)){ws.send(JSON.stringify({id:request.id,status:400,error:'caseId must be an integer'}));return;}
      if(request.action==='remove-punishment'){const record=detail.cases.find((c:any)=>c.id===request.body.recordId);if(!record||record.removedBy||record.offense){ws.send(JSON.stringify({id:request.id,status:409,error:'Punishment missing, removed, or part of an offense'}));return;}record.active=false;record.removedBy=request.actor.name;}
      mutations++;if(request.action==='note-add')detail.notes.push({id:randomUUID(),text:request.body.text,author:request.actor.name,canEdit:true,createdAt:Date.now()});if(request.action==='note-edit'){const n=detail.notes.find((n:any)=>n.id===request.body.noteId);if(n)n.text=request.body.text;}if(request.action==='note-remove')detail.notes=detail.notes.filter((n:any)=>n.id!==request.body.noteId);if(request.action==='punish')detail.cases.push({id:mutations,type:request.body.type.toLowerCase(),reason:request.body.reason,active:true,by:request.actor.name,at:Date.now()});result={status:'saved'};}
    for(const frame of batchFrames(JSON.stringify({id:request.id,result}),randomUUID()))ws.send(frame);
    if(request.operation==='watch'||request.operation==='mutate')publish();
  }};
}
