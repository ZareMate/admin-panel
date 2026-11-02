import { useCallback, useEffect, useState } from 'react';
import { TsaLists } from './TsaLists';
import type { Api } from './types';
type Setting={key:string;type:'boolean'|'integer'|'list'|'string';value?:boolean|number|string|string[];secret:boolean;configured?:boolean};
type Snapshot={settings:Setting[]};
const label=(key:string)=>key.toLowerCase().split('_').map(word=>word[0]!.toUpperCase()+word.slice(1)).join(' ');
export function TsaConfiguration({api,canEdit,canEditLists}:{api:Api;canEdit:boolean;canEditLists:boolean}) {
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{setBusy(true);setError('');try{setSnapshot(await api<Snapshot>('/tsa/settings'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}},[api]);
 useEffect(()=>{void load();},[load]);
 const save=async(setting:string,value:unknown)=>{setBusy(true);setError('');setMessage('');try{setSnapshot(await api<Snapshot>('/tsa/settings',{setting,value}));setMessage(label(setting)+' saved.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <><TsaLists api={api} canEdit={canEditLists}/><details className="tsa-settings-details" open><summary>General settings</summary><section className="card tsa-configuration"><div className="section-header"><p>Server settings apply immediately and persist across restarts.</p><button className="secondary" disabled={busy} onClick={()=>void load()}>Reload settings</button></div>
 {!canEdit&&<p className="notice">You have read-only access to TSA settings.</p>}
 {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status">{message}</p>}
 {!snapshot&&!error&&<p>Loading TSA settings…</p>}
 {snapshot?.settings.map(row=><SettingField key={row.key+JSON.stringify(row.value)+String(row.configured)} row={row} disabled={busy||!canEdit} save={save}/>)}
 </section></details></>;
}
function SettingField({row,disabled,save}:{row:Setting;disabled:boolean;save:(key:string,value:unknown)=>Promise<void>}) {
 const original=row.secret?'':row.type==='list'?(row.value as string[]).join('\n'):String(row.value??'');
 const [value,setValue]=useState(original);
 useEffect(()=>{if(row.secret)setValue('');},[row]);
 const changed=row.secret?value.length>0:value!==original;
 return <form className="tsa-setting" onSubmit={e=>{e.preventDefault();const parsed=row.type==='boolean'?value==='true':row.type==='integer'?Number(value):row.type==='list'?value.split('\n').map(s=>s.trim()).filter(Boolean):value;void save(row.key,parsed);}}>
 <label htmlFor={'tsa-'+row.key}>{label(row.key)}</label>
 {row.secret&&<p className="muted">{row.configured?'Webhook URL is configured.':'No webhook URL configured.'} Leave blank to keep the current URL.</p>}
 {row.type==='boolean'?<select id={'tsa-'+row.key} disabled={disabled} value={value} onChange={e=>setValue(e.target.value)}><option value="true">Enabled</option><option value="false">Disabled</option></select>:
 row.key==='ENFORCEMENT_MODE'?<select id={'tsa-'+row.key} disabled={disabled} value={value} onChange={e=>setValue(e.target.value)}>{['off','kick','tempban'].map(mode=><option key={mode}>{mode}</option>)}</select>:
 row.type==='list'?<><textarea id={'tsa-'+row.key} disabled={disabled} rows={4} value={value} onChange={e=>setValue(e.target.value)}/><small>One entry per line. An empty field clears the list.</small></>:
 <input id={'tsa-'+row.key} disabled={disabled} type={row.secret?'password':row.type==='integer'?'number':'text'} step={row.type==='integer'?1:undefined} required={row.type==='integer'} autoComplete="off" value={value} onChange={e=>setValue(e.target.value)}/>}
 <button className="primary" disabled={disabled||!changed}>Save {label(row.key)}</button>
 {row.secret&&row.configured&&<button type="button" className="secondary" disabled={disabled} onClick={()=>void save(row.key,'')}>Clear webhook URL</button>}
 </form>;
}
