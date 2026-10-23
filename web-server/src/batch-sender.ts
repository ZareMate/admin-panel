import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { batchFrames, byteLength, MAX_MESSAGE_BYTES, BATCH_TIMEOUT_MS } from './batches.js';

/** Serialize complete transfers and await writes so a snapshot cannot fill the socket buffer. */
export class BatchSender {
  private queue:{text:string;bytes:number}[]=[];
  private bytes=0;
  private running=false;
  private stopped=false;
  private timer?:ReturnType<typeof setTimeout>;
  constructor(private socket:WebSocket,private authorized:()=>boolean,private failed:()=>void) {}
  close(){this.stopped=true;this.queue=[];this.bytes=0;clearTimeout(this.timer);}
  send(message:unknown) {
    if(this.stopped)return;
    const text=JSON.stringify(message),bytes=byteLength(text);
    if(bytes>MAX_MESSAGE_BYTES||this.bytes+bytes>MAX_MESSAGE_BYTES){this.fail();return;}
    this.bytes+=bytes;this.queue.push({text,bytes});if(!this.running)void this.drain();
  }
  private fail(){if(this.stopped)return;this.close();this.failed();}
  private async drain() {
    this.running=true;
    try {
      while(!this.stopped&&this.queue.length){
        const message=this.queue.shift()!;
        this.timer=setTimeout(()=>this.fail(),BATCH_TIMEOUT_MS);this.timer.unref();
        for(const frame of batchFrames(message.text,randomUUID())) {
          if(this.stopped||!this.authorized()||this.socket.readyState!==WebSocket.OPEN){this.close();return;}
          await new Promise<void>((resolve,reject)=>this.socket.send(frame,error=>error?reject(error):resolve()));
        }
        clearTimeout(this.timer);this.bytes-=message.bytes;
      }
    }catch{this.fail();}finally{this.running=false;}
  }
}
