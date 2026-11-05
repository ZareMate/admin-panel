import test from 'node:test';
import assert from 'node:assert/strict';
import {MapHeadLoader} from '../client/map-heads.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function until(check:()=>boolean) {
 const end=Date.now()+2000;while(!check()&&Date.now()<end)await tick();assert(check(),'head loading completed');
}
function bitmap(onClose=()=>{}) {return {close:onClose} as ImageBitmap;}

test('map movement preserves pending head requests and drains a two-request queue',async()=>{
 const requests:{url:string;signal:AbortSignal;finish:(response:Response)=>void}[]=[];
 const images=new Map<string,ImageBitmap>();let closed=0;
 const loader=new MapHeadLoader(images,()=>{},(async(input,options)=>new Promise<Response>(resolve=>{
  requests.push({url:String(input),signal:options!.signal!,finish:resolve});
 })) as typeof fetch,async()=>bitmap(()=>closed++));
 try{
  loader.update(['Alice','Bob','Creeper']);assert.equal(requests.length,2);
  loader.update(['Bob','Creeper','Delta']);
  assert(requests.every(request=>!request.signal.aborted),'visibility changes must not cancel pending downloads');
  assert.equal(requests.length,2);
  requests[0]!.finish(new Response(new Uint8Array([1])));await until(()=>requests.length===3);
  requests[1]!.finish(new Response(new Uint8Array([1])));await until(()=>requests.length===4);
  requests[2]!.finish(new Response(new Uint8Array([1])));requests[3]!.finish(new Response(new Uint8Array([1])));
  await until(()=>images.size===4);
  assert.equal(new Set(requests.map(request=>request.url)).size,4,'no duplicate in-flight head downloads');
 }finally{loader.dispose();}
 assert.equal(closed,4);assert.equal(images.size,0);
});

test('transient head failures retry without requiring map movement or a reload',async()=>{
 let calls=0,changed=0;
 const images=new Map<string,ImageBitmap>();
 const loader=new MapHeadLoader(images,()=>changed++,(async()=>{
  calls++;return calls===1?new Response('busy',{status:503}):new Response(new Uint8Array([1]));
 }) as typeof fetch,async()=>bitmap(),5);
 try{
  loader.update(['Explorer','../bad','NameThatIsFarTooLongForMinecraft']);
  await until(()=>images.has('Explorer'));
  assert.equal(calls,2);assert.equal(changed,1);
 }finally{loader.dispose();}
});

test('map bitmap cache refreshes after the shared two-hour skin lifetime',async()=>{
 const {SKIN_CACHE_MS}=await import('../src/skin.js');
 let now=Date.now(),calls=0,closed=0;const images=new Map<string,ImageBitmap>();
 const loader=new MapHeadLoader(images,()=>{},(async()=>{calls++;return new Response(new Uint8Array([1]));}) as typeof fetch,async()=>bitmap(()=>closed++),5,()=>now);
 try{
  loader.update(['Explorer']);await until(()=>images.has('Explorer'));assert.equal(calls,1);
  now+=SKIN_CACHE_MS+1;loader.update(['Explorer']);await until(()=>calls===2&&images.has('Explorer'));
  assert.equal(closed,1);
 }finally{loader.dispose();}
});
