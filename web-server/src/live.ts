import { MojangNames } from './mojang-names.js';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { Auth } from './auth.js';
import { Bridge } from './bridge.js';
import { object, uuid, Failure } from './common.js';

import { BatchSender } from './batch-sender.js';
import { has, filterDetail, filterPlayers } from './permissions.js';
/** Browser sockets use staff sessions; the Minecraft bridge secret never reaches a browser. */
export class Live {
  private clients = new Map<WebSocket,{token:string;close:()=>void}>();
  constructor(private bridge:Bridge,private auth:Auth,private names:MojangNames) {}
  attach(socket:WebSocket,token:string) {
    if(this.clients.size>=128 || [...this.clients.values()].filter(c=>c.token===token).length>=4){socket.close(1013,'Live connection capacity reached');return;}
    let messages=0,windowStart=Date.now();
    let stopped=false,unlist=()=>{},unplayer=()=>{},unstatus=()=>{},selected:string|undefined;
    let listVersion=0,playerVersion=0;
    const close=()=>{
      if(stopped)return;stopped=true;clearInterval(heartbeat);sender.close();unlist();unplayer();unstatus();this.clients.delete(socket);
    };
    const authorized=()=>{
      if(this.auth.get(token))return true;
      socket.close(4001,'Session expired. Sign in again.');close();return false;
    };
    const sender=new BatchSender(socket,authorized,()=>{socket.close(1013,'Live transfer limit or timeout; reconnecting');close();});
    const send=(message:unknown)=>{
      if(stopped||!authorized()||socket.readyState!==WebSocket.OPEN)return;
      sender.send(message);
    };
    let alive=true;
    const heartbeat=setInterval(()=>{
      if(!authorized())return;
      if(!alive){socket.terminate();close();return;}
      alive=false;socket.ping();
    },10000);heartbeat.unref();
    this.clients.set(socket,{token,close});
    socket.on('pong',()=>{alive=true;});socket.on('close',close);socket.on('error',()=>{socket.terminate();close();});
    socket.on('message',(data,binary)=>{
      if(stopped||!authorized())return;
      if(binary||Buffer.byteLength(data.toString())>256){socket.close(1009,'Live subscription too large');close();return;}
      if(Date.now()-windowStart>=1000){windowStart=Date.now();messages=0;}
      if(++messages>10){socket.close(1008,'Too many subscription changes');close();return;}
      try {
        const message=object(JSON.parse(data.toString()));
        if(message.type!=='select')throw new Failure(400,'Unknown live operation');
        const player=message.player===null?undefined:uuid(message.player);
        if(player===selected)return;
        playerVersion++;unplayer();unplayer=()=>{};selected=player;
        if(!player)return;
        const user=this.auth.get(token)!.user;
        if(!has(user,'tab.players'))throw new Failure(403,'Permission required: tab.players');
        const actor={name:user.name,rank:user.rank,uuid:user.uuid,permissions:user.permissions||[]};
        // Author UUID alone is insufficient: role/rank/name are also part of a viewer's snapshot.
        const key='p:'+createHash('sha256').update(JSON.stringify({player,actor})).digest('hex');
        try {unplayer=this.bridge.watch(key,{target:'player',player,actor},(data,error)=>{
          const version=++playerVersion;
          if(error){send({type:'live-error',player,error});return;}
          send({type:'player',player,data:this.names.snapshot(filterDetail(data,user))});
          void this.names.enrich(filterDetail(data,user)).then(enriched=>{
            const current=this.auth.get(token)?.user;
            if(!stopped&&version===playerVersion&&selected===player&&current&&has(current,'tab.players'))send({type:'player',player,data:filterDetail(enriched,current)});
          }).catch(()=>{if(!stopped&&version===playerVersion)send({type:'live-error',player,error:'Player name resolution unavailable'});});
        });}
        catch(error){selected=undefined;throw error;}
        if(stopped)unplayer();
      }catch(error){send({type:'live-error',error:error instanceof Error?error.message:'Invalid subscription'});}
    });
    try {
      if(has(this.auth.get(token)?.user,'tab.players'))unlist=this.bridge.watch('players',{target:'players'},(data,error)=>{
        const user=this.auth.get(token)?.user;if(!user){authorized();return;}
        const version=++listVersion;
        if(error){send({type:'live-error',error});return;}
        send({type:'players',data:this.names.snapshot(filterPlayers(data,user))});
        void this.names.enrich(filterPlayers(data,user)).then(enriched=>{
          const current=this.auth.get(token)?.user;
          if(!stopped&&version===listVersion&&current&&has(current,'tab.players'))send({type:'players',data:filterPlayers(enriched,current)});
        }).catch(()=>{if(!stopped&&version===listVersion)send({type:'live-error',error:'Player name resolution unavailable'});});
      });
      unstatus=this.bridge.onStatus(connected=>{if(!connected){listVersion++;playerVersion++;}send({type:'status',connected});});
      send({type:'status',connected:this.bridge.connected});
      if(stopped){unlist();unstatus();}
    }catch(error){send({type:'live-error',error:error instanceof Error?error.message:'Live subscription unavailable'});socket.close(1013,'Live subscription unavailable');close();}
  }
  permissionsChanged() {for(const [socket,client] of this.clients){socket.close(4002,'Permissions changed');client.close();}}
  revoke(token:string) {for(const [socket,client] of this.clients)if(client.token===token){socket.close(4001,'Session ended');client.close();}}
  close() {for(const [socket,client] of this.clients){socket.terminate();client.close();}}
}
