import { DiscordText } from './DiscordText';
import { TicketMedia, type MediaAttachment } from './TicketMedia';
import { useEffect, useRef, useState } from 'react';
import type { Api } from './types';
export interface TicketRow {id:string;guildId:string;name:string;tags:string[]}
interface Message {rawContent?:string;mentions?:Record<string,string>;id:string;author:string;username?:string;avatarUrl?:string;bot:boolean;content:string;createdAt:number;editedAt?:number;attachments:MediaAttachment[];embeds:{rawTitle?:string;rawDescription?:string;title?:string;description?:string;fields:{rawName?:string;rawValue?:string;name:string;value:string}[];image?:MediaAttachment;thumbnail?:MediaAttachment;video?:MediaAttachment}[]}
interface History {messages:Message[];hasMore:boolean}

export function TicketAvatar({name,url}:{name:string;url?:string}) {
 const [failed,setFailed]=useState<string>();
 let safe:string|undefined;try{const u=new URL(url??'');if(u.protocol==='https:'&&u.hostname==='cdn.discordapp.com'&&!u.username&&!u.password)safe=u.href;}catch{/* Keep initials for missing avatars. */}
 return <div className="ticket-avatar" aria-hidden="true">{safe&&failed!==safe?<img src={safe} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(safe)}/>:name.slice(0,2).toUpperCase()}</div>;
}
function requestId(){const bytes=crypto.getRandomValues(new Uint8Array(16));return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('').replace(/^(........)(....)(....)(....)(............)$/,'$1-$2-$3-$4-$5');}
export function TicketConversation({ticket,api,canReply,onBack,apiBase='/tickets',readOnlyMessage='Read-only access. Your rank needs “Reply to permitted tickets” to respond.'}:{ticket:TicketRow;api:Api;canReply:boolean;onBack:()=>void;apiBase?:string;readOnlyMessage?:string}) {
 const [messages,setMessages]=useState<Message[]>([]),[loading,setLoading]=useState(true),[more,setMore]=useState(false),[older,setOlder]=useState(false),[error,setError]=useState(''),[draft,setDraft]=useState(''),[sending,setSending]=useState(false),[sendError,setSendError]=useState(''),[notice,setNotice]=useState('');
 const attempt=useRef<{text:string;id:string}|undefined>(undefined),alive=useRef(true),scroll=useRef<HTMLDivElement>(null),follow=useRef(true);
 const merge=(rows:Message[])=>setMessages(old=>[...new Map([...old,...rows].map(m=>[m.id,m])).values()].sort((a,b)=>a.createdAt-b.createdAt));
 useEffect(()=>{
  alive.current=true;let stopped=false,busy=false,first=true;
  const load=async()=>{if(busy)return;busy=true;try{const result=await api<History>(apiBase+'/'+ticket.id+'/messages');if(!stopped){merge(result.messages);if(first){setMore(result.hasMore);first=false;}setError('');}}catch(e){if(!stopped)setError((e as Error).message);}finally{busy=false;if(!stopped)setLoading(false);}};
  void load();const timer=setInterval(()=>{if(!document.hidden)void load();},10000);
  return()=>{stopped=true;alive.current=false;clearInterval(timer);};
 },[api,ticket.id,apiBase]);
 useEffect(()=>{if(follow.current)scroll.current?.scrollTo({top:scroll.current.scrollHeight});},[messages]);
 return <section className="ticket-conversation" aria-label="Ticket conversation">
 <header className="ticket-conversation-heading"><div><button className="ticket-back" onClick={onBack}>← All tickets</button><h2>{ticket.name}</h2><div className="ticket-tags">{ticket.tags.map(tag=><span key={tag}>{tag}</span>)}</div></div><a className="secondary small" href={`https://discord.com/channels/${ticket.guildId}/${ticket.id}`} target="_blank" rel="noreferrer">Open Discord ↗</a></header>
 <div className="ticket-messages" ref={scroll} onScroll={()=>{const el=scroll.current!;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}}>
 {error&&<p className="banner error" role="alert">{error}</p>}
 {loading?<p className="empty">Loading conversation…</p>:<>
 {more&&<button className="secondary ticket-older" disabled={older} onClick={async()=>{setOlder(true);follow.current=false;const el=scroll.current,height=el?.scrollHeight??0;try{const page=await api<History>(apiBase+'/'+ticket.id+'/messages?before='+messages[0]!.id);if(alive.current){merge(page.messages);setMore(page.hasMore);requestAnimationFrame(()=>{if(el)el.scrollTop=el.scrollHeight-height;});}}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setOlder(false);}}}>{older?'Loading…':'Load earlier messages'}</button>}
 {!messages.length&&!error&&<div className="empty"><h3>Start the conversation</h3><p>No messages in this ticket yet.</p></div>}
 {messages.map(m=><article className={'ticket-message '+(m.bot?'ticket-message-bot':'')} key={m.id}><TicketAvatar name={m.author} url={m.avatarUrl}/><div className="ticket-message-body"><div className="ticket-message-meta"><strong title={m.username?'@'+m.username:undefined}>{m.author}</strong>{m.bot&&<span className="ticket-bot-label">BOT</span>}<time dateTime={new Date(m.createdAt).toISOString()}>{new Date(m.createdAt).toLocaleString()}</time>{m.editedAt&&<small>edited</small>}</div><div className="ticket-message-content"><DiscordText text={m.rawContent??m.content??''} mentions={m.mentions}/></div>{m.embeds.map((e,i)=><blockquote className="ticket-embed" key={i}>{e.title&&<DiscordText text={e.rawTitle??e.title} mentions={m.mentions}/>}{e.description&&<DiscordText text={e.rawDescription??e.description} mentions={m.mentions}/>}{e.fields.map((f,j)=><div key={j}><DiscordText text={f.rawName??f.name} mentions={m.mentions}/><DiscordText text={f.rawValue??f.value} mentions={m.mentions}/></div>)}{e.video?<TicketMedia attachment={e.video}/>:e.image?<TicketMedia attachment={e.image}/>:e.thumbnail?<TicketMedia attachment={e.thumbnail}/>:null}</blockquote>)}{m.attachments.map((a,i)=><TicketMedia key={i} attachment={a}/>)}</div></article>)}
 </>}
 </div>
 <form className="ticket-composer" onSubmit={async e=>{e.preventDefault();if(sending||!draft.trim())return;const text=draft;if(attempt.current?.text!==text)attempt.current={text,id:requestId()};setSending(true);setSendError('');setNotice('');try{const result=await api<History>(apiBase+'/'+ticket.id+'/reply',{content:text},attempt.current.id);if(alive.current){follow.current=true;merge(result.messages);setDraft('');attempt.current=undefined;setNotice('Reply sent to Discord.');}}catch(e){if(alive.current)setSendError((e as Error).message);}finally{if(alive.current)setSending(false);}}}>
 {canReply?<><label htmlFor="ticket-reply">Reply to this ticket</label><textarea id="ticket-reply" placeholder="Write a helpful reply…" value={draft} maxLength={1800} disabled={sending} onChange={e=>{setDraft(e.target.value);setNotice('');}} rows={3}/><div className="ticket-composer-footer"><span>Sent by the bot with your staff name · {draft.length}/1800</span><button className="primary" disabled={sending||!draft.trim()}>{sending?'Sending…':'Send reply →'}</button></div></>:<p className="muted">{readOnlyMessage}</p>}
 {sendError&&<p className="error" role="alert">{sendError} Your draft has been kept.</p>}<p className="ticket-send-status" role="status">{notice}</p>
 </form></section>;
}
