import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Api, Session, Detail, Case, Slot } from './types';
import { Avatar, date, Info, Pairs } from './App';
import { durationMinutes } from './duration';
export interface Action {action:string;noteId?:string;caseId?:string;requestId:string}
const makeAction=(action:string,fields:Partial<Action>={}):Action=>({action,...fields,requestId:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')});
const status=(c:Case)=>c.removedBy?'removed':c.until&&c.until<=Date.now()?'expired':!c.active?c.replaced?'replaced':'inactive':['warn','kick'].includes(c.type)?'recorded':'current';
const time=(seconds:number)=>{const m=Math.floor(Math.max(0,seconds)/60);return `${Math.floor(m/1440)}d ${Math.floor(m%1440/60)}h ${m%60}m`;};
function Skin({name}:{name:string}){const [failed,setFailed]=useState(false);return failed||!/^[A-Za-z0-9_]{3,16}$/.test(name)?<p>Skin unavailable</p>:<img className="full-skin" src={'/api/skin/body/'+encodeURIComponent(name)} alt={`${name}'s Minecraft skin`} loading="lazy" onError={()=>setFailed(true)}/>;}
export function PlayerDetail({player:p,session,api,action,setAction,changed}:{player:Detail;session:Session;api:Api;action:Action|null;setAction:(a:Action|null)=>void;changed:()=>Promise<void>}) {
  const [tab,setTab]=useState('overview');const admin=session.role==='admin',moderate=admin||session.role==='moderator';
  const open=(name:string,fields:Partial<Action>={})=>setAction(makeAction(name,fields));
  let content:ReactNode;
  if(tab==='overview')content=<div className="info-grid">
    <Info title="Location"><Pairs rows={[
      ['Time played',p.playtime?.available?time(p.playtime.seconds):'Unavailable'],
      ['Status',p.location?.available?(p.location.source==='live'?'Current location':'Last saved location'):'Unavailable'],
      ...(p.location?.available?[['Dimension',p.location.dimension],['X',Number(p.location.x).toFixed(1)],['Y',Number(p.location.y).toFixed(1)],['Z',Number(p.location.z).toFixed(1)],['Saved',date(p.location.savedAt)]] as [string,ReactNode][]:[])]}/></Info>
    <Info title="Player skin"><Skin name={p.name}/></Info>
    <Info title="Moderation summary"><Pairs rows={[
      ['Current bans / mutes',(p.cases||[]).filter(c=>c.active&&(!c.until||c.until>Date.now())&&['ban','mute'].includes(c.type)).length],['Recorded punishments',p.cases?.length||0],['Staff notes',p.notes?.length||0],['Punish integration',p.punish?.available?'Available':'Unavailable']]}/></Info>
    <Info title="Discord identity">{p.discord?.available?<Pairs rows={[["Display name",p.discord.displayName],['Account',p.discord.discordTag],['Discord ID',p.discord.discordId],['Linked',date(p.discord.linkedAt)]]}/>:<p>No linked Discord account</p>}</Info>
    <Info title="FTB Team">{p.teams?.available?<><strong>{p.teams.name}</strong>{p.teams.members?.map((m,i)=><p key={i}>{m.name} <span className="pill">{m.rankDisplay||m.rank}</span></p>)}</>:<p>No team record available</p>}</Info>
    <Info title="ClockIn">{p.clockin?.available?<Pairs rows={[["Status",p.clockin.clockedIn?'Clocked in':'Clocked out'],['Total time',time(p.clockin.totalSeconds)]]}/>:<p>No record available</p>}</Info></div>;
  else if(tab==='cases')content=!p.punish?.available?<p className="notice">Punish is unavailable. Install the compatible Punish mod.</p>:!p.cases?.length?<p className="empty">No punishment history</p>:p.cases.map((c,i)=><article key={i} className="record"><div className="record-top"><span className={'pill '+c.type}>{c.type.toUpperCase()}{c.ipBased?' · IP':''}</span><strong>#{c.id} {c.offense||'Direct action'}</strong><span className={'pill '+status(c)}>{status(c)}</span>{admin&&c.offense&&c.primary&&!c.removedBy&&<button className="secondary small" onClick={()=>open('revoke',{caseId:c.caseId})}>Remove case</button>}</div><p>{c.reason}</p><small>{c.by} · {date(c.at)}{['ban','mute'].includes(c.type)?' · Until '+(c.until?date(c.until):'permanent'):''}{c.removedBy?' · Removed by '+c.removedBy:''}</small></article>);
  else if(tab==='notes')content=!p.notesAvailable?<p className="notice">Admin Notes is unavailable on this server.</p>:<>{moderate&&<button className="secondary" onClick={()=>open('note-add')}>＋ Add staff note</button>}{p.notes?.length?p.notes.map(n=><article className="record" key={n.id}><div className="record-top"><strong>{n.author}</strong>{n.system&&<span className="pill">System</span>}<small>{date(n.createdAt)}</small></div><p>{n.text}</p>{moderate&&n.canEdit&&<div className="record-actions"><button className="secondary small" onClick={()=>open('note-edit',{noteId:n.id})}>Edit</button><button className="danger small" onClick={()=>open('note-remove',{noteId:n.id})}>Remove</button></div>}</article>):<p className="empty">No staff notes</p>}</>;
  else if(tab==='security')content=<div className="info-grid">
    <Info title="TSA Anticheat">{p.tsa?.available?<Pairs rows={[["Packet checks",p.tsa.packetChecks],['Passed',p.tsa.packetPasses],['Modified',p.tsa.packetModified],['Timeouts',p.tsa.packetTimeout],['Last status',p.tsa.lastPacketStatus],['Last check',p.tsa.lastPacketDate]]}/>:<p>No record available</p>}</Info>
    <Info title="Airport Security">{p.ass?.available?<Pairs rows={[["Status",p.ass.status],['Total checks',p.ass.totalChecks],['Clean',p.ass.cleanChecks],['Detected',p.ass.detectedChecks],['Inconclusive',p.ass.inconclusiveChecks],['Cleared',p.ass.clearedDate]]}/>:<p>No record available</p>}</Info>
    <Info title="Stored TSA detections" wide>{p.tsa?.detections?.length?p.tsa.detections.map((d,i)=><p key={i}>{d}</p>):<p>No stored detections</p>}</Info>
    <Info title="Airport detection counts" wide><Pairs rows={Object.entries(p.ass?.detectionCounts||{})}/></Info>
    <Info title="Airport detection dates" wide><Pairs rows={Object.entries(p.ass?.detectionDates||{})}/></Info></div>;
  else content=<Storage key={tab} player={p} kind={tab as 'inventory'|'enderChest'|'curios'} api={api}/>;
  return <><div className="profile-head"><Avatar name={p.name}/><div><h2><span className={p.hasDetections||(p.tsa?.packetModified||0)>0||p.tsa?.detections?.length||(p.ass?.detectedChecks||0)>0?'detected-name':''}>{p.name}</span> <span className={'pill '+(p.online?'online':'')}>{p.online?'● Online':'Offline'}</span></h2><div className="uuid">{p.uuid}</div></div>{moderate&&<div className="profile-actions"><button className="primary" disabled={!p.punish?.available} onClick={()=>open('punish')}>＋ Issue punishment</button></div>}</div>
    <div className="detail-tabs">{[['overview','Overview'],['cases','Punishments'],['notes','Staff notes'],['security','Security'],['inventory','Inventory'],['enderChest','Ender Chest'],['curios','Curios']].map(([key,title])=><button key={key} data-tab={key} className={tab===key?'active':''} onClick={()=>setTab(key!)}>{title}</button>)}</div><div className="detail-body">{content}</div>
    {action&&<ActionDialog key={action.requestId} player={p} session={session} action={action} api={api} close={()=>setAction(null)} changed={changed}/>}</>;
}
function Storage({player,kind,api}:{player:Detail;kind:'inventory'|'enderChest'|'curios';api:Api}) {
  const [icons,setIcons]=useState<Record<string,string>>({}),[error,setError]=useState('');
  const snapshot=player.storage,section=snapshot?.[kind];
  const ids=[...new Set(section?.groups?.flatMap(g=>g.slots.filter(s=>!s.empty).map(s=>s.id))||[])].sort();
  const key=JSON.stringify(ids);
  useEffect(()=>{let active=true;void(async()=>{try{const found:Record<string,string>={};for(let i=0;i<ids.length;i+=64)Object.assign(found,await api<Record<string,string>>('/icons',{ids:ids.slice(i,i+64)}));if(active){setIcons(found);setError('');}}catch(e){if(active)setError('Item icons could not load: '+(e as Error).message);}})();return()=>{active=false;};},[api,key]);
  if(!section?.available)return <p className="notice">{section?.reason||'Inventory data unavailable. Refresh to try again.'}</p>;
  return <><p className="notice">{snapshot?.source==='saved'?'Last saved data · '+date(snapshot.savedAt)+' · Player is offline':'Live snapshot · '+date(snapshot?.capturedAt)}. Read-only; refresh to see changes.</p>{error&&<p className="error" role="alert">{error}</p>}{section.groups?.length?section.groups.map((group,i)=><section className="storage-group" key={i}><h3>{group.name} <span className="pill">{group.slots.filter(s=>!s.empty).length} / {group.slots.length} occupied</span></h3><div className="storage-grid">{group.slots.map((s,i)=><Item key={i} slot={s} icon={icons[s.id]}/>)}</div></section>):<p className="empty">No Curios slots</p>}</>;
}
function Item({slot:s,icon}:{slot:Slot;icon?:string}) {
  if(s.empty)return <div className="item-slot empty-slot" aria-label={s.label+': empty'}><small>{s.label}</small><span>Empty</span></div>;
  return <details className={'item-slot '+(s.selected?'held-item':'')}><summary title={s.name+' · '+s.id}><small>{s.label}{s.selected?' · Selected':''}</small><span className="item-art">{icon&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(icon)?<img src={icon} alt=""/>:'◇'}</span><strong>{s.name}</strong><span className="item-count">×{s.count}</span></summary><div className="item-properties"><code>{s.id}</code>{s.maxDamage>0&&<p>Durability: {Math.max(0,s.maxDamage-s.damage)} / {s.maxDamage}</p>}{s.enchantments?.map((e,i)=><p className="enchantment" key={i}>{e}</p>)}{s.lore?.map((l,i)=><p key={i}>{l}</p>)}</div></details>;
}
function ActionDialog({player,session,action,api,close,changed}:{player:Detail;session:Session;action:Action;api:Api;close:()=>void;changed:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null),admin=session.role==='admin',punish=action.action==='punish',note=action.action.startsWith('note-'),removing=action.action==='note-remove';
  const offenses=player.punish?.offenses||[];
  const [type,setType]=useState(admin&&offenses.length?'OFFENSE':'WARN'),[offense,setOffense]=useState(offenses[0]?.id||'');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false);
  useEffect(()=>{dialog.current?.showModal();},[]);
  const title=({'punish':'Issue punishment','note-add':'Add staff note','note-edit':'Edit staff note','note-remove':'Remove staff note','revoke':'Remove offense case'} as Record<string,string>)[action.action];
  return <dialog id="action-dialog" ref={dialog} onCancel={e=>{if(busy)e.preventDefault();else close();}}><form id="action-form" onSubmit={async e=>{
    e.preventDefault();if(submitted||busy)return;const values=new FormData(e.currentTarget);const body:Record<string,unknown>={};
    try {
    if(punish){body.type=type;body.reason=values.get('reason');body.silent=values.get('silent')==='on';if(type==='OFFENSE')body.offense=offense;body.durationMinutes=['BAN','MUTE'].includes(type)?durationMinutes(values.get('duration')):0;}
    else if(note){if(action.noteId)body.noteId=action.noteId;if(!removing)body.text=values.get('text');}
    else {body.caseId=Number(action.caseId);body.reason=values.get('reason');}
    } catch(e){setError((e as Error).message);return;}
    setBusy(true);setSubmitted(true);setError('');
    try{await api('/players/'+player.uuid+'/'+action.action,body,action.requestId);await changed();close();}
    catch(e){setError((e as Error).message+' Close this dialog and inspect the player and audit before submitting another action.');}
    finally{setBusy(false);}
  }}><div className="dialog-head"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" disabled={busy} onClick={close}>×</button></div><p className="muted">{player.name} · {player.uuid}</p>
    {punish&&<><label>Action<select name="type" value={type} onChange={e=>setType(e.target.value)}>{admin&&offenses.length>0&&<option value="OFFENSE">Configured offense</option>}<option value="WARN">Warning</option><option value="KICK" disabled={!player.online}>Kick</option><option value="MUTE">Mute</option>{admin&&<option value="BAN">Ban</option>}</select></label>
    {type==='OFFENSE'&&<label>Configured offense<select name="offense" value={offense} onChange={e=>setOffense(e.target.value)}>{offenses.map(o=><option key={o.id} value={o.id}>{o.group?o.group+' · ':''}{o.name}</option>)}</select><small>{offenses.find(o=>o.id===offense)?.steps?.join(' → ')}</small></label>}
    {['MUTE','BAN'].includes(type)&&<label>Duration<input name="duration" defaultValue="1d" maxLength={24} required/><small>3d, 1h, 30m, 1w, perm</small></label>}<label className="checkbox"><input name="silent" type="checkbox"/>Silent action</label></>}
    {!note&&<label>Reason<textarea name="reason" rows={4} maxLength={1000} required/></label>}
    {note&&!removing&&<label>Staff note<textarea name="text" rows={5} maxLength={4000} required defaultValue={player.notes?.find(n=>n.id===action.noteId)?.text||''}/></label>}
    <p className="notice">This changes server records immediately and is recorded in the audit trail.</p><label className="checkbox"><input type="checkbox" required/>I have reviewed the player and this action.</label><p className="error" role="alert">{error}</p><div className="dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="primary" disabled={busy||submitted}>Confirm action</button></div></form></dialog>;
}
