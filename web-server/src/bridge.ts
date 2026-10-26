import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { Failure, type User } from './common.js';
import { BatchReceiver } from './batches.js';
interface Pending { resolve:(value:unknown)=>void; reject:(error:Error)=>void; timer:NodeJS.Timeout }
export class Bridge {
  private peer?: WebSocket;
  private batches=new BatchReceiver();
  private watches = new Map<string,{fields:Record<string,unknown>;listeners:Set<(data:unknown,error?:string)=>void>;last?:unknown}>();
  private statusListeners = new Set<(connected:boolean)=>void>();
  onStatus(listener:(connected:boolean)=>void) { this.statusListeners.add(listener); return ()=>{this.statusListeners.delete(listener);}; }
  watch(key:string,fields:Record<string,unknown>,listener:(data:unknown,error?:string)=>void) {
    let watch=this.watches.get(key);
    if(!watch){
      if(this.watches.size>=32)throw new Failure(503,'Live subscription capacity reached');
      watch={fields,listeners:new Set()};this.watches.set(key,watch);
      const created=watch;
      if(this.connected)void this.call('watch',{watchId:key,...fields}).catch(()=>{
        if(this.watches.get(key)===created)for(const notify of created.listeners)notify(undefined,'Live subscription unavailable');
      });
    }
    const subscribed=watch;
    watch.listeners.add(listener);if(watch.last!==undefined)listener(watch.last);
    return ()=>{
      const current=this.watches.get(key);if(current!==subscribed)return;
      current.listeners.delete(listener);
      if(!current.listeners.size){this.watches.delete(key);if(this.connected)void this.call('unwatch',{watchId:key}).catch(()=>{});}
    };
  }
  private pending = new Map<string,Pending>();
  private timer: NodeJS.Timeout;
  private alive = false;
  private cached?: { value:unknown; at:number; peer:WebSocket };
  private refreshing?: Promise<unknown>;
  constructor(private timeout = 20_000) {
    this.timer = setInterval(()=>{
      if (!this.peer) return;
      try{this.batches.checkTimeout();}catch{this.peer.terminate();return;}
      if (!this.alive) { this.peer.terminate(); return; }
      this.alive = false; this.peer.ping();
    },20_000); this.timer.unref();
  }
  get connected() { return this.peer?.readyState === WebSocket.OPEN; }
  attach(peer: WebSocket) {
    if (this.peer) { peer.close(1008,'A Minecraft server is already connected'); return; }
    this.batches.reset();
    this.peer = peer; this.alive = true; this.cached = undefined;
    peer.on('pong',()=>{ if (this.peer===peer) this.alive=true; });
    peer.on('message',(data,binary)=>{
      if (this.peer !== peer) return;
      try {
        if (binary) throw new Error('Text required');
        const message = this.batches.accept(data.toString());if(!message)return;
        if(message.event==='snapshot') {
          const watch=this.watches.get(String(message.watchId));if(!watch)return;
          if('data' in message){watch.last=message.data;if(watch.fields.target==='players')this.cached={value:message.data,at:Date.now(),peer};for(const listener of watch.listeners)listener(message.data);}
          else if(typeof message.error==='string'){delete watch.last;if(watch.fields.target==='players')this.cached=undefined;for(const listener of watch.listeners)listener(undefined,message.error);}
          return;
        }
        if (typeof message.id !== 'string') throw new Error('Missing request ID');
        const pending = this.pending.get(message.id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        if (typeof message.error === 'string') pending.reject(new Failure(Number.isInteger(message.status) && Number(message.status)>=400 && Number(message.status)<=599 ? Number(message.status) : 502,message.error.slice(0,2000)));
        else if ('result' in message) pending.resolve(message.result);
        else pending.reject(new Failure(502,'Malformed game response'));
      } catch { peer.close(1007,'Invalid bridge response'); }
    });
    peer.on('error',()=>peer.terminate());
    peer.on('close',()=>{ if (this.peer!==peer) return; this.peer=undefined; this.batches.reset(); this.cached=undefined; this.failAll();for(const watch of this.watches.values())delete watch.last;for(const listener of this.statusListeners)listener(false); });
    for(const listener of this.statusListeners)listener(true);
    for(const [key,watch] of this.watches)void this.call('watch',{watchId:key,...watch.fields}).catch(()=>{for(const listener of watch.listeners)listener(undefined,'Live subscription unavailable');});
  }
  private offline() { return new Failure(503,'Minecraft server disconnected. A submitted command may have executed; inspect player history and audit before retrying.'); }
  private failAll() { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(this.offline()); } this.pending.clear(); }
  call(operation:string, fields:Record<string,unknown> = {}): Promise<unknown> {
    if (!this.connected) return Promise.reject(this.offline());
    if (this.pending.size>=32) return Promise.reject(new Failure(503,'Minecraft bridge busy'));
    const id=randomUUID(), peer=this.peer!;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{ this.pending.delete(id); reject(new Failure(504,'Minecraft request timed out. Execution may have started; inspect player history and audit before retrying.')); },this.timeout);
      this.pending.set(id,{resolve,reject,timer});
      const message=JSON.stringify({version:1,id,deadline:Date.now()+Math.min(this.timeout,15_000),operation,...fields});
      if (Buffer.byteLength(message)>65_536) { clearTimeout(timer); this.pending.delete(id); reject(new Failure(413,'Bridge request too large')); return; }
      peer.send(message,error=>{ if (error) { peer.terminate(); this.failAll(); } });
    });
  }
  async players() {
    if (!this.connected) throw this.offline();
    if (this.cached && this.cached.peer===this.peer && Date.now()-this.cached.at<2000) return this.cached.value;
    if (!this.refreshing) {
      const peer=this.peer!;
      this.refreshing=this.call('players').then(value=>{ if(this.peer===peer) this.cached={value,at:Date.now(),peer}; return value; }).finally(()=>{this.refreshing=undefined;});
    }
    return this.refreshing;
  }
  player(player:string, actor:User) { return this.call('player',{player,actor:this.actor(actor)}); }
  mutate(player:string, actor:User, action:string, body:unknown) { this.cached=undefined; return this.call('mutate',{player,actor:this.actor(actor),action,body}); }
  private actor(user:User) { return {name:user.name,rank:user.rank,uuid:user.uuid,permissions:user.permissions||[]}; }
  close() { this.batches.reset(); clearInterval(this.timer); this.failAll(); this.peer?.terminate(); this.peer=undefined; }
}
