import { ChannelType, type Guild, type GuildBasedChannel } from 'discord.js';

type ListedChannel=Pick<GuildBasedChannel,'id'|'name'|'type'|'viewable'|'parentId'> & {rawPosition?:number;appliedTags?:readonly string[];availableTags?:readonly {id:string;name:string}[]};
export function channelListing(channels:Iterable<ListedChannel|null>):{count:number;lines:string[]} {
  const visible=new Map<string,ListedChannel>();
  for(const channel of channels)if(channel?.viewable)visible.set(channel.id,channel);
  const order=(a:ListedChannel,b:ListedChannel)=>(a.rawPosition??0)-(b.rawPosition??0)||a.type-b.type||a.name.localeCompare(b.name)||a.id.localeCompare(b.id);
  const label=(channel:ListedChannel)=>`[${ChannelType[channel.type]??channel.type}] ${JSON.stringify(channel.name)} (${channel.id})`;
  const categories=[...visible.values()].filter(c=>c.type===ChannelType.GuildCategory).sort(order);
  const groups=new Map<string|null,ListedChannel[]>();
  const children=new Map<string,ListedChannel[]>();
  const isThread=(c:ListedChannel)=>[ChannelType.PublicThread,ChannelType.PrivateThread,ChannelType.AnnouncementThread].includes(c.type);
  for(const channel of visible.values()) {
    if(channel.type===ChannelType.GuildCategory)continue;
    const parent=channel.parentId?visible.get(channel.parentId):undefined;
    if(isThread(channel)&&parent&&!isThread(parent)&&parent.type!==ChannelType.GuildCategory){
      const list=children.get(parent.id)??[];list.push(channel);children.set(parent.id,list);continue;
    }
    const category=parent?.type===ChannelType.GuildCategory?parent.id:null;
    const list=groups.get(category)??[];list.push(channel);groups.set(category,list);
  }
  const lines:string[]=[];
  const append=(key:string|null)=>{
    for(const channel of (groups.get(key)??[]).sort(order)){
      lines.push('  '+label(channel));
      for(const thread of (children.get(channel.id)??[]).sort(order)) {
        let tags='';
        if(channel.type===ChannelType.GuildForum) {
          const names=new Map((channel.availableTags??[]).map(tag=>[tag.id,tag.name]));
          const applied=(thread.appliedTags??[]).map(id=>JSON.stringify(names.get(id)??`Unknown tag (${id})`));
          tags=' — Tags: '+(applied.length?applied.join(', '):'none');
        }
        lines.push('    '+label(thread)+tags);
      }
    }
  };
  if(groups.has(null)){lines.push('Uncategorized');append(null);}
  for(const category of categories){lines.push(label(category));append(category.id);}
  return {count:visible.size,lines};
}
export async function printGuildChannels(guild:Guild,log:(line:string)=>void=console.log):Promise<void> {
  // Refresh our own roles before discord.js calculates channel visibility/overwrites.
  await guild.members.fetchMe();
  const channels=await guild.channels.fetch();
  const active=await guild.channels.fetchActiveThreads();
  const {count,lines}=channelListing([...channels.values(),...active.threads.values()]);
  log(`Guild ${JSON.stringify(guild.name)} (${guild.id}) — ${count} visible channels and active threads:`);
  for(const line of lines)log(line);
  if(!lines.length)log('No visible channels. Check the bot role and channel permission overrides.');
}
