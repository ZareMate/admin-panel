import type {Guild} from 'discord.js';
export class TodoAssigneeError extends Error {constructor(public code:string){super(code);}}
type Rank={roleId:string;name:string;assignable:boolean};
type Assignee={id:string;name:string;rank:string};
const caches=new WeakMap<Guild,Map<string,{expires:number;value:Promise<Assignee[]>}>>();
export async function todoAssignees(guild:Guild,authGuildId:string,command:Record<string,unknown>) {
 if(command.guildId!==authGuildId)throw new TodoAssigneeError('todo-guild-mismatch');
 if(!Array.isArray(command.ranks)||command.ranks.length>100||command.ranks.some(rank=>!rank||typeof rank.roleId!=='string'||!/^[1-9][0-9]{16,19}$/.test(rank.roleId)||typeof rank.name!=='string'||rank.name.length>32||typeof rank.assignable!=='boolean'))throw new Error('Invalid assignee ranks');
 const ranks=command.ranks as Rank[],key=JSON.stringify([authGuildId,ranks]);
 let cache=caches.get(guild);if(!cache){cache=new Map();caches.set(guild,cache);}
 let entry=cache.get(key);
 if(!entry||entry.expires<=Date.now()){
  const value=(async()=>{
   const authGuild=authGuildId===guild.id?guild:await guild.client.guilds.fetch(authGuildId);
   const result:Assignee[]=[];let after:string|undefined;
   for(let page=0;page<50;page++){
    const members=await authGuild.members.list({limit:1000,after,cache:false});
    for(const member of members.values()){
     const rank=ranks.find(rank=>member.roles.cache.has(rank.roleId));
     if(member.user.bot||member.pending||!rank?.assignable)continue;
     result.push({id:member.id,name:member.displayName.slice(0,100),rank:rank.name});
     if(result.length>2000)throw new TodoAssigneeError('todo-directory-too-large');
    }
    if(members.size<1000)return result.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
    const next=[...members.keys()].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1).at(-1);
    if(!next||next===after)throw new TodoAssigneeError('todo-directory-failed');after=next;
   }
   throw new TodoAssigneeError('todo-directory-too-large');
  })().catch(error=>{cache!.delete(key);if(error instanceof TodoAssigneeError)throw error;throw new TodoAssigneeError('todo-directory-failed');});
  if(cache.size>=8)cache.delete(cache.keys().next().value!);
  entry={expires:Date.now()+120000,value};cache.set(key,entry);
 }
 const members=await entry.value,messages=[];
 for(let i=0;i<members.length;i+=100)messages.push({assignees:members.slice(i,i+100)});
 return {messages,hasMore:false};
}
