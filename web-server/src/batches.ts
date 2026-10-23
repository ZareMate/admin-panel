/** Application messages are split into independently bounded WebSocket messages.
 * Shared by Node and React. One ordered transfer at a time per connection. */
export const CHUNK_CHARS=8192;
export const MAX_FRAME_BYTES=65536;
export const MAX_MESSAGE_BYTES=32*1024*1024;
export const MAX_BATCH_PARTS=8192;
export const BATCH_TIMEOUT_MS=30000;
const encoder=new TextEncoder();
export const byteLength=(text:string)=>encoder.encode(text).length;
export function* batchFrames(text:string,id:string):Generator<string> {
  if(byteLength(text)>MAX_MESSAGE_BYTES)throw new Error('Message exceeds 32 MiB transfer limit');
  if(text.length<=CHUNK_CHARS){yield text;return;}
  // Boundaries must not split a UTF-16 surrogate pair (emoji, non-BMP names/lore).
  const chunks:string[]=[];
  for(let start=0;start<text.length;){let end=Math.min(start+CHUNK_CHARS,text.length);
    if(end<text.length&&text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff)end--;
    chunks.push(text.slice(start,end));start=end;
  }
  for(let index=0;index<chunks.length;index++)yield JSON.stringify({batch:1,id,index,total:chunks.length,data:chunks[index]});
}
export class BatchReceiver {
  private pending?:{id:string;total:number;parts:string[];bytes:number;started:number};
  reset(){this.pending=undefined;}
  checkTimeout(now=Date.now()) {
    if(this.pending&&now-this.pending.started>BATCH_TIMEOUT_MS){this.reset();throw new Error('Batch transfer timed out');}
  }
  accept(text:string,now=Date.now()):Record<string,unknown>|undefined {
    try {
      this.checkTimeout(now);
      if(byteLength(text)>MAX_FRAME_BYTES)throw new Error('WebSocket message exceeds batch frame limit');
      const value=JSON.parse(text);
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Object required');
      if(!('batch' in value)){
        if(this.pending)throw new Error('Incomplete batch transfer');
        return value;
      }
      const {batch,id,index,total,data}=value;
      if(batch!==1||typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id)||!Number.isInteger(index)||!Number.isInteger(total)||total<2||total>MAX_BATCH_PARTS||index<0||index>=total||typeof data!=='string'||!data.length||data.length>CHUNK_CHARS)throw new Error('Invalid batch frame');
      if(!this.pending){if(index!==0)throw new Error('Batch must start at zero');this.pending={id,total,parts:[],bytes:0,started:now};}
      const p=this.pending;
      if(p.id!==id||p.total!==total||p.parts.length!==index)throw new Error('Out-of-order batch frame');
      p.bytes+=byteLength(data);if(p.bytes>MAX_MESSAGE_BYTES)throw new Error('Batch exceeds 32 MiB transfer limit');
      p.parts.push(data);
      if(p.parts.length!==total)return;
      const combined=p.parts.join('');this.reset();const message=JSON.parse(combined);
      if(!message||typeof message!=='object'||Array.isArray(message)||'batch' in message)throw new Error('Invalid assembled message');
      return message;
    }catch(error){this.reset();throw error;}
  }
}
