import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Api, Session, Player, Players, Detail, AuditRow, Rank } from './types';
import { PlayerDetail, type Action } from './PlayerDetail';
import { has, PERMISSIONS, PERMISSION_LABELS } from '../src/permissions';
import { BatchReceiver } from '../src/batches';
export const date=(value?:number)=>value?new Date(value).toLocaleString():'—';
export const displayName=(name:string)=>name.replace(/ \[\d{17,20}\]$/,'');
export function Avatar({name}:{name:string}) {
  const [loaded,setLoaded]=useState(false);
  return <span className={'avatar player-head'+(loaded?' head-loaded':'')}>
    {/^[A-Za-z0-9_]{3,16}$/.test(name)&&<img src={'/api/skin/head/'+encodeURIComponent(name)} alt="" loading="lazy" onLoad={()=>setLoaded(true)} onError={()=>setLoaded(false)}/>}
    <span className="head-fallback">{name.slice(0,2).toUpperCase()}</span></span>;
}
export function Pairs({rows}:{rows:[string,ReactNode][]}) {return <dl>{rows.map(([k,v])=><div className="pair" key={k}><dt>{k}</dt><dd>{v??'—'}</dd></div>)}</dl>;}
export function Info({title,children,wide=false}:{title:string;children:ReactNode;wide?:boolean}){return <article className={'info-card'+(wide?' wide':'')}><h3>{title}</h3>{children}</article>;}
export function App() {
  const [session,setSession]=useState<Session|null>(null),[mode,setMode]=useState(''),[booted,setBooted]=useState(false);
  const [error,setError]=useState(''),[loginError,setLoginError]=useState(new URLSearchParams(location.search).get('loginError')||'');
  const [players,setPlayers]=useState<Players>({players:[],serverPlayers:0,maxPlayers:0,punishAvailable:false});
  const [selected,setSelected]=useState<string|null>(null),[detail,setDetail]=useState<Detail|null>(null),[loading,setLoading]=useState(false);
  const [filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[view,setView]=useState('players');
  const [connected,setConnected]=useState(false),[updated,setUpdated]=useState<number>();
  const [audit,setAudit]=useState<AuditRow[]>([]),[ranks,setRanks]=useState<Rank[]>([]),[rankMessage,setRankMessage]=useState('');
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
        if(event.code===4001){setSession(null);setSelected(null);setDetail(null);setAction(null);detailVersion.current++;return;}
        setError('Live connection interrupted. Reconnecting…');retry=setTimeout(connect,2000);
      };
      socket.onerror=()=>{liveHealthy.current=false;};
    };
    connect();
    return()=>{stopped=true;clearTimeout(retry);liveHealthy.current=false;liveSocket.current?.close();liveSocket.current=null;};
  },[signedIn,session?.csrf]);
  useEffect(()=>{const socket=liveSocket.current;if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'select',player:view==='players'?selected:null}));},[selected,view]);
  const admin=has(session,'tab.audit'),manager=mode==='discord'&&has(session,'access.manage'),canPlayers=has(session,'tab.players');
  useEffect(()=>{if(!signedIn)return;if(view==='audit'&&!admin||view==='access'&&!manager||view==='players'&&!canPlayers){setView(canPlayers?'players':admin?'audit':manager?'access':'none');return;}
    if(view==='audit')void api<AuditRow[]>('/audit').then(setAudit).catch(e=>setError(e.message));
    if(view==='access')void api<{ranks:Rank[]}>('/access/ranks').then(r=>setRanks(r.ranks)).catch(e=>setError(e.message));
  },[view,api,signedIn,admin,manager,canPlayers]);
  if(!booted)return <div className="loading">Connecting to Admin Panel…</div>;
  if(!session)return <section id="login" className="login-screen"><div className="login-card"><div className="brand-mark">A</div><h1>Admin Panel</h1><p className="muted">Sign in to manage your Minecraft server.</p>
    {mode==='discord'?<a className="primary" id="discord-login" href="/api/auth/discord/start">Continue with Discord</a>:mode==='local'?<form id="login-form" onSubmit={async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));setBusy(true);setLoginError('');try{await api('/login',data);setSession(await api<Session>('/session'));}catch(e){setLoginError((e as Error).message);}finally{setBusy(false);}}}>
      <label>Username<input name="username" autoComplete="username" maxLength={32} required/></label><label>Password<input name="password" type="password" autoComplete="current-password" maxLength={256} required/></label><button className="primary" disabled={busy}>Sign in</button></form>:<button className="secondary" onClick={()=>location.reload()}>Retry connection</button>}
    <p id="login-error" className="error" role="alert">{loginError}</p></div></section>;
  const filtered=players.players.filter(p=>(p.name.toLowerCase().includes(query.toLowerCase())||p.uuid.includes(query.toLowerCase()))&&(filter==='all'||p.online===(filter==='online')));
  const report=(e:unknown)=>setError((e as Error).message);
  const changeView=(value:string)=>{setView(value);setError('');};
  return <div id="app"><aside className="sidebar"><div className="brand"><span className="brand-mark">A</span>Admin Panel</div><nav>
    {canPlayers&&<button className={'nav-button '+(view==='players'?'active':'')} onClick={()=>changeView('players')}>Players <span className="count">{players.players.length}</span></button>}
    {admin&&<button id="audit-nav" className={'nav-button '+(view==='audit'?'active':'')} onClick={()=>changeView('audit')}>Audit log</button>}
    {manager&&<button id="access-nav" className={'nav-button '+(view==='access'?'active':'')} onClick={()=>changeView('access')}>Rank access</button>}
  </nav><div className="sidebar-bottom"><div className="connection"><i className={connected?'':'stale'}/>{connected?'Server connected':'Server disconnected'}</div><div className="staff"><span className="avatar staff-avatar">{displayName(session.name).slice(0,2)}</span><div><strong title={session.name}>{displayName(session.name)}</strong><small>{session.rank}</small></div><button id="logout" className="icon-button" aria-label="Sign out" onClick={async()=>{try{await api('/logout',{});setSession(null);setDetail(null);setAction(null);setSelected(null);setFilter('all');setQuery('');setView('players');setPlayers({players:[],serverPlayers:0,maxPlayers:0,punishAvailable:false});detailVersion.current++;}catch(e){report(e);}}}>↪</button></div></div></aside>
    <main><header className="topbar"><strong>Minecraft administration</strong><span>{updated?'Updated '+new Date(updated).toLocaleTimeString():'Waiting for server'}</span></header><div className="page">
      <div className="page-heading"><div><h1>{view==='players'?'Player directory':view==='audit'?'Audit log':view==='access'?'Discord rank access':'Panel'}</h1><p className="muted">{view==='players'?'Online and known offline players':'Staff administration'}</p></div><button id="refresh" className="secondary" onClick={()=>{void refresh();if(view==='audit')void api<AuditRow[]>('/audit').then(setAudit).catch(report);}}>Refresh</button></div>
      {error&&<p id="page-error" className="banner error" role="alert">{error}</p>}
      {view==='none'&&<p className="notice">Your rank has no permitted tabs. Contact someone who manages panel permissions.</p>}
      {view==='players'&&<><div className="stats"><article><span>Known players</span><strong>{players.players.length}</strong></article><article><span>Online</span><strong>{players.serverPlayers}</strong><small>of {players.maxPlayers} slots</small></article><article><span>Punish</span><strong className="stat-text">{players.punishAvailable?'Connected':'Unavailable'}</strong></article></div>
      <div className="directory"><section className="card"><div className="section-header"><h2>Players</h2><span className="pill">{filtered.length}</span></div><label className="search-box"><input id="search" aria-label="Search players" placeholder="Search name or UUID…" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="filter-tabs">{['all','online','offline'].map(f=><button key={f} data-filter={f} className={filter===f?'selected':''} onClick={()=>setFilter(f)}>{f[0]!.toUpperCase()+f.slice(1)}</button>)}</div><div id="player-rows" className="player-rows">{filtered.map(p=><button key={p.uuid} className={'player-row '+(selected===p.uuid?'selected':'')} data-player={p.uuid} aria-pressed={selected===p.uuid} onClick={()=>{setAction(null);void loadPlayer(p.uuid,true).catch(report);}}><Avatar name={p.name}/><span><strong className={p.hasDetections?'detected-name':''}>{p.name}</strong><small className={p.online?'online':''}>{p.online?'● Online':'Offline'}</small></span><span className="arrow">›</span></button>)}{!filtered.length&&<p className="empty">No players found</p>}</div></section>
      <section id="detail" className="card">{loading?<p className="loading">Loading player records…</p>:detail?<PlayerDetail key={detail.uuid} player={detail} session={session} api={api} action={action} setAction={setAction} changed={async()=>{await loadPlayer(detail.uuid);}}/>:<div className="empty"><h2>Select a player</h2><p>Inspect profiles, notes, and moderation history.</p></div>}</section></div></>}
      {view==='audit'&&<section className="card"><div className="section-header"><p className="muted">Latest 500 events. Full history is stored on the web host.</p><button className="secondary" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(audit,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='admin-panel-audit.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Export JSON</button></div><div className="table-wrap"><table><thead><tr>{['Time','Actor','Action','Target','Result'].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{audit.map((r,i)=><tr key={i}><td>{date(r.at)}</td><td>{r.actor}</td><td>{r.action}</td><td>{r.target}</td><td>{r.state}<details><summary>Details</summary><pre>{JSON.stringify(r.detail,null,2)}</pre></details></td></tr>)}</tbody></table></div></section>}
      {view==='access'&&<section className="card"><div className="section-header"><p>Highest matching rank wins. Profile tabs require Players; actions also require their Notes or Punishments tab. Saved changes take effect after restarting the Node web service.</p></div><div className="table-wrap"><table><thead><tr><th>Rank</th><th>Discord role ID</th><th>Permissions</th><th>Order</th></tr></thead><tbody>{ranks.map((rank,i)=><tr key={i}><td><input aria-label={`Rank ${i+1} name`} value={rank.name} onChange={e=>setRanks(ranks.map((r,j)=>j===i?{...r,name:e.target.value}:r))}/></td><td><input aria-label={`Rank ${i+1} role ID`} value={rank.discordRoleId} onChange={e=>setRanks(ranks.map((r,j)=>j===i?{...r,discordRoleId:e.target.value}:r))}/></td><td><details><summary>{rank.permissions.length} permissions</summary>{PERMISSIONS.map(permission=><label className="checkbox" key={permission} title={permission}><input data-permission={permission} type="checkbox" checked={rank.permissions.includes(permission)} onChange={e=>setRanks(ranks.map((r,j)=>j===i?{...r,permissions:e.target.checked?[...r.permissions,permission]:r.permissions.filter(p=>p!==permission)}:r))}/>{PERMISSION_LABELS[permission]}</label>)}</details></td><td><button className="secondary small" disabled={!i} onClick={()=>{const next=[...ranks];[next[i-1],next[i]]=[next[i]!,next[i-1]!];setRanks(next);}}>↑</button><button className="secondary small" disabled={i===ranks.length-1} onClick={()=>{const next=[...ranks];[next[i+1],next[i]]=[next[i]!,next[i+1]!];setRanks(next);}}>↓</button><button className="danger small" onClick={()=>setRanks(ranks.filter((_,j)=>i!==j))}>Remove</button></td></tr>)}</tbody></table></div><div className="section-header"><button className="secondary" disabled={ranks.length>=30} onClick={()=>setRanks([...ranks,{name:'',discordRoleId:'',permissions:[]}])}>Add rank</button><button className="primary" disabled={busy} onClick={async()=>{if(!confirm('Save rank changes? Restart the Node web service to apply them.'))return;setBusy(true);try{await api('/access/ranks',{ranks});setRankMessage('Saved. Restart the Node web service to apply changes.');}catch(e){report(e);}finally{setBusy(false);}}}>Save changes</button></div><p className="notice">{rankMessage||'Keep a rank with panel.access and access.manage. Empty permissions deny login.'}</p></section>}
    </div></main></div>;
}
