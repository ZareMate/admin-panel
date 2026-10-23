import test from 'node:test';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { batchFrames, BatchReceiver, byteLength, CHUNK_CHARS, MAX_FRAME_BYTES, MAX_MESSAGE_BYTES, BATCH_TIMEOUT_MS } from '../src/batches.js';
import { BatchSender } from '../src/batch-sender.js';
import { WebSocket } from 'ws';

test('batch frames preserve Unicode and escaped JSON within the wire limit, publishing only complete messages',()=>{
 const payload={text:'a'.repeat(CHUNK_CHARS-10)+'😀漢字\\"\n'.repeat(30000)};
 const frames=[...batchFrames(JSON.stringify(payload),'transfer')],receiver=new BatchReceiver();
 assert(frames.length>2);
 for(const [index,frame] of frames.entries()){
  assert(byteLength(frame)<MAX_FRAME_BYTES);
  const chunk=JSON.parse(frame).data as string;
  assert(!/[\uD800-\uDBFF]$/.test(chunk));assert(!/^[\uDC00-\uDFFF]/.test(chunk));
  const result=receiver.accept(frame);if(index<frames.length-1)assert.equal(result,undefined);else assert.deepEqual(result,payload);
 }
 assert.deepEqual(receiver.accept('{"small":true}'),{small:true});
});
test('batch receiver rejects gaps, duplicates, mixed IDs/counts, oversized frames, corrupt JSON, and stale transfers',()=>{
 const frames=[...batchFrames(JSON.stringify({text:'x'.repeat(20000)}),'batch')];
 for(const bad of [frames[0]!,frames[2]!,JSON.stringify({...JSON.parse(frames[1]!),id:'other'}),JSON.stringify({...JSON.parse(frames[1]!),total:8}),'{"other":true}']){
  const receiver=new BatchReceiver();receiver.accept(frames[0]!);assert.throws(()=>receiver.accept(bad));
  assert.deepEqual(receiver.accept('{"fresh":true}'),{fresh:true},'failure clears partial data');
 }
 const receiver=new BatchReceiver();assert.throws(()=>receiver.accept(frames[1]!));
 receiver.accept(frames[0]!,0);assert.throws(()=>receiver.checkTimeout(BATCH_TIMEOUT_MS+1),/timed out/);
 receiver.accept(frames[0]!);receiver.reset();assert.throws(()=>receiver.accept(frames[1]!));
 for(const frame of [{batch:2,id:'x',index:0,total:2,data:'x'},{batch:1,id:'x',index:0,total:999999,data:'x'},{batch:1,id:'x',index:0,total:2,data:''},{batch:1,id:'x',index:0,total:2,data:'x'.repeat(CHUNK_CHARS+1)}])assert.throws(()=>receiver.accept(JSON.stringify(frame)));
 assert.throws(()=>receiver.accept(JSON.stringify({text:'x'.repeat(MAX_FRAME_BYTES)})),/frame limit/);
 receiver.accept(JSON.stringify({batch:1,id:'x',index:0,total:2,data:'{'}));assert.throws(()=>receiver.accept(JSON.stringify({batch:1,id:'x',index:1,total:2,data:'invalid}'})));
});
test('aggregate transfers are bounded even when every frame is small',()=>{
 assert.throws(()=>[...batchFrames('x'.repeat(MAX_MESSAGE_BYTES+1),'oversize')],/32 MiB/);
 const receiver=new BatchReceiver(),total=MAX_MESSAGE_BYTES/CHUNK_CHARS+1;
 for(let index=0;index<total-1;index++)receiver.accept(JSON.stringify({batch:1,id:'large',index,total,data:'x'.repeat(CHUNK_CHARS)}));
 assert.throws(()=>receiver.accept(JSON.stringify({batch:1,id:'large',index:total-1,total,data:'x'.repeat(CHUNK_CHARS)})),/32 MiB/);
});
test('sender awaits each frame write, serializes messages, and stops when authorization is lost',async()=>{
 const frames:string[]=[],callbacks:((error?:Error)=>void)[]=[];
 const socket={readyState:WebSocket.OPEN,send:(frame:string,callback:(error?:Error)=>void)=>{frames.push(frame);callbacks.push(callback);}} as unknown as WebSocket;
 let allowed=true,failures=0;const sender=new BatchSender(socket,()=>allowed,()=>{failures++;});
 sender.send({text:'a'.repeat(20000)});sender.send({next:true});assert.equal(frames.length,1);
 const receiver=new BatchReceiver();let complete=0;
 while(callbacks.length){const frame=frames.at(-1)!;if(receiver.accept(frame))complete++;callbacks.shift()!();await new Promise(r=>setImmediate(r));}
 assert.equal(complete,2);assert.equal(failures,0);
 sender.send({text:'b'.repeat(20000)});const before=frames.length;allowed=false;callbacks.shift()!();await new Promise(r=>setImmediate(r));assert.equal(frames.length,before);sender.close();
});

test('bridge drops partial transfers on disconnect and rejects invalid frame sequences',async()=>{
 const {fixture,connect}=await import('./helpers.js');
 const f=await fixture();try{
  const frame=(id:string,index:number,data:string)=>JSON.stringify({batch:1,id,index,total:2,data});
  let started!:()=>void;const start=new Promise<void>(resolve=>{started=resolve;});
  const game=await connect(f,(request,ws)=>{ws.send(frame('partial',0,'{"id":"'+request.id+'","result":'));started();});
  const pending=f.bridge.players(),failed=assert.rejects(pending,/disconnected/);await start;
  game.close();await once(game,'close');await failed;
  const replacement=await connect(f,(request,ws)=>ws.send(JSON.stringify({id:request.id,result:{fresh:true}})));
  assert.deepEqual(await f.bridge.players(),{fresh:true});
  const closed=once(replacement,'close');replacement.send(frame('out-of-order',1,'{}'));assert.equal((await closed)[0],1007);
 }finally{await f.close();}
});
