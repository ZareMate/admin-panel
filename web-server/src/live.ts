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
  constructor(private bridge:Bridge,private auth:Auth) {}
  attach(socket:WebSocket,token:string) {
    if(this.clients.size>=128 || [...this.clients.values()].filter(c=>c.token===token).length>=4){socket.close(1013,'Live connection capacity reached');return;}
    let messages=0,windowStart=Date.now();
    let stopped=false,unlist=()=>{},unplayer=()=>{},unstatus=()=>{},selected:string|undefined;
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
        unplayer();unplayer=()=>{};selected=player;
        if(!player)return;
        const user=this.auth.get(token)!.user;
        if(!has(user,'tab.players'))throw new Failure(403,'Permission required: tab.players');
        const actor={name:user.name,role:user.role,rank:user.rank,uuid:user.uuid,permissions:user.permissions||[]};
        // Author UUID alone is insufficient: role/rank/name are also part of a viewer's snapshot.
        const key='p:'+createHash('sha256').update(JSON.stringify({player,actor})).digest('hex');
        try {unplayer=this.bridge.watch(key,{target:'player',player,actor},(data,error)=>send(error?{type:'live-error',player,error}:{type:'player',player,data:filterDetail(data,user)}));}
        catch(error){selected=undefined;throw error;}
        if(stopped)unplayer();
      }catch(error){send({type:'live-error',error:error instanceof Error?error.message:'Invalid subscription'});}
    });
    try {
      if(has(this.auth.get(token)?.user,'tab.players'))unlist=this.bridge.watch('players',{target:'players'},(data,error)=>{
        const user=this.auth.get(token)?.user;if(!user){authorized();return;}
        send(error?{type:'live-error',error}:{type:'players',data:filterPlayers(data,user)});
      });
      unstatus=this.bridge.onStatus(connected=>send({type:'status',connected}));
      send({type:'status',connected:this.bridge.connected});
      if(stopped){unlist();unstatus();}
    }catch(error){send({type:'live-error',error:error instanceof Error?error.message:'Live subscription unavailable'});socket.close(1013,'Live subscription unavailable');close();}
  }
  revoke(token:string) {for(const [socket,client] of this.clients)if(client.token===token){socket.close(4001,'Session ended');client.close();}}
  close() {for(const [socket,client] of this.clients){socket.terminate();client.close();}}
}
