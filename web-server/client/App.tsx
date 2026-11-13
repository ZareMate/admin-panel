import { DnsConfiguration } from './DnsConfiguration';
import {calculateCheatStats,type CheatSnapshot} from './cheat-stats';
import {useSlidingSelector} from './useSlidingSelector';
import {ToggleSelector,SelectField} from './Selectors';
import {useTabTransition} from './useTabTransition';
import {AuditLog} from './AuditLog';
import MenuOpenOutlined from '@mui/icons-material/MenuOpenOutlined';
import MenuOutlined from '@mui/icons-material/MenuOutlined';
import {TabIcon} from './TabIcon';
import {KillFeed} from './KillFeed';
import {useSkinImage} from './useSkinImage';
import {validSkinIdentity} from '../src/skin';
import { PlayerMap } from './PlayerMap';
import { TsaConfiguration } from './TsaConfiguration';
import { CheatStatistics } from './CheatStatistics';
import { PermissionPicker } from './PermissionPicker';
import { Todos } from './Todos';
import { Suggestions } from './Suggestions';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Api, Session, Players, Detail, AuditRow, Rank } from './types';
import { Tickets } from './Tickets';
import { PlayerDetail, type Action } from './PlayerDetail';
import { has } from '../src/permissions';
import { BatchReceiver } from '../src/batches';
export const date=(value?:number)=>value?new Date(value).toLocaleString():'—';
export const displayName=(name:string)=>name.replace(/ \[\d{17,20}\]$/,'');
export function Avatar({name,uuid}:{name:string;uuid?:string}) {
  const {loaded,...image}=useSkinImage('head',uuid||name);
  return <span className={'avatar player-head'+(loaded?' head-loaded':'')}>
    {validSkinIdentity(uuid||name)&&<img {...image} alt="" loading="lazy"/>}
    <span className="head-fallback">{name.slice(0,2).toUpperCase()}</span></span>;
}
export function Pairs({rows}:{rows:[string,ReactNode][]}) {return <dl>{rows.map(([k,v])=><div className="pair" key={k}><dt>{k}</dt><dd>{v??'—'}</dd></div>)}</dl>;}
export function Info({title,children,wide=false}:{title:string;children:ReactNode;wide?:boolean}){return <article className={'info-card'+(wide?' wide':'')}><h3>{title}</h3>{children}</article>;}
export function App() {
  const [sidebarCollapsed,setSidebarCollapsed]=useState(()=>{try{return localStorage.getItem('panel.sidebarCollapsed')==='true';}catch{return false;}});
  useEffect(()=>{try{localStorage.setItem('panel.sidebarCollapsed',String(sidebarCollapsed));}catch{/* Storage may be disabled by the browser. */}},[sidebarCollapsed]);
  const [session,setSession]=useState<Session|null>(null),[mode,setMode]=useState(''),[booted,setBooted]=useState(false);
  const [error,setError]=useState(''),[loginError,setLoginError]=useState(new URLSearchParams(location.search).get('loginError')||'');
  const [players,setPlayers]=useState<Players>({players:[],serverPlayers:0,maxPlayers:0,punishAvailable:false});
  const [selected,setSelected]=useState<string|null>(null),[detail,setDetail]=useState<Detail|null>(null),[loading,setLoading]=useState(false);
  const [staffFilter,setStaffFilter]=useState('all'),[detectionFilter,setDetectionFilter]=useState('all');
  const [playerRanks,setPlayerRanks]=useState<{ranks:string[];players:{uuid:string;rank?:string|null}[]}>({ranks:[],players:[]});
  const [rankError,setRankError]=useState('');
  const [filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[view,setView]=useState('players');
  const pageTransition=useTabTransition(view);
  const sidebarSlider=useSlidingSelector(view+':'+sidebarCollapsed+':'+!!session);
  const [connected,setConnected]=useState(false),[updated,setUpdated]=useState<number>();
  const [audit,setAudit]=useState<AuditRow[]>([]),[ranks,setRanks]=useState<Rank[]>([]),[rankMessage,setRankMessage]=useState('');
  const [tsaRefresh,setTsaRefresh]=useState(0);
  const [busy,setBusy]=useState(false),[action,setAction]=useState<Action|null>(null);
  const liveSocket=useRef<WebSocket|null>(null),liveHealthy=useRef(false),selectedRef=useRef(selected),actionRef=useRef(action),viewRef=useRef(view);
  selectedRef.current=selected;actionRef.current=action;viewRef.current=view;
  const playersVersion=useRef(0),refreshBusy=useRef(false),detailVersion=useRef(0),sessionRef=useRef(session);sessionRef.current=session;
  const api:Api=useCallback(async<T,>(path:string,body?:unknown,requestId?:string):Promise<T>=>{
    const headers:Record<string,string>={};
    if(body!==undefined){headers['Content-Type']='application/json';if(sessionRef.current)headers['X-CSRF-Token']=sessionRef.current.csrf;if(requestId)headers['X-Request-ID']=requestId;}
    const response=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'same-origin'});
    const data=await response.json();
    if(!response.ok){if(response.status===401&&path!=='/login'){setSession(null);setDetail(null);setSelected(null);setAction(null);detailVersion.current++;}throw new Error(data.error||'Request failed');}return data as T;
  },[]);
  const loadPlayer=useCallback(async(id:string,reset=false)=>{
    const version=++detailVersion.current;
    if(reset){setSelected(id);setDetail(null);setLoading(true);}
    try{const result=await api<Detail>('/players/'+id);if(version===detailVersion.current)setDetail(result);}
    finally{if(version===detailVersion.current)setLoading(false);}
  },[api]);
  const refresh=useCallback(async()=>{
    if(!sessionRef.current||refreshBusy.current)return;
    refreshBusy.current=true;const version=playersVersion.current;
    try{
      const current=await api<Session>('/session');setSession(current);if(!has(current,'tab.players'))return;
      const result=await api<Players>('/players');if(version===playersVersion.current){setPlayers(result);setConnected(true);setUpdated(Date.now());setError('');}
      if(selected&&!action)await loadPlayer(selected);
    }catch(e){if(version===playersVersion.current){setConnected(false);setError((e as Error).message);}}finally{refreshBusy.current=false;}
  },[api,selected,action,loadPlayer]);
  useEffect(()=>{void(async()=>{try{setMode((await api<{mode:string}>('/auth/method')).mode);setSession(await api<Session>('/session'));}catch(e){if(!(e as Error).message.includes('sign in'))setLoginError((e as Error).message);}finally{setBooted(true);}})();
    if(location.search)history.replaceState(null,'','/');
  },[api]);
  const signedIn=!!session;
  useEffect(()=>{
    if(!signedIn||!has(sessionRef.current,'tab.players'))return;
    let stopped=false;
    const load=()=>{void api<typeof playerRanks>('/player-ranks').then(value=>{if(!stopped){setPlayerRanks(value);setRankError('');}}).catch(()=>{if(!stopped){setPlayerRanks({ranks:[],players:[]});setRankError('Staff ranks unavailable. Check the Discord bot connection.');}});};
    load();const timer=setInterval(load,120000);return()=>{stopped=true;clearInterval(timer);};
  },[signedIn,api]);

  useEffect(()=>{if(!signedIn)return;void refresh();const timer=setInterval(()=>{if(!document.hidden&&!action&&!liveHealthy.current)void refresh();},30000);return()=>clearInterval(timer);},[signedIn,refresh,action]);
  useEffect(()=>{
    if(!signedIn)return;
    let stopped=false,retry:ReturnType<typeof setTimeout>|undefined;
    const connect=()=>{
      const url=new URL('/api/live',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
      const batches=new BatchReceiver();
      const batchTimer=setInterval(()=>{try{batches.checkTimeout();}catch{socket.close();}},1000);
      const socket=new WebSocket(url);liveSocket.current=socket;
      socket.onopen=()=>{if(stopped){socket.close();return;}liveHealthy.current=true;socket.send(JSON.stringify({type:'select',player:viewRef.current==='players'?selectedRef.current:null}));};
      socket.onmessage=event=>{
        if(stopped)return;
        try {
          const message=batches.accept(event.data) as any;if(!message)return;
          if(message.type==='status'){playersVersion.current++;setConnected(message.connected);if(!message.connected)setError('Minecraft server disconnected. Waiting for reconnection…');}
          if(message.type==='live-error'){liveHealthy.current=false;setError(message.error);}
          if(message.type==='players'){playersVersion.current++;liveHealthy.current=true;setPlayers(message.data);setConnected(true);setUpdated(Date.now());setError('');}
          if(message.type==='player'&&message.player===selectedRef.current&&viewRef.current==='players'&&!actionRef.current){detailVersion.current++;setDetail(message.data);setLoading(false);}
        }catch{batches.reset();liveHealthy.current=false;setError('Invalid live update. Reconnecting…');socket.close();}
      };
      socket.onclose=event=>{
        clearInterval(batchTimer);batches.reset();
        if(stopped)return;liveHealthy.current=false;setConnected(false);
        if(event.code===4002){setDetail(null);setAction(null);detailVersion.current++;void api<Session>('/session').then(current=>{if(!stopped){setSession(current);retry=setTimeout(connect,0);}}).catch(()=>setSession(null));return;}
        if(event.code===4001){setSession(null);setSelected(null);setDetail(null);setAction(null);detailVersion.current++;return;}
        setError('Live connection interrupted. Reconnecting…');retry=setTimeout(connect,2000);
      };
      socket.onerror=()=>{liveHealthy.current=false;};
    };
    connect();
    return()=>{stopped=true;clearTimeout(retry);liveHealthy.current=false;liveSocket.current?.close();liveSocket.current=null;};
  },[signedIn,session?.csrf]);
  useEffect(()=>{const socket=liveSocket.current;if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'select',player:view==='players'?selected:null}));},[selected,view]);
  const canKillFeed=has(session,'tab.killFeed');
  const canMap=has(session,'tab.map');
  const canDns=has(session,'tab.dns');
  const canTsa=has(session,'tab.tsaConfig'),canStats=has(session,'tab.stats');
  const [myTodoCount,setMyTodoCount]=useState(0);
  const [ticketCount,setTicketCount]=useState(0);
  const [ticketMentions,setTicketMentions]=useState(0);
  const [cheatPercentage,setCheatPercentage]=useState<number|null>(null);
  const canTodo=has(session,'tab.todo'),canSuggestions=has(session,'tab.suggestions');
  const canTickets=has(session,'tab.tickets');
  useEffect(()=>{
    let active=true;setTicketCount(0);setTicketMentions(0);
    if(!signedIn||!canTickets)return;
    const load=()=>api<{total:number;mentionTotal?:number}>('/tickets/counts').then(result=>{if(active){setTicketCount(result.total);setTicketMentions(result.mentionTotal??0);}}).catch(()=>{if(active){setTicketCount(0);setTicketMentions(0);}});
    void load();const timer=setInterval(()=>{if(!document.hidden)void load();},15000);
    return()=>{active=false;clearInterval(timer);};
  },[signedIn,canTickets,api,session?.csrf]);
  useEffect(()=>{
    let active=true;setCheatPercentage(null);
    if(!signedIn||!canStats)return;
    const load=()=>api<CheatSnapshot>('/stats').then(snapshot=>{const stats=calculateCheatStats(snapshot,snapshot.types);if(active)setCheatPercentage(stats.prevalence);}).catch(()=>{if(active)setCheatPercentage(null);});
    void load();const timer=setInterval(()=>{if(!document.hidden)void load();},60000);
    return()=>{active=false;clearInterval(timer);};
  },[signedIn,canStats,api,session?.csrf]);
  const admin=has(session,'tab.audit'),manager=mode==='discord'&&has(session,'access.manage'),canPlayers=has(session,'tab.players');
  useEffect(()=>{
    let active=true;setMyTodoCount(0);
    if(!signedIn||!canTodo)return;
    const load=()=>api<{total:number}>('/todos/mine').then(result=>{if(active)setMyTodoCount(result.total);}).catch(()=>{});
    void load();const timer=setInterval(()=>{if(!document.hidden)void load();},30000);
    return()=>{active=false;clearInterval(timer);};
  },[signedIn,canTodo,api,session?.csrf]);
  useEffect(()=>{if(!signedIn)return;if(view==='dns'&&!canDns||view==='killFeed'&&!canKillFeed||view==='map'&&!canMap||view==='stats'&&!canStats||view==='tsa'&&!canTsa||view==='todo'&&!canTodo||view==='suggestions'&&!canSuggestions||view==='tickets'&&!canTickets||view==='audit'&&!admin||view==='access'&&!manager||view==='players'&&!canPlayers){setView(canPlayers?'players':canTickets?'tickets':canTodo?'todo':canSuggestions?'suggestions':admin?'audit':manager?'access':canKillFeed?'killFeed':canMap?'map':canStats?'stats':canTsa?'tsa':canDns?'dns':'none');return;}
    if(view==='audit')void api<AuditRow[]>('/audit').then(setAudit).catch(e=>setError(e.message));
    if(view==='access')void api<{ranks:Rank[]}>('/access/ranks').then(r=>setRanks(r.ranks)).catch(e=>setError(e.message));
  },[view,api,signedIn,admin,manager,canPlayers,canTickets,canTodo,canSuggestions,canTsa,canStats,canMap,canKillFeed,canDns]);
  if(!booted)return <div className="loading">Connecting to Admin Panel…</div>;
  if(!session)return <section id="login" className="login-screen"><div className="login-card"><div className="brand-mark">A</div><h1>Admin Panel</h1><p className="muted">Sign in to manage your Minecraft server.</p>
    {mode==='discord'?<a className="primary" id="discord-login" href="/api/auth/discord/start">Continue with Discord</a>:mode==='local'?<form id="login-form" onSubmit={async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));setBusy(true);setLoginError('');try{await api('/login',data);setSession(await api<Session>('/session'));}catch(e){setLoginError((e as Error).message);}finally{setBusy(false);}}}>
      <label>Username<input name="username" autoComplete="username" maxLength={32} required/></label><label>Password<input name="password" type="password" autoComplete="current-password" maxLength={256} required/></label><button className="primary" disabled={busy}>Sign in</button></form>:<button className="secondary" onClick={()=>location.reload()}>Retry connection</button>}
    <p id="login-error" className="error" role="alert">{loginError}</p></div></section>;
  const rankByPlayer=new Map(playerRanks.players.map(player=>[player.uuid,player.rank]));
  const canDetect=has(session,'tab.security');
  const filtered=players.players.filter(p=>(p.name.toLowerCase().includes(query.toLowerCase())||p.uuid.includes(query.toLowerCase()))&&(filter==='all'||p.online===(filter==='online'))&&(staffFilter==='all'||staffFilter==='none'&&rankByPlayer.get(p.uuid)===null||staffFilter==='staff'&&!!rankByPlayer.get(p.uuid)||staffFilter.startsWith('rank:')&&rankByPlayer.get(p.uuid)===staffFilter.slice(5))&&(!canDetect||detectionFilter==='all'||!!p.hasDetections===(detectionFilter==='detected')));

  const report=(e:unknown)=>setError((e as Error).message);
  const changeView=(value:string)=>{setView(value);setError('');};
  return <div id="app" className={sidebarCollapsed?'sidebar-collapsed':''}><aside className="sidebar"><div className="sidebar-heading"><div className="brand"><span className="brand-mark">A</span><span className="brand-name">Admin Panel</span></div><button id="sidebar-toggle" className="icon-button" aria-label={sidebarCollapsed?'Expand sidebar':'Collapse sidebar'} title={sidebarCollapsed?'Expand sidebar':'Collapse sidebar'} aria-expanded={!sidebarCollapsed} aria-controls="sidebar-nav" onClick={()=>setSidebarCollapsed(value=>!value)}>{sidebarCollapsed?<MenuOutlined fontSize="small"/>:<MenuOpenOutlined fontSize="small"/>}</button></div><nav id="sidebar-nav" className="sliding-selector sidebar-selector" ref={sidebarSlider}>
    {canPlayers&&<button className={'nav-button '+(view==='players'?'active':'')} title="Players" aria-label="Players" onClick={()=>changeView('players')}><TabIcon name="players"/><span className="nav-text">Players</span> <span className="count">{players.players.length}</span></button>}
    {canKillFeed&&<button id="kill-feed-nav" className={'nav-button '+(view==='killFeed'?'active':'')} title="Kill feed" aria-label="Kill feed" onClick={()=>changeView('killFeed')}><TabIcon name="killFeed"/><span className="nav-text">Kill feed</span></button>}
    {canMap&&<button id="map-nav" className={'nav-button '+(view==='map'?'active':'')} title="Player map" aria-label="Player map" onClick={()=>changeView('map')}><TabIcon name="map"/><span className="nav-text">Player map</span></button>}
    {canStats&&<button id="stats-nav" className={'nav-button '+(view==='stats'?'active':'')} title="Stats" aria-label="Stats" onClick={()=>changeView('stats')}><TabIcon name="stats"/><span className="nav-text">Stats</span>{cheatPercentage!==null&&<span className="count" title="Known players with recorded file detections · all categories">{Math.round(cheatPercentage)}%</span>}</button>}
    {canTsa&&<button id="tsa-config-nav" className={'nav-button '+(view==='tsa'?'active':'')} title="TSA configuration" aria-label="TSA configuration" onClick={()=>changeView('tsa')}><TabIcon name="tsa"/><span className="nav-text">TSA configuration</span></button>}{canTickets&&<button id="tickets-nav" className={'nav-button '+(view==='tickets'?'active ':'')+(ticketMentions?'ticket-personal-mention':'')} title={ticketMentions?`Tickets · ${ticketMentions} mention you`:'Tickets'} aria-label="Tickets" onClick={()=>changeView('tickets')}><TabIcon name="tickets"/><span className="nav-text">Tickets</span>{ticketCount>0&&<span className="count" title="Tickets across your accessible categories">{ticketCount}</span>}</button>}
    {canTodo&&<button id="todo-nav" className={'nav-button '+(view==='todo'?'active':'')} title="To-do" aria-label="To-do" onClick={()=>changeView('todo')}><TabIcon name="todo"/><span className="nav-text">To-do</span> <span className="count" title="Your To do and In progress tasks">{myTodoCount}</span></button>}
    {canSuggestions&&<button id="suggestions-nav" className={'nav-button '+(view==='suggestions'?'active':'')} title="Suggestions" aria-label="Suggestions" onClick={()=>changeView('suggestions')}><TabIcon name="suggestions"/><span className="nav-text">Suggestions</span></button>}
    {admin&&<button id="audit-nav" className={'nav-button '+(view==='audit'?'active':'')} title="Audit log" aria-label="Audit log" onClick={()=>changeView('audit')}><TabIcon name="audit"/><span className="nav-text">Audit log</span></button>}
    {manager&&<button id="access-nav" className={'nav-button '+(view==='access'?'active':'')} title="Rank access" aria-label="Rank access" onClick={()=>changeView('access')}><TabIcon name="access"/><span className="nav-text">Rank access</span></button>}
    {canDns&&<button id="dns-nav" className={'nav-button '+(view==='dns'?'active':'')} title="Cloudflare DNS" aria-label="Cloudflare DNS" onClick={()=>changeView('dns')}><TabIcon name="tsa"/><span className="nav-text">Cloudflare DNS</span></button>}
  <span className="selector-highlight" aria-hidden="true" hidden/></nav><div className="sidebar-bottom"><div className="connection"><i className={connected?'':'stale'}/>{connected?'Server connected':'Server disconnected'}</div><div className="staff"><span className="avatar staff-avatar">{displayName(session.name).slice(0,2)}</span><div><strong title={session.name}>{displayName(session.name)}</strong><small>{session.rank}</small></div><button id="logout" className="icon-button" aria-label="Sign out" onClick={async()=>{try{await api('/logout',{});setSession(null);setDetail(null);setAction(null);setSelected(null);setFilter('all');setStaffFilter('all');setDetectionFilter('all');setPlayerRanks({ranks:[],players:[]});setQuery('');setView('players');setPlayers({players:[],serverPlayers:0,maxPlayers:0,punishAvailable:false});detailVersion.current++;}catch(e){report(e);}}}>↪</button></div></div></aside>
    <main><header className="topbar"><strong>Minecraft administration</strong><span>{updated?'Updated '+new Date(updated).toLocaleTimeString():'Waiting for server'}</span></header><div className="page" ref={pageTransition}>
      <div className="page-heading"><div><h1>{view==='dns'?'Cloudflare DNS':view==='killFeed'?'Kill feed':view==='map'?'Player map':view==='stats'?'Cheat statistics':view==='tsa'?'TSA configuration':view==='players'?'Player directory':view==='audit'?'Audit log':view==='access'?'Discord rank access':view==='tickets'?'Tickets':view==='todo'?'Developer to-do':view==='suggestions'?'Suggestions':'Panel'}</h1><p className="muted">{view==='players'?'Online and known offline players':'Staff administration'}</p></div><button id="refresh" className="secondary" onClick={()=>{void refresh();if(view==='dns'||view==='tsa'||view==='stats'||view==='map'||view==='killFeed')setTsaRefresh(value=>value+1);if(view==='audit')void api<AuditRow[]>('/audit').then(setAudit).catch(report);}}>Refresh</button></div>
      {error&&<p id="page-error" className="banner error" role="alert">{error}</p>}
      {view==='killFeed'&&canKillFeed&&<KillFeed key={session.csrf+tsaRefresh} api={api} session={session}/>}
      {view==='map'&&canMap&&<PlayerMap key={session.csrf+tsaRefresh} api={api} session={session}/>}
      {view==='stats'&&canStats&&<CheatStatistics key={session.csrf+tsaRefresh} api={api}/>}
      {view==='dns'&&canDns&&<DnsConfiguration key={session.csrf+tsaRefresh} api={api} canEdit={has(session,'dns.edit')}/>}
      {view==='tsa'&&canTsa&&<TsaConfiguration key={session.csrf+tsaRefresh} api={api} canEdit={has(session,'tsa.configure')} canEditLists={has(session,'tsa.lists.edit')}/>}
      {view==='tickets'&&canTickets&&<Tickets key={session.csrf} api={api} canReply={has(session,'tickets.reply')}/>}
      {view==='todo'&&canTodo&&<Todos api={api} session={session} onAssignedCount={setMyTodoCount}/>}
      {view==='suggestions'&&canSuggestions&&<Suggestions key={session.csrf} api={api} session={session}/>}
      {view==='none'&&<p className="notice">Your rank has no permitted tabs. Contact someone who manages panel permissions.</p>}
      {view==='players'&&<><div className="stats"><article><span>Known players</span><strong>{players.players.length}</strong></article><article><span>Online</span><strong>{players.serverPlayers}</strong><small>of {players.maxPlayers} slots</small></article><article><span>Punish</span><strong className="stat-text">{players.punishAvailable?'Connected':'Unavailable'}</strong></article></div>
      <div className="directory"><section className="card"><div className="section-header"><h2>Players</h2><span className="pill">{filtered.length}</span></div><label className="search-box"><input id="search" aria-label="Search players" placeholder="Search name or UUID…" value={query} onChange={e=>setQuery(e.target.value)}/></label><ToggleSelector label="Player status" options={['all','online','offline'].map(value=>({value,label:value[0]!.toUpperCase()+value.slice(1)}))} value={filter} onChange={setFilter} dataAttribute="data-filter"/><div className="directory-filters"><SelectField label="Staff rank" ariaLabel="Filter players by staff rank" value={staffFilter} onChange={setStaffFilter} options={[{value:'all',label:'All ranks'},{value:'staff',label:'Any staff rank'},{value:'none',label:'No staff rank'},...playerRanks.ranks.map(rank=>({value:'rank:'+rank,label:rank}))]}/>{rankError&&<p className="fine" role="status">{rankError}</p>}{canDetect&&<SelectField label="Detection status" ariaLabel="Filter players by detection status" value={detectionFilter} onChange={setDetectionFilter} options={[{value:'all',label:'All detection statuses'},{value:'detected',label:'Has detections'},{value:'clean',label:'No detections'}]}/>}</div><div id="player-rows" className="player-rows">{filtered.map(p=><button key={p.uuid} className={'player-row '+(selected===p.uuid?'selected':'')} data-player={p.uuid} aria-pressed={selected===p.uuid} onClick={()=>{setAction(null);void loadPlayer(p.uuid,true).catch(report);}}><Avatar name={p.name} uuid={p.uuid}/><span><strong className={p.hasDetections?'detected-name':''}>{p.name}</strong><small className={p.online?'online':''}>{p.online?'● Online':'Offline'}</small></span><span className="arrow">›</span></button>)}{!filtered.length&&<p className="empty">No players found</p>}</div></section>
      <section id="detail" className="card">{loading?<p className="loading">Loading player records…</p>:detail?<PlayerDetail key={detail.uuid} player={detail} session={session} api={api} action={action} setAction={setAction} changed={async()=>{await loadPlayer(detail.uuid);}}/>:<div className="empty"><h2>Select a player</h2><p>Inspect profiles, notes, and moderation history.</p></div>}</section></div></>}
      {view==='audit'&&<AuditLog rows={audit}/>}
      {view==='access'&&<section id="rank-access" className="card"><div className="section-header"><p>Highest matching rank wins. Profile tabs require Players; actions also require their Notes or Punishments tab. Saved changes apply immediately to signed-in users.</p></div><div className="table-wrap"><table><thead><tr><th>Rank</th><th>Discord role ID</th><th>Permissions</th><th>Order</th></tr></thead><tbody>{ranks.map((rank,i)=><tr key={i}><td><input aria-label={`Rank ${i+1} name`} value={rank.name} onChange={e=>setRanks(ranks.map((r,j)=>j===i?{...r,name:e.target.value}:r))}/></td><td><input aria-label={`Rank ${i+1} role ID`} value={rank.discordRoleId} onChange={e=>setRanks(ranks.map((r,j)=>j===i?{...r,discordRoleId:e.target.value}:r))}/></td><td><PermissionPicker selected={rank.permissions} onToggle={(permission,checked)=>setRanks(current=>current.map((r,j)=>j===i?{...r,permissions:checked?[...r.permissions,permission]:r.permissions.filter(key=>key!==permission)}:r))}/></td><td><button className="secondary small" disabled={!i} onClick={()=>{const next=[...ranks];[next[i-1],next[i]]=[next[i]!,next[i-1]!];setRanks(next);}}>↑</button><button className="secondary small" disabled={i===ranks.length-1} onClick={()=>{const next=[...ranks];[next[i+1],next[i]]=[next[i]!,next[i+1]!];setRanks(next);}}>↓</button><button className="danger small" onClick={()=>setRanks(ranks.filter((_,j)=>i!==j))}>Remove</button></td></tr>)}</tbody></table></div><div className="section-header"><button className="secondary" disabled={ranks.length>=30} onClick={()=>setRanks([...ranks,{name:'',discordRoleId:'',permissions:[]}])}>Add rank</button><button className="primary" disabled={busy} onClick={async()=>{if(!confirm('Save and apply rank changes to all signed-in users?'))return;setBusy(true);try{await api('/access/ranks',{ranks});setRankMessage('Saved. Permissions applied immediately.');setSession(await api<Session>('/session'));}catch(e){report(e);}finally{setBusy(false);}}}>Save changes</button></div><p className="notice">{rankMessage||'Keep a rank with panel.access and access.manage. Empty permissions deny login.'}</p></section>}
    </div></main></div>;
}
