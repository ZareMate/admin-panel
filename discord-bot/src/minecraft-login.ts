import type { Guild } from 'discord.js';
export class LoginLookupError extends Error {
 constructor(public code:string){super(code);}
}
export function loginFailure(error:unknown,stage:string):string {
 if(error instanceof LoginLookupError)return error.code;
 const code=error&&typeof error==='object'?'code' in error?error.code:undefined:undefined;
 if(code===10004)return 'login-guild-missing';
 if(code===10007)return 'login-member-missing';
 if(code===50001)return 'login-guild-inaccessible';
 if(code===50013)return 'login-permission-denied';
 if(code===401||code==='TokenInvalid')return 'login-bot-auth-failed';
 if(code===429)return 'login-rate-limited';
 return stage==='guild-fetch'?'login-guild-fetch-failed':'login-member-fetch-failed';
}
const id=(v:unknown)=>typeof v==='string'&&/^[1-9][0-9]{16,19}$/.test(v)?v:'invalid';
export async function loginMember(guild:Guild,authGuildId:string,c:Record<string,unknown>) {
 const started=Date.now(),loginId=typeof c.loginId==='string'&&/^[a-f0-9-]{36}$/i.test(c.loginId)?c.loginId:'unknown';
 const context={loginId,commandId:typeof c.id==='string'&&/^[a-f0-9-]{36}$/i.test(c.id)?c.id:'unknown',messagingGuild:guild.id,authGuild:authGuildId,requestedGuild:id(c.guildId),discordId:id(c.discordId)};
 let stage='validation';console.info('[Minecraft login] lookup started',context);
 try {
  if(c.guildId!==authGuildId)throw new LoginLookupError('login-guild-mismatch');
  if(id(c.discordId)==='invalid')throw new LoginLookupError('login-invalid-identity');
  stage='guild-fetch';const authGuild=authGuildId===guild.id?guild:await guild.client.guilds.fetch(authGuildId);
  stage='member-fetch';const member=await authGuild.members.fetch({user:c.discordId as string,force:true,cache:false});
  if(member.id!==c.discordId)throw new LoginLookupError('login-identity-mismatch');
  if(member.pending)throw new LoginLookupError('login-membership-pending');
  if(member.user.bot)throw new LoginLookupError('login-bot-account');
  console.info('[Minecraft login] member verified',{...context,roleCount:member.roles.cache.size,elapsedMs:Date.now()-started});
  return {messages:[{guildId:authGuild.id,discordId:member.id,username:member.user.username,pending:false,roles:[...member.roles.cache.keys()]}],hasMore:false};
 }catch(error){
  const code=loginFailure(error,stage);console.warn('[Minecraft login] lookup failed',{...context,stage,reason:code,elapsedMs:Date.now()-started});
  throw new LoginLookupError(code);
 }
}
