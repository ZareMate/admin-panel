import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Slot} from './types';
import {ItemNbt} from './ItemNbt';
let topWindow=1000,placement=0;
const windows=new Set<number>();
export function ItemWindow({slot,icon,close}:{slot:Slot;icon?:string;close:()=>void}) {
 const ref=useRef<HTMLDivElement>(null),title=useId();
 const [z,setZ]=useState(()=>++topWindow),[copied,setCopied]=useState('');
 const [position,setPosition]=useState(()=>{const offset=(placement++%6)*28;return {x:Math.max(8,Math.min(window.innerWidth-440,80+offset)),y:70+offset};});
 const drag=useRef<{x:number;y:number;left:number;top:number}|null>(null);
 const clamp=(x:number,y:number)=>({x:Math.max(8,Math.min(x,window.innerWidth-(ref.current?.offsetWidth??420)-8)),y:Math.max(8,Math.min(y,window.innerHeight-Math.min(ref.current?.offsetHeight??200,window.innerHeight-16)-8))});
 useEffect(()=>{const resize=()=>setPosition(old=>clamp(old.x,old.y));resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
 useEffect(()=>{windows.add(z);const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&z===Math.max(...windows)){event.stopImmediatePropagation();close();}};window.addEventListener('keydown',escape);return()=>{windows.delete(z);window.removeEventListener('keydown',escape);};},[z,close]);
 return createPortal(<div ref={ref} className="item-window" role="dialog" aria-modal="false" aria-labelledby={title} style={{left:position.x,top:position.y,maxHeight:`calc(100dvh - ${position.y+8}px)`,zIndex:z}} onPointerDownCapture={()=>setZ(++topWindow)}>
  <div className="item-window-header" onPointerDown={event=>{if((event.target as HTMLElement).closest('button'))return;event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,y:event.clientY,left:position.x,top:position.y};}} onPointerMove={event=>{const start=drag.current;if(start)setPosition(clamp(start.left+event.clientX-start.x,start.top+event.clientY-start.y));}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
   <strong id={title}>{slot.name}</strong><button className="icon-button" aria-label="Close item details" onClick={close}>×</button>
  </div><div className="item-window-content"><div className="item-window-summary"><span className="item-art">{icon&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(icon)?<img src={icon} alt=""/>:'◇'}</span><div><strong>{slot.name} ×{slot.count}</strong><p className="muted">{slot.label} · Snapshot at opening</p></div></div><code>{slot.id}</code>
   {slot.maxDamage>0&&<p>Durability: {Math.max(0,slot.maxDamage-slot.damage)} / {slot.maxDamage}</p>}{slot.enchantments?.map((text,i)=><p className="enchantment" key={i}>{text}</p>)}{slot.lore?.map((text,i)=><p key={i}>{text}</p>)}
   <div className="item-window-tools"><button className="secondary small" disabled={!slot.nbt} onClick={async()=>{try{await navigator.clipboard.writeText(JSON.stringify(slot.nbt,null,2));setCopied('Copied');}catch{setCopied('Could not copy');}}}>Copy NBT JSON</button><span role="status">{copied}</span></div><ItemNbt data={slot.nbt} error={slot.nbtError}/>
  </div></div>,document.body);
}
