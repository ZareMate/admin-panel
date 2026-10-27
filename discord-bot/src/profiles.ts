import type { Guild, GuildMember, Message } from 'discord.js';
export function authorProfiles(guild:Guild) {
 const members=new Map<string,Promise<GuildMember|null>>();
 return async(m:Message)=>{
  let member=m.webhookId?null:m.member;
  if(!m.webhookId&&!member&&m.author.id){
   let pending=members.get(m.author.id);
   if(!pending){pending=guild.members.fetch(m.author.id).catch(()=>null);members.set(m.author.id,pending);}
   member=await pending;
  }
  return profile(m,member);
 };
}
export function profile(m:Message,member:GuildMember|null=m.webhookId?null:m.member) {
 return {author:member?.displayName??m.author.globalName??m.author.username,username:m.author.username,
  avatarUrl:member?.displayAvatarURL?.({size:128})??m.author.displayAvatarURL?.({size:128})};
}
