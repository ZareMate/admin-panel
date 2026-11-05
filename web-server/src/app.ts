import {TodoAssignees} from './todo-assignees.js';
import { MojangNames } from './mojang-names.js';
import { Skins } from './skins.js';
import { PlayerMap, mapDimension } from './player-map.js';
import { MinecraftLogin } from './minecraft-login.js';
import { Todos } from './todos.js';
import { TicketBridge } from './ticket-bridge.js';
import { Tickets } from './tickets.js';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Config, saveRanks } from './config.js';
import { Auth, type Session } from './auth.js';
import { Audit } from './audit.js';
import { Bridge } from './bridge.js';
import { Live } from './live.js';
import { Images, validItem } from './images.js';
import { Failure, equal, object, text, uuid, token } from './common.js';

import { SUGGESTION_STATUSES } from './suggestion-statuses.js';
import { has, mutationPermission, filterDetail, filterPlayers } from './permissions.js';
const requirePermission=(user:{permissions?:string[]},p:string)=>{if(!has(user,p))throw new Failure(403,'Permission required: '+p);};
declare module 'fastify' { interface FastifyRequest { panelSession?:Session } }
export async function createApp(config:Config, options:{bridge?:Bridge;fetcher?:typeof fetch;publicDir?:string;bundledDir?:string;logger?:boolean}={}) {
  const app=Fastify({bodyLimit:16_384,trustProxy:config.trustedProxies.length?config.trustedProxies:false,
    logger:options.logger ? {redact:['req.headers.authorization','req.headers.cookie','res.headers["set-cookie"]'],serializers:{req:(request:FastifyRequest)=>({method:request.method,url:request.url.split('?')[0]})}} : false,
    requestTimeout:30_000,routerOptions:{maxParamLength:200}});
  const auth=new Auth(config,options.fetcher),bridge=options.bridge||new Bridge(),audit=new Audit(resolve(config.dataDir,'logs/admin-panel-audit.jsonl'));
  await audit.load();
  const images=new Images(resolve(config.dataDir,'assets'),options.bundledDir||resolve('public'));await images.init();
  const mojangNames=new MojangNames(options.fetcher,Date.now,resolve(config.dataDir,'cache/mojang-names.json'));await mojangNames.init();
  const nameJobs=new Set<Promise<unknown>>();
  const nameSnapshot=<T,>(data:T):T=>{
    const snapshot=mojangNames.snapshot(data);
    const job=mojangNames.enrich(data).catch(()=>app.log.warn('Background player name resolution unavailable')).finally(()=>nameJobs.delete(job));
    nameJobs.add(job);
    return snapshot;
  };
  const skins=new Skins(resolve(config.dataDir,'cache/skins/mineskin-v1'),options.fetcher,Date.now,mojangNames,fields=>app.log.warn(fields,'Skin image lookup failed'));await skins.init();
  const tickets=new Tickets(),ticketBridge=new TicketBridge(),todos=new Todos(resolve(config.dataDir,'todos.json'));await todos.load();
  const todoAssignees=new TodoAssignees(config,ticketBridge);
  const playerMap=new PlayerMap(resolve(config.dataDir,'map'));
  const minecraftLogin=new MinecraftLogin(config,ticketBridge,Date.now,(level,event,fields)=>app.log[level]({...fields,event},event));
  const requests=new Map<string,number>();let savingRanks=false,iconJobs=0;
  await app.register(cookie);
  await app.register(websocket,{options:{maxPayload:65536,perMessageDeflate:false}});
  const live=new Live(bridge,auth,mojangNames);
  app.addHook('preClose',async()=>{playerMap.close();live.close();bridge.close();ticketBridge.close();await skins.close();await Promise.allSettled(nameJobs);});
  skins.startRetries();
  const sessionCookie={path:'/',httpOnly:true,sameSite:'strict' as const,secure:config.secure,maxAge:28800};
  const oauthCookie={path:'/api/auth/discord',httpOnly:true,sameSite:'lax' as const,secure:config.secure,maxAge:300};
  const publicRoutes=new Set(['/api/login','/api/auth/method','/api/auth/discord/start','/api/auth/discord/callback','/api/auth/minecraft/redeem']);
  app.addHook('onRequest',async(req,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer')
      .header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cdn.discordapp.com https://media.discordapp.net https://images-ext-1.discordapp.net https://images-ext-2.discordapp.net; media-src 'self' https://cdn.discordapp.com https://media.discordapp.net https://images-ext-1.discordapp.net https://images-ext-2.discordapp.net; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(config.secure)reply.header('Strict-Transport-Security','max-age=31536000');
    if(req.host.toLowerCase()!==new URL(config.origin).host.toLowerCase())throw new Failure(403,'Unrecognized host');
    if(!['GET','POST','HEAD'].includes(req.method))throw new Failure(405,'Method not allowed');
    const path=req.url.split('?')[0]!;
    if(path==='/tickets-sync'||path==='/tickets-commands') {
      if(!config.ticketSyncToken||!equal(String(req.headers.authorization||''),'Bearer '+config.ticketSyncToken))throw new Failure(401,'Ticket sync authentication rejected');
      if(req.method!=='GET'||req.headers.upgrade?.toLowerCase()!=='websocket')throw new Failure(405,'WebSocket upgrade required');
      return;
    }
    if(path==='/api/auth/minecraft/issue') {
      if(!equal(String(req.headers.authorization||''),'Bearer '+config.bridgeToken))throw new Failure(401,'Bridge authentication rejected');
      if(req.method!=='POST')throw new Failure(405,'POST required');
      if(req.headers['content-type']?.split(';')[0]?.toLowerCase()!=='application/json')throw new Failure(415,'JSON required');
      return;
    }
    if(req.method==='POST') {
      if(req.headers.origin!==config.origin)throw new Failure(403,'Origin rejected');
      if(req.headers['content-type']?.split(';')[0]?.toLowerCase()!=='application/json')throw new Failure(415,'JSON required');
    }
    if(path==='/api/live' && req.headers.origin!==config.origin)throw new Failure(403,'Origin rejected');
    if(path==='/bridge') {
      if(!equal(String(req.headers.authorization||''),'Bearer '+config.bridgeToken))throw new Failure(401,'Bridge authentication rejected');
      return;
    }
    if(path.startsWith('/api/')&&!publicRoutes.has(path)) {
      const session=auth.get(req.cookies.panel_session||'');
      if(!session)throw new Failure(401,'Please sign in');
      req.panelSession=session;
      if(req.method==='POST'&&!equal(String(req.headers['x-csrf-token']||''),session.csrf))throw new Failure(403,'Invalid CSRF token');
    }
  });
  app.setErrorHandler((error,req,reply)=>{
    const err=error as Error & {statusCode?:number};const status=err.statusCode&&err.statusCode>=400&&err.statusCode<=599?err.statusCode:500;
    if(req.url.split('?')[0]?.startsWith('/api/auth/minecraft/'))req.log.warn({event:'minecraft_login_http_failed',requestId:req.id,status,reason:error instanceof Failure?(error.code||'request-rejected'):'internal-error'},'Minecraft login HTTP request failed');
    if(status===500)req.log.error({name:err.name},'Request failed');
    reply.code(status).send({error:status===500?'Request failed. Check player history and audit before retrying.':err.message});
  });
  app.get('/api/todos',async req=>{const user=req.panelSession!.user;requirePermission(user,'tab.todo');return {tasks:todos.list(),mine:todos.mine(user.discordId)};});
  app.get('/api/todos/mine',async req=>{const user=req.panelSession!.user;requirePermission(user,'tab.todo');return todos.mine(user.discordId);});
  app.get('/api/todos/assignees',async req=>{requirePermission(req.panelSession!.user,'tab.todo');return {assignees:await todoAssignees.list()};});
  app.post('/api/todos',async req=>{const user=req.panelSession!.user;requirePermission(user,'tab.todo');requirePermission(user,'todo.create');const result=await todos.mutate(user.name,await todoAssignees.input(req.body));await audit.write(user.name,'todo-create','','success',result);return result;});
  app.post<{Params:{id:string;action:string}}>('/api/todos/:id/:action',async req=>{
    const user=req.panelSession!.user,action=req.params.action;if(!['edit','delete'].includes(action))throw new Failure(404,'Not found');requirePermission(user,'tab.todo');requirePermission(user,'todo.'+action);
    const id=uuid(req.params.id),body=action==='delete'?req.body:await todoAssignees.input(req.body,todos.list().find(task=>task.id===id));
    const result=await todos.mutate(user.name,body,id,action==='delete');await audit.write(user.name,'todo-'+action,req.params.id,'success',result);return result;
  });
  app.get<{Querystring:{archived?:string;cursor?:string;tags?:string;untagged?:string;q?:string}}>('/api/suggestions',async req=>{
    requirePermission(req.panelSession!.user,'tab.suggestions');
    if(req.query.archived!==undefined&&!['true','false'].includes(req.query.archived))throw new Failure(400,'Invalid archive filter');
    if(req.query.cursor!==undefined&&!/^[0-9]{1,16}$/.test(req.query.cursor))throw new Failure(400,'Invalid cursor');
    if(req.query.untagged!==undefined&&!['true','false'].includes(req.query.untagged))throw new Failure(400,'Invalid untagged filter');
    if(req.query.q!==undefined&&(typeof req.query.q!=='string'||req.query.q.length>160))throw new Failure(400,'Search query is too long');
    const tags=req.query.tags?req.query.tags.split(','):[];
    if(req.query.untagged==='true'&&tags.length>0||tags.length>20||!tags.every(id=>/^[1-9][0-9]{16,19}$/.test(id))||new Set(tags).size!==tags.length)throw new Failure(400,'Invalid tag filters');
    const result=await ticketBridge.request({action:'suggestions-list',archived:req.query.archived==='true',cursor:req.query.cursor,tags,untagged:req.query.untagged==='true',query:req.query.q?.trim()||undefined}) as {messages:unknown[];hasMore:boolean};
    return {meta:result.messages[0],threads:result.messages.slice(1),hasMore:result.hasMore};
  });
  app.get<{Params:{id:string};Querystring:{before?:string}}>('/api/suggestions/:id/messages',async req=>{
    requirePermission(req.panelSession!.user,'tab.suggestions');
    if(!/^[1-9][0-9]{16,19}$/.test(req.params.id)||req.query.before!==undefined&&!/^[1-9][0-9]{16,19}$/.test(req.query.before))throw new Failure(400,'Invalid thread or message ID');
    return ticketBridge.request({action:'suggestions-history',channel:req.params.id,before:req.query.before});
  });
  app.post<{Params:{id:string}}>('/api/suggestions/:id/tags',async req=>{
    const user=req.panelSession!.user;requirePermission(user,'tab.suggestions');requirePermission(user,'suggestions.tags');
    const b=object(req.body),valid=(v:unknown)=>Array.isArray(v)&&v.length<=5&&v.every(id=>typeof id==='string'&&/^[1-9][0-9]{16,19}$/.test(id))&&new Set(v).size===v.length;
    if(!/^[1-9][0-9]{16,19}$/.test(req.params.id)||!valid(b.tags)||!valid(b.expected))throw new Failure(400,'Provide up to five unique tag IDs and current tags');
    await audit.write(user.name,'suggestion-tags',req.params.id,'requested',{tags:b.tags});
    try{const result=await ticketBridge.request({action:'suggestions-tags',channel:req.params.id,tags:b.tags,expected:b.expected,actor:user.name});await audit.write(user.name,'suggestion-tags',req.params.id,'success',{tags:b.tags});return result;}
    catch(error){await audit.write(user.name,'suggestion-tags',req.params.id,'failed-or-unconfirmed',{});throw error;}
  });
  const claimRequest=(req:FastifyRequest,prefix:string)=>{
    const requestId=req.headers['x-request-id'];
    if(typeof requestId!=='string'||! /^[a-f0-9-]{36}$/.test(requestId))throw new Failure(400,'Request ID required');
    for(const [key,expiry] of requests)if(expiry<=Date.now())requests.delete(key);
    const key=prefix+':'+req.cookies.panel_session+':'+requestId;
    if(requests.has(key))throw new Failure(409,'This request was already submitted. Refresh suggestions before retrying.');
    if(requests.size>=10000)throw new Failure(503,'Request capacity reached');requests.set(key,req.panelSession!.expires);
    return requestId;
  };
  const SNOWFLAKE=/^[1-9][0-9]{16,19}$/;
  app.post('/api/suggestions',async req=>{
    const user=req.panelSession!.user;requirePermission(user,'tab.suggestions');requirePermission(user,'suggestions.create');
    const b=object(req.body),title=text(b.title,100,'Title'),content=text(b.content,1700,'Suggestion'),requestId=claimRequest(req,'suggestion-create');
    await audit.write(user.name,'suggestion-create','','requested',{requestId,title});
    try{const result=await ticketBridge.request({action:'suggestions-create',title,content,actor:user.name,rank:user.rank}) as {messages:{id?:string}[]};await audit.write(user.name,'suggestion-create',result.messages[0]?.id??'','success',{requestId,title});return result;}
    catch(error){await audit.write(user.name,'suggestion-create','','failed-or-unconfirmed',{requestId,title});throw error;}
  });
  app.post<{Params:{id:string}}>('/api/suggestions/:id/status',async req=>{
    const user=req.panelSession!.user;requirePermission(user,'tab.suggestions');requirePermission(user,'suggestions.status');
    const b=object(req.body),status=SUGGESTION_STATUSES.find(s=>s===b.status),known=(v:unknown)=>v===undefined||v===null||SUGGESTION_STATUSES.some(s=>s===v);
    if(!SNOWFLAKE.test(req.params.id)||!status||!known(b.expected))throw new Failure(400,'Choose one of the listed statuses');
    await audit.write(user.name,'suggestion-status',req.params.id,'requested',{status});
    try{const result=await ticketBridge.request({action:'suggestions-status',channel:req.params.id,status,expected:b.expected,actor:user.name,rank:user.rank});await audit.write(user.name,'suggestion-status',req.params.id,'success',{status});return result;}
    catch(error){await audit.write(user.name,'suggestion-status',req.params.id,'failed-or-unconfirmed',{status});throw error;}
  });
  app.post<{Params:{id:string}}>('/api/suggestions/:id/delete',async req=>{
    const user=req.panelSession!.user;requirePermission(user,'tab.suggestions');requirePermission(user,'suggestions.delete');
    if(!SNOWFLAKE.test(req.params.id))throw new Failure(400,'Invalid thread ID');
    await audit.write(user.name,'suggestion-delete',req.params.id,'requested',{});
    try{const result=await ticketBridge.request({action:'suggestions-delete',channel:req.params.id,actor:user.name,rank:user.rank});await audit.write(user.name,'suggestion-delete',req.params.id,'success',{});return result;}
    catch(error){await audit.write(user.name,'suggestion-delete',req.params.id,'failed-or-unconfirmed',{});throw error;}
  });
  app.get('/tickets-commands',{websocket:true},socket=>ticketBridge.attach(socket));
  app.get<{Params:{id:string};Querystring:{before?:string}}>('/api/tickets/:id/messages',async req=>{
    const ticket=tickets.authorize(req.panelSession!.user,req.params.id),before=req.query.before;
    if(before!==undefined&&!/^[1-9][0-9]{16,19}$/.test(before))throw new Failure(400,'Invalid message cursor');
    return ticketBridge.request({action:'history',channel:ticket.id,category:ticket.category,before});
  });
  app.post<{Params:{id:string}}>('/api/tickets/:id/reply',async req=>{
    const {user,expires}=req.panelSession!,ticket=tickets.authorize(user,req.params.id);
    requirePermission(user,'tickets.reply');
    const content=text(object(req.body).content,1800,'Reply'),requestId=req.headers['x-request-id'];
    if(typeof requestId!=='string'||! /^[a-f0-9-]{36}$/.test(requestId))throw new Failure(400,'Request ID required');
    for(const [key,expiry] of requests)if(expiry<=Date.now())requests.delete(key);
    const key='ticket:'+req.cookies.panel_session+':'+requestId;
    if(requests.has(key))throw new Failure(409,'Reply already submitted. Refresh the conversation before retrying.');
    if(requests.size>=10000)throw new Failure(503,'Request capacity reached');requests.set(key,expires);
    await audit.write(user.name,'ticket-reply',ticket.id,'requested',{requestId});
    try{const result=await ticketBridge.request({action:'reply',channel:ticket.id,category:ticket.category,content,actor:user.name,rank:user.rank,requestId});await audit.write(user.name,'ticket-reply',ticket.id,'success',{requestId});return result;}
    catch(error){await audit.write(user.name,'ticket-reply',ticket.id,'failed-or-unconfirmed',{requestId});throw error;}
  });
  app.post<{Params:{id:string}}>('/api/suggestions/:id/reply',async req=>{
    const {user,expires}=req.panelSession!;requirePermission(user,'tab.suggestions');
    if(!/^[1-9][0-9]{16,19}$/.test(req.params.id))throw new Failure(400,'Invalid thread ID');
    const ticket={id:req.params.id};
    requirePermission(user,'suggestions.reply');
    const content=text(object(req.body).content,1800,'Reply'),requestId=req.headers['x-request-id'];
    if(typeof requestId!=='string'||! /^[a-f0-9-]{36}$/.test(requestId))throw new Failure(400,'Request ID required');
    for(const [key,expiry] of requests)if(expiry<=Date.now())requests.delete(key);
    const key='suggestion:'+req.cookies.panel_session+':'+requestId;
    if(requests.has(key))throw new Failure(409,'Reply already submitted. Refresh the conversation before retrying.');
    if(requests.size>=10000)throw new Failure(503,'Request capacity reached');requests.set(key,expires);
    await audit.write(user.name,'suggestion-reply',ticket.id,'requested',{requestId});
    try{const result=await ticketBridge.request({action:'suggestions-reply',channel:ticket.id,content,actor:user.name,rank:user.rank,requestId});await audit.write(user.name,'suggestion-reply',ticket.id,'success',{requestId});return result;}
    catch(error){await audit.write(user.name,'suggestion-reply',ticket.id,'failed-or-unconfirmed',{requestId});throw error;}
  });
  app.get('/tickets-sync',{websocket:true},socket=>{
    socket.on('message',(data,binary)=>{
      try {
        if(binary||Buffer.byteLength(data.toString())>16384)throw new Error('Invalid frame');
        const batch=JSON.parse(data.toString());tickets.accept(batch);
        socket.send(JSON.stringify({ok:true,snapshot:batch.snapshot,index:batch.index}));
      }catch{socket.close(1008,'Invalid ticket batch');}
    });
  });
  app.get('/api/tickets/counts',async req=>{const counts=tickets.list(req.panelSession!.user,undefined,0).counts;return {counts,total:Object.values(counts).reduce((sum,count)=>sum+count,0)};});
  app.get<{Querystring:{category?:string;offset?:string}}>('/api/tickets',async req=>tickets.list(req.panelSession!.user,req.query.category,req.query.offset));
  app.get('/bridge',{websocket:true},socket=>bridge.attach(socket));
  app.get('/api/live',{websocket:true},(socket,req)=>live.attach(socket,req.cookies.panel_session||''));
  app.get('/api/auth/method',async()=>({mode:config.mode}));
  app.post('/api/auth/minecraft/issue',async req=>{auth.allowLogin('minecraft-issue:'+uuid(object(req.body).minecraftUuid));return minecraftLogin.issue(req.body);});
  app.post('/api/auth/minecraft/redeem',async(req,reply)=>{
    auth.allowLogin(req.ip);const old=req.cookies.panel_session||'';auth.logout(old);live.revoke(old);reply.clearCookie('panel_session',sessionCookie);
    const user=await minecraftLogin.redeem(object(req.body).ticket);
    await audit.write(user.name,'minecraft-login',user.uuid,'success',{discordId:user.discordId});
    const id=auth.create(user);reply.setCookie('panel_session',id,sessionCookie);req.log.info({event:'minecraft_login_session_created',minecraftUuid:user.uuid,discordId:user.discordId,rank:user.rank},'Minecraft login session created');return {};
  });
  app.post('/api/login',async(req,reply)=>{
    if(config.mode!=='local')throw new Failure(403,'Password login is disabled. Sign in with Discord.');
    auth.allowLogin(req.ip);const body=object(req.body),user=await auth.authenticate(text(body.username,32),text(body.password,256));
    if(!user)throw new Failure(401,'Invalid username or password');
    await audit.write(user.name,'login','','success',{});auth.logout(req.cookies.panel_session||'');reply.setCookie('panel_session',auth.create(user),sessionCookie);return {};
  });
  app.get('/api/auth/discord/start',async(req,reply)=>{
    if(config.mode!=='discord')throw new Failure(404,'Not found');auth.allowLogin(req.ip);const start=auth.start();reply.setCookie('panel_oauth',start.browser,oauthCookie);return reply.redirect(start.location);
  });
  app.get('/api/auth/discord/callback',async(req,reply)=>{
    if(config.mode!=='discord')throw new Failure(404,'Not found');
    try {
      const query=object(req.query);if(req.url.length>8192)throw new Failure(400,'OAuth query too large');
      const login=await auth.finish(text(query.state,128),req.cookies.panel_oauth||'',query.code,'error' in query);
      await audit.write(login.user.name,'discord-login','','success',{});auth.logout(req.cookies.panel_session||'');
      reply.setCookie('panel_session',auth.create(login.user,login.expires),sessionCookie).clearCookie('panel_oauth',oauthCookie);return reply.redirect('/');
    }catch(error){reply.clearCookie('panel_oauth',oauthCookie);return reply.redirect('/?loginError='+encodeURIComponent(error instanceof Failure?error.message:'Discord sign-in failed. Try again.'));}
  });
  app.get('/api/session',async req=>{const s=req.panelSession!;return {name:s.user.name,discordId:s.user.discordId,rank:s.user.rank,permissions:s.user.permissions||[],csrf:s.csrf};});
  app.post('/api/logout',async(req,reply)=>{auth.logout(req.cookies.panel_session||'');live.revoke(req.cookies.panel_session||'');reply.clearCookie('panel_session',sessionCookie);return {};});
  app.post('/api/tsa/names',async req=>{
    const user=req.panelSession!.user;requirePermission(user,'tab.tsaConfig');
    const hashes=object(req.body).hashes;
    if(!Array.isArray(hashes)||hashes.length>50||hashes.some(hash=>typeof hash!=='string'||!/^[a-fA-F0-9]{64}$/.test(hash)))throw new Failure(400,'Expected up to 50 SHA-256 hashes');
    return bridge.call('tsa-names',{actor:user,hashes});
  });
  app.get('/api/tsa/unlisted',async req=>{
    const user=req.panelSession!.user;requirePermission(user,'tab.tsaConfig');
    return bridge.call('tsa-unlisted',{actor:user});
  });
  app.get('/api/tsa/lists',async req=>{
    const user=req.panelSession!.user;requirePermission(user,'tab.tsaConfig');
    return bridge.call('tsa-lists',{actor:user});
  });
  app.post('/api/tsa/lists',async req=>{
    const user=req.panelSession!.user;requirePermission(user,'tab.tsaConfig');requirePermission(user,'tsa.lists.edit');
    const body=object(req.body),list=text(body.list,32,'List'),action=text(body.action,8,'Action');
    if(!['ALLOWED','BLACKLISTED','ENFORCEMENT','FILENAMES'].includes(list)||!['add','remove'].includes(action))throw new Failure(400,'Invalid list operation');
    const entry:Record<string,unknown>={list,action};
    if(list==='FILENAMES')entry.name=text(body.name,1024,'Filename');
    if(list!=='FILENAMES'){const hash=text(body.hash,64,'Hash').trim().toLowerCase();if(!/^[a-f0-9]{64}$/.test(hash))throw new Failure(400,'Expected a 64 character SHA-256 hash');entry.hash=hash;}
    await audit.write(user.name,'tsa-list-'+action,list,'requested',entry);
    try{const result=await bridge.call('tsa-list-update',{actor:user,body:entry});await audit.write(user.name,'tsa-list-'+action,list,'success',entry);return result;}
    catch(error){await audit.write(user.name,'tsa-list-'+action,list,'failed-or-unconfirmed',entry);throw error;}
  });
  app.get('/api/tsa/settings',async req=>{
    const user=req.panelSession!.user;requirePermission(user,'tab.tsaConfig');
    return bridge.call('tsa-settings',{actor:user});
  });
  app.post('/api/tsa/settings',async req=>{
    const user=req.panelSession!.user;requirePermission(user,'tab.tsaConfig');requirePermission(user,'tsa.configure');
    const body=object(req.body),setting=text(body.setting,80,'Setting');
    if(!/^[A-Z_]+$/.test(setting)||!('value' in body))throw new Failure(400,'Invalid setting');
    await audit.write(user.name,'tsa-setting-update',setting,'requested',{});
    try {const result=await bridge.call('tsa-setting-update',{actor:user,body:{setting,value:body.value}});await audit.write(user.name,'tsa-setting-update',setting,'success',{});return result;}
    catch(error){await audit.write(user.name,'tsa-setting-update',setting,'failed-or-unconfirmed',{});throw error;}
  });
  app.get<{Querystring:{q?:string;offset?:string;limit?:string}}>('/api/kill-feed',async req=>{
    const user=req.panelSession!.user;requirePermission(user,'tab.killFeed');
    const offset=Number(req.query.offset??0),limit=Number(req.query.limit??25),query=req.query.q??'';
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50||query.length>128)throw new Failure(400,'Invalid kill-feed page');
    const data=await bridge.call('kill-feed',{actor:user,query,offset,limit}) as {entries:Record<string,unknown>[]};
    return nameSnapshot({...data,entries:data.entries.map(entry=>{const copy={...entry};delete copy.inventory;return copy;})});
  });
  app.get<{Params:{id:string}}>('/api/kill-feed/:id',async req=>{
    const user=req.panelSession!.user;requirePermission(user,'tab.killFeed');
    const data=await bridge.call('kill-feed',{actor:user,entry:uuid(req.params.id)}) as Record<string,unknown>;
    const copy={...data};if(!has(user,'killFeed.inventory'))delete copy.inventory;return nameSnapshot(copy);
  });
  app.get<{Querystring:{offline?:string}}>('/api/map/players',async req=>{
    requirePermission(req.panelSession!.user,'tab.map');
    if(req.query.offline!==undefined&&!['true','false'].includes(req.query.offline))throw new Failure(400,'Invalid offline player option');
    return nameSnapshot(await bridge.call('map-players',{includeOffline:req.query.offline==='true'}));
  });
  app.get<{Querystring:{dimension?:string}}>('/api/map/claims',async req=>{requirePermission(req.panelSession!.user,'tab.map');return bridge.call('map-claims',{dimension:mapDimension(req.query.dimension||'minecraft:overworld')});});
  app.get<{Querystring:{dimension?:string}}>('/api/map/regions',async req=>{
    requirePermission(req.panelSession!.user,'tab.map');return playerMap.regions(mapDimension(req.query.dimension||'minecraft:overworld'));
  });
  app.get<{Params:{region:string};Querystring:{dimension?:string}}>('/api/map/tiles/:region',async(req,reply)=>{
    requirePermission(req.panelSession!.user,'tab.map');
    return reply.type('image/png').send(await playerMap.tile(req.query.dimension||'minecraft:overworld',req.params.region));
  });
  app.post('/api/map/import',{bodyLimit:29*1024*1024},async req=>{
    const user=req.panelSession!.user;requirePermission(user,'tab.map');requirePermission(user,'map.upload');
    const body=object(req.body),dimension=mapDimension(body.dimension);
    const result=await playerMap.import(dimension,text(body.filename,128,'Filename'),body.data);
    await audit.write(user.name,'map-import',dimension+'/'+result.region.name,'success',{regions:result.regions,merged:result.merged,chunks:result.chunks});return result;
  });
  app.post('/api/map/remove',async req=>{
    const user=req.panelSession!.user;requirePermission(user,'tab.map');requirePermission(user,'map.remove');
    const body=object(req.body),dimension=mapDimension(body.dimension),region=text(body.region,32,'Region');
    const result=await playerMap.remove(dimension,region);await audit.write(user.name,'map-remove',dimension+'/'+region,'success',{});return result;
  });
  app.get('/api/stats',async req=>{
    requirePermission(req.panelSession!.user,'tab.stats');
    return bridge.call('stats');
  });
  app.get('/api/player-ranks',async req=>{
    requirePermission(req.panelSession!.user,'tab.players');
    const data=await bridge.players() as {players:{uuid:string;discordId?:string}[]};
    const staff=await todoAssignees.list(true),byId=new Map(staff.map(person=>[person.id,person.rank]));
    return {ranks:config.ranks.filter(rank=>has(rank,'panel.access')).map(rank=>rank.name),players:data.players.map(player=>({uuid:player.uuid,rank:player.discordId===undefined?undefined:byId.get(player.discordId)??null}))};
  });
  app.get('/api/players',async req=>{requirePermission(req.panelSession!.user,'tab.players');return nameSnapshot(filterPlayers(await bridge.players(),req.panelSession!.user));});
  app.get<{Params:{id:string}}>('/api/players/:id',async req=>{const user=req.panelSession!.user;requirePermission(user,'tab.players');return nameSnapshot(filterDetail(await bridge.player(uuid(req.params.id),user),user));});
  app.post<{Params:{id:string;action:string}}>('/api/players/:id/:action',async req=>{
    const id=uuid(req.params.id),{action}=req.params,{user,expires}=req.panelSession!,body=object(req.body);
    if(!['punish','revoke','remove-punishment','note-add','note-edit','note-remove'].includes(action))throw new Failure(404,'Not found');
    requirePermission(user,'tab.players');requirePermission(user,action.startsWith('note-')?'tab.notes':'tab.cases');
    requirePermission(user,mutationPermission(action,body));
    const requestId=req.headers['x-request-id'];if(typeof requestId!=='string'||! /^[a-zA-Z0-9-]{16,80}$/.test(requestId))throw new Failure(400,'Request ID required');
    for(const [key,expiry] of requests)if(expiry<=Date.now())requests.delete(key);
    const key=req.cookies.panel_session+':'+requestId;
    if(requests.has(key))throw new Failure(409,'This request was already submitted. Inspect player history and audit before retrying.');
    if(requests.size>=10000)throw new Failure(503,'Mutation capacity reached');requests.set(key,expires);body.requestId=requestId;
    await audit.write(user.name,action,id,'requested',body);
    try {const result=await bridge.mutate(id,user,action,body);await audit.write(user.name,action,id,'success',result);return result;}
    catch(error){await audit.write(user.name,action,id,'failed-or-unconfirmed',{requestId,error:error instanceof Error?error.message:'Unknown outcome'});throw error;}
  });
  app.get('/api/audit',async req=>{requirePermission(req.panelSession!.user,'tab.audit');return audit.recent();});
  const manager=(req:FastifyRequest)=>{const user=req.panelSession!.user;if(config.mode!=='discord'||!has(user,'access.manage'))throw new Failure(403,'Discord rank management requires access.manage');};
  app.get('/api/access/ranks',async req=>{manager(req);return {ranks:config.ranks};});
  app.post('/api/access/ranks',async req=>{
    manager(req);if(savingRanks)throw new Failure(409,'Rank configuration is being saved');savingRanks=true;
    try {await saveRanks(config,object(req.body).ranks);auth.reloadPermissions();live.permissionsChanged();await audit.write(req.panelSession!.user.name,'access-ranks-update','','success',{});return {restartRequired:false};}finally{savingRanks=false;}
  });
  app.post('/api/icons',async req=>{
    if(!has(req.panelSession!.user,'tab.killFeed')&&!['inventory','enderChest','curios'].some(k=>has(req.panelSession!.user,'tab.'+k)))throw new Failure(403,'Storage permission required');
    const ids=object(req.body).ids;if(!Array.isArray(ids)||ids.length>128||!ids.every(validItem))throw new Failure(400,'Expected at most 128 valid item IDs');
    if(iconJobs>=2)throw new Failure(503,'Icon service busy');iconJobs++;try{return await images.icons(ids as string[]);}finally{iconJobs--;}
  });
  app.get<{Params:{kind:string;name:string}}>('/api/skin/:kind/:name',async(req,reply)=>{
    const user=req.panelSession!.user;
    if(!(req.params.kind==='head'&&(has(user,'tab.map')||has(user,'tab.killFeed'))))requirePermission(user,'tab.players');
    const skin=await skins.get(req.params.kind,req.params.name);return reply.header('Cache-Control','private, max-age='+Math.max(0,Math.floor((skin.expires-Date.now())/1000))).type('image/png').send(skin.bytes);
  });
  const publicDir=options.publicDir||resolve('dist/client');
  const index=await readFile(resolve(publicDir,'index.html'));
  app.get('/',async(_req,reply)=>{
    const nonce=token();
    const policy=String(reply.getHeader('Content-Security-Policy'));
    reply.header('Content-Security-Policy',policy.replace("style-src 'self'",`style-src 'self' 'nonce-${nonce}'`));
    return reply.type('text/html; charset=utf-8').send(index.toString('utf8').replace('<head>',`<head><meta name="style-nonce" content="${nonce}">`));
  });
  for(const file of await readdir(resolve(publicDir,'assets')).catch(()=>[])) {
    if(!/^[a-zA-Z0-9_.-]+\.(js|css)$/.test(file))continue;
    const data=await readFile(resolve(publicDir,'assets',file));
    app.get('/assets/'+file,async(_req,reply)=>reply.type(file.endsWith('.css')?'text/css':'text/javascript').send(data));
  }
  app.setNotFoundHandler((_req,reply)=>reply.code(404).send({error:'Not found'}));
  return {app,bridge,auth,audit};
}
