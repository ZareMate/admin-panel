import {ToggleSelector} from './Selectors';
import { useEffect, useState } from 'react';
import { TicketConversation, type TicketRow } from './TicketConversation';
import type { Api } from './types';
interface Result {mentions?:Record<string,number>;counts?:Record<string,number>;categories:{id:string;label:string}[];category:string|null;tickets:{id:string;guildId:string;name:string;tags:string[];mentioned?:boolean}[];total:number;updatedAt:number;stale:boolean}
export function Tickets({api,canReply}:{api:Api;canReply:boolean}) {
 const [selected,setSelected]=useState<TicketRow|null>(null),[search,setSearch]=useState('');
 const [category,setCategory]=useState(''),[offset,setOffset]=useState(0),[data,setData]=useState<Result|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  let stopped=false;
  const load=async()=>{try{const result=await api<Result>('/tickets?offset='+offset+(category?'&category='+encodeURIComponent(category):''));if(!stopped){setData(result);setError('');}}catch(e){if(!stopped){setData(null);setError((e as Error).message);}}};
  void load();const timer=setInterval(()=>void load(),15000);
  return()=>{stopped=true;clearInterval(timer);};
 },[api,category,offset,refresh]);
 return <section className="card" id="tickets"><div className="section-header"><h2>Tickets</h2><button className="secondary" onClick={()=>setRefresh(v=>v+1)}>Refresh tickets</button></div>
 {error&&<p className="error" role="alert">{error}</p>}
 {!error&&!data&&<p className="loading">Loading tickets…</p>}
 {data&&<><ToggleSelector label="Ticket categories" className="ticket-category-selector" options={data.categories.map(c=>({value:c.id,className:(data.mentions?.[c.id]??0)>0?'ticket-personal-mention':'',title:(data.mentions?.[c.id]??0)>0?'You are mentioned in this category':undefined,label:<>{c.label}{(data.counts?.[c.id]??0)>0&&<span className="count ticket-category-count">{data.counts![c.id]}</span>}</>}))} value={category||data.category||''} onChange={value=>{setCategory(value);setOffset(0);setSelected(null);setSearch('');}}/>
 {!data.categories.length?<p className="empty">Your rank has no ticket category permissions.</p>:<>
 <p className="notice">{data.stale?'Ticket sync unavailable or stale. ':''}{data.updatedAt?'Last synced '+new Date(data.updatedAt).toLocaleString():'Waiting for the Discord bot.'}</p>
 <div className={'ticket-workspace '+(selected?'has-conversation':'')}><aside className="ticket-inbox"><div className="ticket-inbox-heading"><strong>Inbox</strong><span className="pill">{data.total}</span></div><input className="ticket-search" aria-label="Search tickets on this page" placeholder="Search this page…" value={search} onChange={e=>setSearch(e.target.value)}/>
 <div className="ticket-list">{data.tickets.filter(t=>t.name.toLowerCase().includes(search.toLowerCase())).map(t=><div key={t.id} className={'ticket-list-row '+(selected?.id===t.id?'active ':'')+(t.mentioned?'ticket-personal-mention':'')}><button onClick={()=>setSelected(t)}><span className="ticket-row-icon">#</span><span><strong>{t.name}{t.mentioned&&<span className="ticket-mention-label">Mentions you</span>}</strong><small>{t.tags.join(' · ')||'Support conversation'}</small></span><span>›</span></button><a className="ticket-discord-link" href={'https://discord.com/channels/'+t.guildId+'/'+t.id} target="_blank" rel="noreferrer">Open ticket ↗</a></div>)}
 {!data.tickets.length&&<p className="empty">No tickets in this category.</p>}
 {data.tickets.length>0&&!data.tickets.some(t=>t.name.toLowerCase().includes(search.toLowerCase()))&&<p className="empty">No matching tickets on this page.</p>}</div>
 <div className="ticket-pagination"><button className="secondary small" disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous</button><span>{Math.floor(offset/50)+1} / {Math.max(1,Math.ceil(data.total/50))}</span><button className="secondary small" disabled={offset+50>=data.total} onClick={()=>setOffset(offset+50)}>Next</button></div></aside>
 {selected?<TicketConversation key={selected.id} ticket={selected} api={api} canReply={canReply} onBack={()=>setSelected(null)}/>:<div className="ticket-welcome"><span className="ticket-welcome-icon">✉</span><h2>A little help goes a long way</h2><p>Select a ticket to read the conversation<br/>and help a player get back to their adventure.</p><span className="pill">{data.total} tickets in this category</span></div>}
 </div>
 </>}</>}
 </section>;
}
