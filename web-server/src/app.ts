import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Config, saveRanks } from './config.js';
import { Auth, type Session } from './auth.js';
import { Audit } from './audit.js';
import { Bridge } from './bridge.js';
import { Images, validItem } from './images.js';
import { Failure, equal, object, text, uuid, canModerate } from './common.js';

declare module 'fastify' { interface FastifyRequest { panelSession?:Session } }
export async function createApp(config:Config, options:{bridge?:Bridge;fetcher?:typeof fetch;publicDir?:string;bundledDir?:string;logger?:boolean}={}) {
  const app=Fastify({bodyLimit:16_384,trustProxy:config.trustedProxies.length?config.trustedProxies:false,
    logger:options.logger ? {redact:['req.headers.authorization','req.headers.cookie','res.headers["set-cookie"]'],serializers:{req:(request:FastifyRequest)=>({method:request.method,url:request.url.split('?')[0]})}} : false,
    requestTimeout:30_000,routerOptions:{maxParamLength:200}});
  const auth=new Auth(config,options.fetcher),bridge=options.bridge||new Bridge(),audit=new Audit(resolve(config.dataDir,'logs/admin-panel-audit.jsonl'));
  await audit.load();
  const images=new Images(resolve(config.dataDir,'assets'),options.bundledDir||resolve('public'),options.fetcher);await images.init();
  const requests=new Map<string,number>();let savingRanks=false,iconJobs=0;
  await app.register(cookie);
  await app.register(websocket,{options:{maxPayload:8*1024*1024,perMessageDeflate:false}});
  app.addHook('preClose',async()=>{bridge.close();});
  const sessionCookie={path:'/',httpOnly:true,sameSite:'strict' as const,secure:config.secure,maxAge:28800};
  const oauthCookie={path:'/api/auth/discord',httpOnly:true,sameSite:'lax' as const,secure:config.secure,maxAge:300};
  const publicRoutes=new Set(['/api/login','/api/auth/method','/api/auth/discord/start','/api/auth/discord/callback']);
  app.addHook('onRequest',async(req,reply)=>{
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer')
      .header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(config.secure)reply.header('Strict-Transport-Security','max-age=31536000');
    if(req.host.toLowerCase()!==new URL(config.origin).host.toLowerCase())throw new Failure(403,'Unrecognized host');
    if(!['GET','POST','HEAD'].includes(req.method))throw new Failure(405,'Method not allowed');
    if(req.method==='POST') {
      if(req.headers.origin!==config.origin)throw new Failure(403,'Origin rejected');
      if(req.headers['content-type']?.split(';')[0]?.toLowerCase()!=='application/json')throw new Failure(415,'JSON required');
    }
    const path=req.url.split('?')[0]!;
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
    if(status===500)req.log.error({name:err.name},'Request failed');
    reply.code(status).send({error:status===500?'Request failed. Check player history and audit before retrying.':err.message});
  });
  app.get('/bridge',{websocket:true},socket=>bridge.attach(socket));
  app.get('/api/auth/method',async()=>({mode:config.mode}));
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
  app.get('/api/session',async req=>{const s=req.panelSession!;return {name:s.user.name,role:s.user.role,rank:s.user.rank,csrf:s.csrf};});
  app.post('/api/logout',async(req,reply)=>{auth.logout(req.cookies.panel_session||'');reply.clearCookie('panel_session',sessionCookie);return {};});
  app.get('/api/players',async()=>bridge.players());
  app.get<{Params:{id:string}}>('/api/players/:id',async req=>bridge.player(uuid(req.params.id),req.panelSession!.user));
  app.post<{Params:{id:string;action:string}}>('/api/players/:id/:action',async req=>{
    const id=uuid(req.params.id),{action}=req.params,{user,expires}=req.panelSession!,body=object(req.body);
    if(!['punish','revoke','note-add','note-edit','note-remove'].includes(action))throw new Failure(404,'Not found');
    if(!canModerate(user))throw new Failure(403,'Moderator role required');
    if((action==='revoke'||action==='punish'&&!['WARN','KICK','MUTE'].includes(String(body.type)))&&user.role!=='admin')throw new Failure(403,'Administrator role required');
    const requestId=req.headers['x-request-id'];if(typeof requestId!=='string'||! /^[a-zA-Z0-9-]{16,80}$/.test(requestId))throw new Failure(400,'Request ID required');
    for(const [key,expiry] of requests)if(expiry<=Date.now())requests.delete(key);
    const key=req.cookies.panel_session+':'+requestId;
    if(requests.has(key))throw new Failure(409,'This request was already submitted. Inspect player history and audit before retrying.');
    if(requests.size>=10000)throw new Failure(503,'Mutation capacity reached');requests.set(key,expires);body.requestId=requestId;
    await audit.write(user.name,action,id,'requested',body);
    try {const result=await bridge.mutate(id,user,action,body);await audit.write(user.name,action,id,'success',result);return result;}
    catch(error){await audit.write(user.name,action,id,'failed-or-unconfirmed',{requestId,error:error instanceof Error?error.message:'Unknown outcome'});throw error;}
  });
  app.get('/api/audit',async req=>{if(req.panelSession!.user.role!=='admin')throw new Failure(403,'Administrator role required');return audit.recent();});
  const manager=(req:FastifyRequest)=>{const user=req.panelSession!.user;if(config.mode!=='discord'||user.role!=='admin'||!['dev','owner'].includes(user.rank))throw new Failure(403,'Owner or developer rank required');};
  app.get('/api/access/ranks',async req=>{manager(req);return {ranks:config.ranks};});
  app.post('/api/access/ranks',async req=>{
    manager(req);if(savingRanks)throw new Failure(409,'Rank configuration is being saved');savingRanks=true;
    try {await saveRanks(config,object(req.body).ranks);await audit.write(req.panelSession!.user.name,'access-ranks-update','','success',{});return {restartRequired:true};}finally{savingRanks=false;}
  });
  app.post('/api/icons',async req=>{
    const ids=object(req.body).ids;if(!Array.isArray(ids)||ids.length>128||!ids.every(validItem))throw new Failure(400,'Expected at most 128 valid item IDs');
    if(iconJobs>=2)throw new Failure(503,'Icon service busy');iconJobs++;try{return await images.icons(ids as string[]);}finally{iconJobs--;}
  });
  app.get<{Params:{kind:string;name:string}}>('/api/skin/:kind/:name',async(req,reply)=>{
    const bytes=await images.skin(req.params.kind,req.params.name);return reply.header('Cache-Control','private, max-age=21600').type('image/png').send(bytes);
  });
  const publicDir=options.publicDir||resolve('dist/client');
  const index=await readFile(resolve(publicDir,'index.html'));
  app.get('/',async(_req,reply)=>reply.type('text/html; charset=utf-8').send(index));
  for(const file of await readdir(resolve(publicDir,'assets')).catch(()=>[])) {
    if(!/^[a-zA-Z0-9_.-]+\.(js|css)$/.test(file))continue;
    const data=await readFile(resolve(publicDir,'assets',file));
    app.get('/assets/'+file,async(_req,reply)=>reply.type(file.endsWith('.css')?'text/css':'text/javascript').send(data));
  }
  app.setNotFoundHandler((_req,reply)=>reply.code(404).send({error:'Not found'}));
  return {app,bridge,auth,audit};
}
