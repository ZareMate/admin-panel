import {useEffect,useState} from 'react';
import type {Api,Session,Slot,StorageSection} from './types';
import {Avatar,date} from './App';
import {Item} from './PlayerDetail';
import {has} from '../src/permissions';
type Identity={uuid:string;name:string;type:string;player:boolean};
type Death={id:string;at:number;victim:Identity;killer:Identity|null;attribution:string;directEntity?:Identity;cause:string;message:string;weapon:Slot&{customName?:string};dimension:string;x:number;y:number;z:number;keepInventory:boolean;experienceLevel:number;totalExperience:number;inventory?:{inventory:StorageSection;curios:StorageSection}};
function DeathDetails({id,api,canInventory}:{id:string;api:Api;canInventory:boolean}) {
 const [death,setDeath]=useState<Death|null>(null),[icons,setIcons]=useState<Record<string,string>>({}),[error,setError]=useState('');
 useEffect(()=>{
  let active=true;
  void api<Death>('/kill-feed/'+id).then(async result=>{
   if(!active)return;setDeath(result);
   const items=[result.weapon,...Object.values(result.inventory??{}).flatMap(section=>section.groups?.flatMap(group=>group.slots)??[])];
   const ids=[...new Set(items.filter(item=>!item.empty).map(item=>item.id))];
   try{const loaded:Record<string,string>={};for(let i=0;i<ids.length;i+=64)Object.assign(loaded,await api('/icons',{ids:ids.slice(i,i+64)}));if(active)setIcons(loaded);}
   catch{if(active)setError('Item icons could not load. Item names and details remain available.');}
  }).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[id,api]);
 return <div className="kill-feed-details">
  {error&&<p role="alert" className="error">{error}</p>}
  {!death?<p>Loading death snapshot…</p>:<>
   <p>{death.message}</p><p className="muted">{death.cause} · {death.dimension} · {Math.round(death.x)}, {Math.round(death.y)}, {Math.round(death.z)}</p>
   {death.attribution==='combat-credit'&&<p className="notice">Killer credited from recent combat; the final damage was {death.cause}.</p>}
   {death.directEntity&&<p>Direct source: {death.directEntity.name} ({death.directEntity.type})</p>}
   <h3>Weapon at death</h3>{death.weapon.empty?<p>No weapon reported by the damage source.</p>:<div className="storage-grid"><Item slot={{...death.weapon,label:'Weapon'}} icon={icons[death.weapon.id]}/></div>}
   <h3>Victim's carried items at death</h3>
   <p className="muted">Captured before drops. Keep inventory: {death.keepInventory?'enabled':'disabled'} · XP level {death.experienceLevel} · Total XP {death.totalExperience}</p>
   {!canInventory?<p>Permission required: View victim inventory at death.</p>:!death.inventory?<p>Inventory snapshot unavailable.</p>:Object.entries(death.inventory).map(([key,section])=><section key={key} className="storage-group">
    <h3>{key==='curios'?'Curios':'Inventory, armor and offhand'}</h3>
    {!section.available?<p className="muted">{section.reason||'Unavailable'}</p>:section.groups?.map((group,i)=><div key={i}><h4>{group.name}</h4><div className="storage-grid">{group.slots.map((slot,j)=><Item key={j} slot={slot} icon={icons[slot.id]}/>)}</div></div>)}
   </section>)}
  </>}
 </div>;
}
export function KillFeed({api,session}:{api:Api;session:Session}) {
 const [entries,setEntries]=useState<Death[]>([]),[total,setTotal]=useState(0),[offset,setOffset]=useState(0);
 const [query,setQuery]=useState(''),[search,setSearch]=useState(''),[expanded,setExpanded]=useState(''),[error,setError]=useState('');
 useEffect(()=>{if(query===search)return;const timer=setTimeout(()=>{setSearch(query);setOffset(0);setExpanded('');},300);return()=>clearTimeout(timer);},[query,search]);
 useEffect(()=>{
  let active=true;
  const load=async()=>{try{const result=await api<{entries:Death[];total:number}>('/kill-feed?offset='+offset+'&limit=25&q='+encodeURIComponent(search));if(active){setEntries(result.entries);setTotal(result.total);setError('');}}catch(e){if(active)setError((e as Error).message);}};
  void load();const timer=setInterval(()=>{if(!document.hidden)void load();},5000);return()=>{active=false;clearInterval(timer);};
 },[api,offset,search]);
 return <section id="kill-feed">
  <div className="card kill-feed-toolbar"><label>Search deaths<input type="search" maxLength={128} placeholder="Killer, victim, weapon or cause" value={query} onChange={event=>setQuery(event.target.value)}/></label><span className="muted">{total} recorded deaths · refreshes every 5 seconds</span></div>
  {error&&<p role="alert" className="banner error">{error}</p>}
  {!entries.length&&!error&&<p className="card empty">No recorded deaths{search?' match this search':'. New deaths appear after the updated mod is installed'}.</p>}
  <div className="kill-feed-entries">{entries.map(death=><article className="card kill-feed-entry" key={death.id}>
   <button className="kill-feed-summary" aria-expanded={expanded===death.id} onClick={()=>setExpanded(old=>old===death.id?'':death.id)}>
    {death.killer?.player&&<Avatar name={death.killer.name} uuid={death.killer.uuid}/>}
    {death.victim.player&&<Avatar name={death.victim.name} uuid={death.victim.uuid}/>}
    <span><strong>{death.killer?.name||'Environment'} → {death.victim.name}</strong><small>{death.cause}{!death.weapon.empty?' · '+death.weapon.name:''}</small><small>{date(death.at)}</small></span>
   </button>
   {expanded===death.id&&<DeathDetails key={death.id} id={death.id} api={api} canInventory={has(session,'killFeed.inventory')}/>}
  </article>)}</div>
  <div className="kill-feed-pagination"><button className="secondary" disabled={offset===0} onClick={()=>{setOffset(old=>Math.max(0,old-25));setExpanded('');}}>Previous deaths</button><span>{total?offset+1:0}–{Math.min(offset+25,total)} / {total}</span><button className="secondary" disabled={offset+25>=total} onClick={()=>{setOffset(old=>old+25);setExpanded('');}}>Next deaths</button></div>
 </section>;
}
