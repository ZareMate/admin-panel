import {useState} from 'react';
export interface NbtNode {type:string;value:string|Record<string,NbtNode>|NbtNode[];truncated?:boolean}
function Branch({name,node}:{name:string;node:NbtNode}) {
 const [open,setOpen]=useState(false);
 const children=typeof node.value==='object';
 if(!children)return <div className="nbt-leaf"><strong>{name}</strong> <small>{node.type}</small> <code>{node.type==='string'?JSON.stringify(node.value):String(node.value)}</code>{node.truncated&&<span className="muted"> · Snapshot limit reached</span>}</div>;
 const entries=Array.isArray(node.value)?node.value.map((value,index)=>[String(index),value] as const):Object.entries(node.value);
 return <details className="nbt-branch" onToggle={event=>{if(event.target===event.currentTarget)setOpen(event.currentTarget.open);}}>
  <summary><strong>{name}</strong> <small>{node.type} · {entries.length} entries</small></summary>
  {open&&<div className="nbt-children">{entries.map(([key,value])=><Branch key={key} name={key} node={value}/>)}{node.truncated&&<p className="muted">Additional NBT data exceeded the snapshot limit.</p>}</div>}
 </details>;
}
export function ItemNbt({data,error}:{data?:NbtNode;error?:string}) {
 return <div className="item-nbt">{data?<Branch name="NBT data" node={data}/>:<p className="muted">{error||'NBT was not recorded for this item snapshot.'}</p>}</div>;
}
