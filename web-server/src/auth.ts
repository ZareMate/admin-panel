import { pbkdf2 } from 'node:crypto';
import { promisify } from 'node:util';
import { Failure, type User, token, equal, discordUuid, text, object } from './common.js';
import { type Config, snowflake } from './config.js';
import { has } from './permissions.js';
const hash = promisify(pbkdf2);
export interface Session { user:User; csrf:string; expires:number }
export class Auth {
  private sessions = new Map<string,Session>();
  private attempts = new Map<string,{count:number;expires:number}>();
  private pending = new Map<string,{browser:string;expires:number}>();
  private retryAt = 0;
  private hashing = 0;
  constructor(private config:Config, private fetcher:typeof fetch = fetch) {}
  allowLogin(ip:string) {
    for (const [key,value] of this.attempts) if(value.expires<=Date.now()) this.attempts.delete(key);
    const item = this.attempts.get(ip) || {count:0,expires:Date.now()+300_000};
    if ((this.attempts.size>=4096 && !this.attempts.has(ip)) || ++item.count>10) throw new Failure(429,'Too many login attempts. Try again in five minutes.');
    this.attempts.set(ip,item);
  }
  async authenticate(name:string,password:string) {
    if (this.hashing>=4) throw new Failure(503,'Login service busy');
    this.hashing++;
    try {
      const user=this.config.users.get(name), encoded=user?.hash || '0'.repeat(32)+':'+ '0'.repeat(64);
      const [salt,expected]=encoded.split(':');
      const actual=await hash(password,Buffer.from(salt!,'hex'),600_000,32,'sha256');
      return equal(actual.toString('hex'),expected!) && has(user,'panel.access') ? user : undefined;
    } finally { this.hashing--; }
  }
  create(user:User,expires=Date.now()+8*3600_000) {
    for(const [key,value] of this.sessions) if(value.expires<=Date.now()) this.sessions.delete(key);
    if(this.sessions.size>=1024) throw new Failure(503,'Session capacity reached');
    const id=token(); this.sessions.set(id,{user:{...user,permissions:[...(user.permissions||[])]},csrf:token(),expires:Math.min(expires,Date.now()+8*3600_000)}); return id;
  }
  get(id:string) { const s=this.sessions.get(id); if(s && s.expires<=Date.now()) {this.sessions.delete(id);return undefined;} return s; }
  logout(id:string) {this.sessions.delete(id);}
  start() {
    for(const [key,value] of this.pending) if(value.expires<=Date.now()) this.pending.delete(key);
    if(this.pending.size>=1024) throw new Failure(429,'Too many pending Discord logins');
    const state=token(),browser=token(); this.pending.set(state,{browser,expires:Date.now()+300_000});
    const params=new URLSearchParams({response_type:'code',client_id:this.config.clientId,scope:'identify guilds.members.read',state,redirect_uri:this.config.origin+'/api/auth/discord/callback'});
    return {browser,location:'https://discord.com/oauth2/authorize?'+params};
  }
  private async discord(path:string, init:RequestInit) {
    if(Date.now()<this.retryAt) throw new Failure(503,'Discord rate-limited requests. Try again shortly.');
    try {
      const response=await this.fetcher('https://discord.com'+path,{...init,redirect:'error',signal:AbortSignal.timeout(8000)});
      const raw=await boundedBody(response,1024*1024); let json:Record<string,unknown>={};
      try {json=object(JSON.parse(raw.toString()));} catch {if(response.ok) throw new Error('Invalid Discord response');}
      if(response.status===429) {
        let seconds=Number(response.headers.get('retry-after') || json.retry_after || 60);
        if(!Number.isFinite(seconds)||seconds<=0) seconds=60;
        this.retryAt=Date.now()+Math.min(seconds,86400)*1000; throw new Failure(503,'Discord rate-limited requests. Try again shortly.');
      }
      if(!response.ok) throw new Failure([400,401].includes(response.status)?401:[403,404].includes(response.status)?403:503,`Discord request failed (HTTP ${response.status}). Check application settings and guild membership.`);
      return json;
    } catch(error) {if(error instanceof Failure) throw error; throw new Failure(503,'Could not connect to Discord. Try again shortly.');}
  }
  async finish(state:string,browser:string,code:unknown,denied:boolean) {
    const pending=this.pending.get(state);
    if(!pending || pending.expires<=Date.now() || !equal(pending.browser,browser)) throw new Failure(400,'Discord login expired or state did not match this browser. Start sign-in again.');
    this.pending.delete(state);
    if(denied) throw new Failure(401,'Discord sign-in was cancelled');
    const form=new URLSearchParams({grant_type:'authorization_code',client_id:this.config.clientId,client_secret:this.config.clientSecret,code:text(code,2048),redirect_uri:this.config.origin+'/api/auth/discord/callback'});
    const grant=await this.discord('/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form});
    const access=text(grant.access_token,4096),scope=text(grant.scope,1024).split(/\s+/),seconds=Number(grant.expires_in);
    if(String(grant.token_type).toLowerCase()!=='bearer' || !scope.includes('identify') || !scope.includes('guilds.members.read') || !Number.isSafeInteger(seconds) || seconds<=0) throw new Failure(401,'Invalid Discord grant');
    const headers={Authorization:'Bearer '+access};
    const identity=await this.discord('/api/v10/users/@me',{headers});
    const id=snowflake(identity.id), username=text(identity.username,100);
    const member=await this.discord(`/api/v10/users/@me/guilds/${this.config.guildId}/member`,{headers});
    if(member.pending===true || !Array.isArray(member.roles) || (member.user && object(member.user).id!==id)) throw new Failure(403,'Discord membership could not be verified');
    const rank=this.config.ranks.find(r=>(member.roles as unknown[]).includes(r.discordRoleId));
    if(!rank || !has(rank,'panel.access')) throw new Failure(403,'Your Discord roles do not grant panel access');
    const user:User={name:`${username} [${id}]`,permissions:[...rank.permissions],rank:rank.name,uuid:this.config.mappings.get(id)||discordUuid(id)};
    // Authorization snapshot at login; tokens are discarded after the exchange.
    return {user,expires:Date.now()+Math.min(seconds,28800)*1000};
  }
}
export async function boundedBody(response:Response,max:number):Promise<Buffer> {
  if(!response.body) throw new Failure(502,'Empty upstream response');
  const reader=response.body.getReader(), chunks:Uint8Array[]=[]; let size=0;
  try {while(true) {const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>max)throw new Failure(502,'Upstream response too large');chunks.push(part.value);} }
  finally {await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
}
