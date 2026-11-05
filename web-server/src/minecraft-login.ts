import { createHash, randomUUID } from 'node:crypto';
import { Failure, type User, token, object, text, uuid } from './common.js';
import { type Config, snowflake } from './config.js';
import { has } from './permissions.js';
import type { TicketBridge } from './ticket-bridge.js';

/** Only the authenticated Minecraft server can attest to the link, never the browser. */
export class MinecraftLogin {
 private pending=new Map<string,{minecraftUuid:string;discordId:string;expires:number;loginId:string}>();
 private key(value:string){return createHash('sha256').update(value).digest('hex');}
 constructor(private config:Config,private bot:Pick<TicketBridge,'request'>,private now=Date.now,private log:(level:'info'|'warn',event:string,fields:Record<string,unknown>)=>void=()=>{}) {}
 issue(body:unknown) {
  if(this.config.mode!=='discord')throw new Failure(403,'Discord authentication required','login-discord-disabled');
  const b=object(body),minecraftUuid=uuid(b.minecraftUuid),discordId=snowflake(b.discordId);
  const mapped=this.config.mappings.get(discordId);
  if(mapped&&mapped!==minecraftUuid)throw new Failure(403,'Minecraft account mapping does not match','login-mapping-mismatch');
  for(const [key,value] of this.pending)if(value.expires<=this.now()||value.minecraftUuid===minecraftUuid)this.pending.delete(key);
  if(this.pending.size>=1024)throw new Failure(503,'Too many pending Minecraft logins');
  const ticket=token()+token(),loginId=b.loginId===undefined?randomUUID():uuid(b.loginId);
  this.pending.set(this.key(ticket),{minecraftUuid,discordId,expires:this.now()+60_000,loginId});
  this.log('info','minecraft_login_ticket_issued',{loginId,minecraftUuid,discordId,guildId:this.config.guildId,expiresIn:60});
  return {ticket,expiresIn:60,loginId};
 }
 async redeem(value:unknown):Promise<User> {
  const ticket=text(value,86);if(!/^[A-Za-z0-9_-]{86}$/.test(ticket))throw new Failure(401,'Invalid Minecraft login ticket');
  const key=this.key(ticket),pending=this.pending.get(key);this.pending.delete(key);
  if(!pending||pending.expires<=this.now())throw new Failure(401,'Minecraft login expired or already used','login-ticket-expired');
  const context={loginId:pending.loginId,minecraftUuid:pending.minecraftUuid,discordId:pending.discordId,guildId:this.config.guildId},started=this.now();
  let stage='bot-member-lookup';this.log('info','minecraft_login_redeeming',context);
  try {
  const result=object(await this.bot.request({action:'minecraft-login-member',guildId:this.config.guildId,discordId:pending.discordId,loginId:pending.loginId}));
  stage='membership-validation';
  const rows=result.messages;if(!Array.isArray(rows)||rows.length!==1)throw new Failure(403,'Discord membership could not be verified','login-membership-invalid');
  const member=object(rows[0]);
  if(member.guildId!==this.config.guildId||member.discordId!==pending.discordId||member.pending!==false||!Array.isArray(member.roles))throw new Failure(403,'Discord membership could not be verified','login-membership-invalid');
  const mapped=this.config.mappings.get(pending.discordId);if(mapped&&mapped!==pending.minecraftUuid)throw new Failure(403,'Minecraft account mapping does not match','login-mapping-mismatch');
  stage='rank-authorization';
  const rank=this.config.ranks.find(r=>(member.roles as unknown[]).includes(r.discordRoleId));
  if(!rank||!has(rank,'panel.access')) {
   this.log('warn','minecraft_login_rank_denied',{...context,matchedRank:rank?.name||null,memberRoleIds:member.roles.filter(id=>typeof id==='string'&&/^[1-9][0-9]{16,19}$/.test(id)).slice(0,250),configuredRanks:this.config.ranks.map(r=>({name:r.name,roleId:r.discordRoleId}))});
   throw new Failure(403,'Your Discord roles do not grant panel access','login-rank-denied');
  }
  this.log('info','minecraft_login_authorized',{...context,rank:rank.name,permissionCount:rank.permissions.length,elapsedMs:this.now()-started});
  return {name:`${text(member.username,100)} [${pending.discordId}]`,uuid:pending.minecraftUuid,discordId:pending.discordId,discordRoles:member.roles.filter((role):role is string=>typeof role==='string'),rank:rank.name,permissions:[...rank.permissions]};
  }catch(error){this.log('warn','minecraft_login_failed',{...context,stage,reason:error instanceof Failure?(error.code||'authorization-rejected'):'internal-error',status:error instanceof Failure?error.statusCode:500,elapsedMs:this.now()-started});throw error;}
 }
}
