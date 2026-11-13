import { WebSocket } from 'ws';
import { ChannelType, type Guild, type GuildBasedChannel } from 'discord.js';
export const TICKET_CATEGORIES = [{"id": "lost-items-or-airship", "label": "Lost Items or Airship"}, {"id": "other-support", "label": "Other Support"}, {"id": "cant-connect-to-the-server", "label": "Can’t Connect to the Server"}, {"id": "buy-a-shop-plot-at-spawn", "label": "Buy a Shop Plot at Spawn"}, {"id": "stealing-or-grieffing", "label": "Stealing or Grieffing"}, {"id": "player-report", "label": "Player Report"}, {"id": "report", "label": "Report"}] as const;

export const UNCATEGORIZED_TICKET = {id:'uncategorized',label:'Uncategorized'} as const;

export interface Ticket { id:string; name:string; category:string; guildId:string; tags:string[]; mentionedUserIds?:string[] }
export interface TicketConfig { suggestionsForumId?:string; suggestionsWebhookUrl?:string; categoryIds:string[]; rules:{id:string;label:string;pattern:string}[]; url?:string; token?:string }
// A Discord webhook URL; the token is a secret and is never included in error messages.
export const WEBHOOK_URL=/^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v[0-9]+)?\/webhooks\/([0-9]{17,20})\/([A-Za-z0-9_-]{20,100})$/;
export function ticketConfig(env:NodeJS.ProcessEnv=process.env):TicketConfig {
 const suggestionsForumId=env.SUGGESTIONS_FORUM_ID?.trim()||undefined;
 if(suggestionsForumId&&!/^[1-9][0-9]{16,19}$/.test(suggestionsForumId))throw new Error('Invalid SUGGESTIONS_FORUM_ID');
 const suggestionsWebhookUrl=env.SUGGESTIONS_WEBHOOK_URL?.trim()||undefined;
 if(suggestionsWebhookUrl&&!WEBHOOK_URL.test(suggestionsWebhookUrl))throw new Error('Invalid SUGGESTIONS_WEBHOOK_URL');
 if(suggestionsWebhookUrl&&!suggestionsForumId)throw new Error('Set SUGGESTIONS_FORUM_ID before SUGGESTIONS_WEBHOOK_URL');
 const categoryIds=(env.TICKET_CATEGORY_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(categoryIds.some(id=>! /^[1-9][0-9]{16,19}$/.test(id)))throw new Error('Invalid TICKET_CATEGORY_IDS');
 let overrides:Record<string, {pattern?:string;label?:string}>={};
 try {if(env.TICKET_RULES)overrides=JSON.parse(env.TICKET_RULES);}catch{throw new Error('TICKET_RULES must be a JSON object');}
 if(!overrides||Array.isArray(overrides)||typeof overrides!=='object'||Object.keys(overrides).some(id=>!TICKET_CATEGORIES.some(c=>c.id===id)))throw new Error('Unknown TICKET_RULES category');
 const rules=TICKET_CATEGORIES.map(c=>{
  const o=overrides[c.id];
  if(o!==undefined&&(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!['pattern','label'].includes(k))))throw new Error('Invalid TICKET_RULES entry');
  const pattern=o?.pattern??c.id+'-*',label=o?.label??c.label;
  if(typeof pattern!=='string'||! /^[a-z0-9*-]{1,100}$/.test(pattern)||typeof label!=='string'||!label.trim()||label.length>80)throw new Error('Invalid ticket pattern or label');
  return {id:c.id,pattern,label};
 });
 const url=env.TICKET_SYNC_URL?.trim(),token=env.TICKET_SYNC_TOKEN?.trim();
 if(url||token){
  let parsed:URL;try{parsed=new URL(url!);}catch{throw new Error('Invalid TICKET_SYNC_URL');}
  if(!['ws:','wss:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/tickets-sync')throw new Error('TICKET_SYNC_URL must use ws:// or wss:// and end in /tickets-sync');
  if(!token||! /^[A-Za-z0-9_-]{43,128}$/.test(token))throw new Error('Set TICKET_SYNC_TOKEN to a random 43–128 character URL-safe secret');
  if(!categoryIds.length&&!suggestionsForumId)throw new Error('Set TICKET_CATEGORY_IDS before enabling sync');
 }
 return {categoryIds,rules,url,token,suggestionsForumId,...(suggestionsWebhookUrl?{suggestionsWebhookUrl}:{})};
}
export function matches(name:string,pattern:string):boolean {
 // Only literal lowercase letters, digits and hyphens plus wildcard * are allowed.
 return new RegExp('^'+pattern.split('*').join('.*')+'$').test(name);
}
// Cache complete mention scans until messages change. Event invalidation also covers edits/deletes.
const mentionCache=new Map<string,{lastId:string|null;users:string[]}>();
const mentionScans=new Map<string,{dirty:boolean}>();
export function invalidateTicketMentions(channelId:string){mentionCache.delete(channelId);const scan=mentionScans.get(channelId);if(scan)scan.dirty=true;}
export async function ticketMentionUsers(channel:{id:string;lastMessageId?:string|null;messages?:{fetch:(options:{limit:number;before?:string;cache:boolean})=>Promise<any>}}):Promise<string[]> {
 if(!channel.messages)return [];
 const previous=mentionCache.get(channel.id),lastId=channel.lastMessageId??null;
 if(previous&&previous.lastId===lastId)return previous.users;
 const incremental=previous?.lastId&&lastId&&BigInt(lastId)>BigInt(previous.lastId)?previous:undefined;
 const users=new Set<string>(incremental?.users);let before:string|undefined;
 const scan={dirty:false};mentionScans.set(channel.id,scan);
 try{for(;;){
  const messages=await channel.messages.fetch({limit:100,cache:false,...(before?{before}:{})});
  if(!messages.size)break;
  let oldest:string|undefined,reachedPrevious=false;
  for(const message of messages.values()){
   if(incremental?.lastId&&BigInt(message.id)<=BigInt(incremental.lastId)){reachedPrevious=true;continue;}
   // Discord's users collection excludes role and everyone mentions.
   for(const user of message.mentions.users.values())if(/^[1-9][0-9]{16,19}$/.test(user.id))users.add(user.id);
   if(!oldest||BigInt(message.id)<BigInt(oldest))oldest=message.id;
  }
  if(reachedPrevious||messages.size<100||!oldest||oldest===before)break;
  before=oldest;
 }
 const result=[...users];if(!scan.dirty)mentionCache.set(channel.id,{lastId,users:result});return result;
 }finally{mentionScans.delete(channel.id);}
}
export async function collectTickets(guild:Guild,config:TicketConfig):Promise<Ticket[]> {
 await guild.members.fetchMe();
 const channels=await guild.channels.fetch(),active=await guild.channels.fetchActiveThreads();
 const all=new Map<string,GuildBasedChannel|null>([...channels,...active.threads]);
 const tickets:Ticket[]=[];
 for(const c of all.values()) {
  if(!c?.viewable||![ChannelType.GuildText,ChannelType.PublicThread,ChannelType.PrivateThread].includes(c.type))continue;
  const parent=c.parentId?all.get(c.parentId):undefined;
  const source=c.isThread()?parent?.parentId:c.parentId;
  if(!source||!config.categoryIds.includes(source))continue;
  const rule=config.rules.find(r=>matches(c.name,r.pattern));
  const tags=c.isThread()&&parent?.type===ChannelType.GuildForum?c.appliedTags.map(id=>parent.availableTags.find(t=>t.id===id)?.name??id):[];
  const mentionedUserIds=await ticketMentionUsers(c);
  tickets.push({...(mentionedUserIds.length?{mentionedUserIds}:{}),id:c.id,name:c.name,category:rule?.id??UNCATEGORIZED_TICKET.id,guildId:guild.id,tags});
 }
 for(const id of mentionCache.keys())if(!all.has(id))mentionCache.delete(id);
 return tickets.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
export async function publishTickets(config:TicketConfig,tickets:Ticket[],send?: (body:string)=>Promise<void>):Promise<void> {
 if(!config.url||!config.token)return;
 if(tickets.length>10000)throw new Error('Ticket snapshot exceeds 10000 tickets');
 const snapshot=crypto.randomUUID();
 // Every frame stays below the panel's 16 KiB body limit, including Unicode tags.
 const batches:Ticket[][]=[[]];
 for(const ticket of tickets){let batch=batches[batches.length-1]!;if(Buffer.byteLength(JSON.stringify([...batch,ticket]))>12000){batch=[];batches.push(batch);}batch.push(ticket);}
 const frames:string[]=[];
 for(let index=0;index<batches.length;index++){
  const body=JSON.stringify({snapshot,index,final:index===batches.length-1,categories:[...config.rules.map(({id,label})=>({id,label})),UNCATEGORIZED_TICKET],tickets:batches[index]});
  if(Buffer.byteLength(body)>16384)throw new Error('Ticket batch exceeds limit');
  frames.push(body);
 }
 if(send){for(const frame of frames)await send(frame);return;}
 // One authenticated connection per snapshot; failed transfers retry on the next refresh.
 await new Promise<void>((resolve,reject)=>{
  const socket=new WebSocket(config.url!,{headers:{Authorization:'Bearer '+config.token},handshakeTimeout:10000,maxPayload:4096,followRedirects:false,perMessageDeflate:false});
  let index=0,finished=false;
  let timer:ReturnType<typeof setTimeout>;
  const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);if(error){socket.terminate();reject(error);}else{socket.close();resolve();}};
  const next=()=>{clearTimeout(timer);timer=setTimeout(()=>finish(new Error('Ticket sync acknowledgement timed out')),10000);socket.send(frames[index]!,error=>{if(error)finish(new Error('Ticket sync send failed'));});};
  socket.on('open',next);
  socket.on('message',data=>{try{
   const ack=JSON.parse(data.toString());
   if(ack.snapshot!==snapshot||ack.index!==index||ack.ok!==true)throw new Error();
   if(++index===frames.length)finish();else next();
  }catch{finish(new Error('Ticket sync acknowledgement rejected'));}});
  socket.on('error',()=>finish(new Error('Ticket WebSocket connection failed')));
  socket.on('close',()=>finish(new Error('Ticket WebSocket disconnected')));
 });
}
