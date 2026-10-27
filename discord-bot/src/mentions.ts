import type { Guild, Message } from 'discord.js';

// Per-page lookups are deduplicated and bounded; unresolved mentions retain their IDs.
export function mentionFormatter(guild:Guild) {
 const mentions:Record<string,string>={};
 const lookups=new Map<string,Promise<string|undefined>>();let fetched=0;
 async function name(id:string,role:boolean,m:Message):Promise<string|undefined> {
  const cached=role?guild.roles?.cache.get(id)?.name:
   guild.members?.cache?.get(id)?.displayName??m.mentions?.members?.get(id)?.displayName;
  if(cached)return cached;
  const key=(role?'role:':'user:')+id;
  let lookup=lookups.get(key);
  if(!lookup){
   const fallback=m.mentions?.users?.get(id);
   if(fetched>=25)return role?undefined:fallback?.globalName??fallback?.username;
   fetched++;
   lookup=(async()=>{
    try{return role?(await guild.roles.fetch(id))?.name:(await guild.members.fetch(id)).displayName;}
    catch{return role?undefined:fallback?.globalName??fallback?.username;}
   })();lookups.set(key,lookup);
  }
  return lookup;
 }
 const format=async(text:string|null|undefined,m:Message):Promise<string|null|undefined>=>{
  if(!text)return text;
  const matches=[...text.matchAll(/<@([!&]?)([0-9]{17,20})>/g)];
  const replacements=new Map<string,string>();
  // Serial fetches avoid a burst of Discord REST requests on large history pages.
  for(const match of matches){if(replacements.has(match[0]))continue;const resolved=await name(match[2]!,match[1]==='&',m);if(resolved)mentions[match[0]]='@'+resolved;replacements.set(match[0],resolved?'@'+resolved:match[0]);}
  return text.replace(/<@([!&]?)([0-9]{17,20})>/g,raw=>replacements.get(raw)??raw);
 };
 return Object.assign(format,{mentions});
}
