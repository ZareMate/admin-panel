import { errorDetail } from './errors.js';
import { connectConversations } from './conversations.js';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { ticketConfig, collectTickets, publishTickets } from './tickets.js';
import { loadConfig } from './config.js';
import { printGuildChannels } from './channels.js';

let client:Client|undefined;
let stopConversations=()=>{};
let ticketTimer:ReturnType<typeof setInterval>|undefined;
function report(stage:string,error:unknown) {
  console.error(`${stage}: ${errorDetail(error)}`);
}
try {
  const config=loadConfig(),tickets=ticketConfig();
  client=new Client({intents:[GatewayIntentBits.Guilds,...(tickets.url?[GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]:[])],presence:{status:'online'},allowedMentions:{parse:[]}});
  client.once(Events.ClientReady,ready=>{
    console.log(`Online as ${JSON.stringify(ready.user.tag)} (${ready.user.id}).`);
    void (async()=>{
      const guild=await ready.guilds.fetch(config.guildId);
      await printGuildChannels(guild);
      stopConversations=connectConversations(guild,tickets);
      console.log('Channel listing complete. Bot remains online; press Ctrl+C to stop.');
      let syncing=false;
      const sync=async()=>{if(syncing)return;syncing=true;try{
        const rows=await collectTickets(guild,tickets);
        await publishTickets(tickets,rows);
        console.log(`Tickets: ${rows.length} matched${tickets.url?' and synced':''}.`);
      }catch(error){report('Ticket sync failed',error);}finally{syncing=false;}};
      if(tickets.categoryIds.length){await sync();ticketTimer=setInterval(()=>void sync(),30000);}
    })().catch(error=>{report('Channel listing failed',error);process.exitCode=1;client?.destroy();});
  });
  client.on(Events.Error,error=>report('Discord connection error',error));
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{console.log('Stopping Discord bot.');clearInterval(ticketTimer);stopConversations();client?.destroy();});
  await client.login(config.token);
}catch(error){
  if(!client)console.error(error instanceof Error?error.message:'Invalid bot configuration.');
  else report('Bot login failed',error);
  process.exitCode=1;client?.destroy();
}
