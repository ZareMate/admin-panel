import { useCallback, useEffect, useState } from 'react';
import type { Api } from './types';
type RecordRow={key:string;type:string;name:string;value?:string|number;target?:string;error?:string};
export function DnsConfiguration({api,canEdit}:{api:Api;canEdit:boolean}) {
 const [rows,setRows]=useState<RecordRow[]>([]),[endpoint,setEndpoint]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{setBusy(true);setError('');try{
  const records=(await api<{records:RecordRow[]}>('/dns')).records;setRows(records);
  const ips=new Set(records.filter(r=>r.type==='A'&&!r.error).map(r=>r.value)),ports=new Set(records.filter(r=>r.type==='SRV'&&!r.error).map(r=>r.value));
  setEndpoint(ips.size===1&&ports.size===1?`${[...ips][0]}:${[...ports][0]}`:'');
 }catch(e){setRows([]);setError((e as Error).message);}finally{setBusy(false);}},[api]);
 useEffect(()=>{void load();},[load]);
 const ready=rows.length>0&&rows.every(row=>!row.error&&row.value!==undefined);
 const save=async()=>{setBusy(true);setError('');setNotice('');try{
  const result=await api<{updated:number}>('/dns',{endpoint,expected:Object.fromEntries(rows.map(row=>[row.key,row.value]))});
  setNotice(`Saved all configured records (${result.updated} changed). DNS caches may take time to refresh.`);await load();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="card dns-configuration" aria-label="Cloudflare DNS configuration">
 <div className="dns-header"><div><h2>Server address</h2><p className="muted">Apply one IP and port to all configured Minecraft DNS records.</p></div><button className="secondary" disabled={busy} onClick={()=>void load()}>Reload records</button></div>
 <div className="dns-editor">
 {!canEdit&&<p className="notice">You have read-only access.</p>}
 {error&&<p role="alert" className="banner error">{error}</p>}{notice&&<p role="status" className="dns-notice">{notice}</p>}
 <form className="dns-form" onSubmit={e=>{e.preventDefault();void save();}}>
 <label htmlFor="dns-endpoint">Server IP:port</label>
 <div className="dns-input-row"><input id="dns-endpoint" type="text" placeholder="192.0.2.1:25565" aria-describedby="dns-endpoint-help" required disabled={busy||!canEdit||!ready} value={endpoint} onChange={e=>setEndpoint(e.target.value)}/><button className="primary" disabled={busy||!canEdit||!ready||!endpoint.trim()}>{busy?'Please wait…':'Save all records'}</button></div>
 <p id="dns-endpoint-help" className="muted">The IP applies to every A record; the port applies to every SRV record. Other DNS settings are preserved.</p>
 </form></div>
 <div className="dns-records"><h3>Configured records <span className="muted">({rows.length})</span></h3>
 {!rows.length&&busy&&<p className="muted">Loading DNS records…</p>}
 {rows.map(row=><div className="dns-record" key={row.key}>
 <div className="dns-record-name"><span className="dns-record-type">{row.type}</span><strong>{row.name}</strong></div>
 {row.error?<p role="alert" className="error">{row.error}</p>:<dl className="dns-record-values"><div><dt>{row.type==='A'?'IP address':'Port'}</dt><dd>{row.value}</dd></div>{row.target&&<div><dt>Target</dt><dd>{row.target}</dd></div>}</dl>}
 </div>)}
 </div></section>;
}
