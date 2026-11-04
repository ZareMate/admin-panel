import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { Failure } from './common.js';
export class TicketBridge {
 private socket?:WebSocket;
 private pending=new Map<string,{rows:unknown[];resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 attach(socket:WebSocket) {
  if(this.socket?.readyState===WebSocket.OPEN){socket.close(1008,'Bot already connected');return;}
  this.socket=socket;
  socket.on('message',(data,binary)=>{
   try{
    if(binary||data.toString().length>60000)throw new Error();
    const m=JSON.parse(data.toString()),p=this.pending.get(m.id);if(!p)return;
    if(m.type==='item'){if(p.rows.length>=25)throw new Error();p.rows.push(m.message);return;}
    if(m.type!=='done')throw new Error();
    clearTimeout(p.timer);this.pending.delete(m.id);
    if(m.error){
     const errors:Record<string,[number,string]>={"login-guild-mismatch":[503,"Bot DISCORD_AUTH_GUILD_ID does not match panel discord.guild-id. Update the auth guild and restart the bot."],"login-invalid-identity":[400,"Invalid linked Discord account ID."],"login-guild-missing":[503,"Auth guild not found. Check DISCORD_AUTH_GUILD_ID and invite the bot to the auth guild."],"login-member-missing":[403,"Your linked Discord account is not a member of the auth guild."],"login-guild-inaccessible":[503,"The bot cannot access the auth guild. Invite it to the configured auth guild."],"login-permission-denied":[503,"Discord denied the bot permission to fetch auth guild membership."],"login-bot-auth-failed":[503,"Discord rejected the bot credentials. Check DISCORD_BOT_TOKEN and restart the bot."],"login-rate-limited":[503,"Discord rate-limited the auth lookup. Try again shortly."],"login-guild-fetch-failed":[502,"Could not fetch the auth guild. Check the bot console for the matching login ID."],"login-member-fetch-failed":[502,"Could not fetch the linked Discord member. Check the bot console for the matching login ID."],"login-identity-mismatch":[403,"Discord returned a different account from the linked identity."],"login-membership-pending":[403,"Complete membership screening in the auth guild before signing in."],"login-bot-account":[403,"A Discord bot account cannot sign in."],'suggestions-unconfigured':[503,'Set SUGGESTIONS_FORUM_ID in the Discord bot .env and restart it.'],'suggestions-conflict':[409,'This suggestion changed on Discord. Refresh suggestions before saving again.'],'suggestions-readonly':[403,'Editing requires an active, unlocked thread, and the bot needs the Manage Threads permission.'],'suggestions-webhook-unconfigured':[503,'Set SUGGESTIONS_WEBHOOK_URL in the Discord bot .env and restart it.'],'suggestions-webhook-mismatch':[503,'SUGGESTIONS_WEBHOOK_URL must be a webhook of the suggestions forum channel.'],'suggestions-status-unsupported':[409,'This suggestion was not posted by the configured webhook, so its message cannot be edited.'],'suggestions-too-long':[400,'The suggestion text is too long to add a status line.']};
     const [status,message]=errors[String(m.errorCode)]??[502,'Discord request failed. Check bot permissions and refresh before retrying.'];p.reject(new Failure(status,message,errors[String(m.errorCode)]?String(m.errorCode):'bot-command-failed'));
    }
    else p.resolve({messages:p.rows,hasMore:m.hasMore===true});
   }catch{socket.close(1008,'Invalid command response');}
  });
  socket.on('close',()=>{if(this.socket!==socket)return;this.socket=undefined;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Failure(503,'Ticket bot disconnected. Refresh before retrying a reply.'));}this.pending.clear();});
 }
 request(command:Record<string,unknown>):Promise<unknown> {
  const socket=this.socket;if(socket?.readyState!==WebSocket.OPEN)throw new Failure(503,'Ticket bot is offline');
  if(this.pending.size>=20)throw new Failure(503,'Ticket bot is busy');
  const id=randomUUID();
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new Failure(504,'Discord request timed out. Refresh before retrying a reply.'));},20000);
   this.pending.set(id,{rows:[],resolve,reject,timer});
   socket.send(JSON.stringify({...command,id}),error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(new Failure(503,'Ticket bot disconnected'));}});
  });
 }
 close(){this.socket?.terminate();}
}
