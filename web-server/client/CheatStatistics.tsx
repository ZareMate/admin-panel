import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api } from './types';
import { calculateCheatStats } from './cheat-stats';
import type { CheatSnapshot } from './cheat-stats';

const format=(value:number)=>value.toFixed(2)+'%';
const palette=['#b9e884','#8bd2bc','#87abe4','#e8bf8c','#d29edc','#e3a29a','#b5c6c5'];

export function CheatStatistics({api}:{api:Api}) {
 const [snapshot,setSnapshot]=useState<CheatSnapshot|null>(null);
 const [selected,setSelected]=useState<string[]>([]);
 const initialized=useRef(false);
 const knownTypes=useRef<string[]>([]);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(false);
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const next=await api<CheatSnapshot>('/stats');
   setSnapshot(next);
   setSelected(old=>!initialized.current||old.length===knownTypes.current.length?next.types:old.filter(type=>next.types.includes(type)));
   initialized.current=true;
   knownTypes.current=next.types;
  }catch(e){setError((e as Error).message);}
  finally{setLoading(false);}
 },[api]);
 useEffect(()=>{
  void load();
  const refresh=setInterval(()=>{if(!document.hidden)void load();},30000);
  return ()=>clearInterval(refresh);
 },[load]);
 const types=snapshot?.types??[];
 const stats=snapshot?calculateCheatStats(snapshot,selected):null;
 const toggle=(type:string)=>setSelected(old=>old.includes(type)?old.filter(item=>item!==type):[...old,type]);
 return <section id="cheat-statistics" className="cheat-statistics">
  <div className="card section-header"><div><h2>TSA cheat detection statistics</h2>
   <p className="muted">Known players and recorded TSA detections, including offline players. A detection is a report, not a final determination of cheating.</p></div>
   <button className="secondary" disabled={loading} onClick={()=>void load()}>Refresh statistics</button></div>
  {error&&<p role="alert" className="banner error">{error}</p>}
  {!snapshot&&<p className="loading">Loading statistics…</p>}
  {snapshot&&stats&&<>
   <div className="cheat-stats-grid">
    <article className="card cheat-stats-panel">
     <h2>Players with detections</h2>
     <p className="muted">Share of all {snapshot.totalPlayers} known players who have at least one selected detection type.</p>
     <div className="cheat-stats-donut-row">
      <div className="cheat-stats-donut" style={{background:`conic-gradient(var(--accent) 0% ${stats.prevalence}%, var(--line) ${stats.prevalence}% 100%)`}}>
       <div className="cheat-stats-donut-center"><strong>{format(stats.prevalence)}</strong><span>detected</span></div>
      </div>
      <div className="cheat-stats-numbers"><strong>{stats.detectedPlayers} / {snapshot.totalPlayers}</strong><span className="muted">unique players</span></div>
     </div>
     <div className="cheat-stats-types">
      <div className="cheat-stats-filter-heading"><strong>Include detection types</strong><button className="secondary small" onClick={()=>setSelected(types)} disabled={selected.length===types.length}>Select all</button><button className="secondary small" onClick={()=>setSelected([])} disabled={!selected.length}>Clear</button></div>
      {types.length?<div className="cheat-stats-checks">{types.map(type=><label key={type}><input type="checkbox" checked={selected.includes(type)} onChange={()=>toggle(type)}/>{type}</label>)}</div>:<p className="muted">No classified detections found.</p>}
     </div>
    </article>
    <article className="card cheat-stats-panel">
     <h2>Detection type distribution</h2>
     <p className="muted">Share of {stats.totalOccurrences} unique player/type combinations. Each player's repeated detections of the same type count once. This chart always uses all types.</p>
     <div className="cheat-stats-bars">
      {stats.distribution.map((item,i)=><div className="cheat-stats-bar" key={item.type}>
       <div className="cheat-stats-bar-title"><strong>{item.type}</strong><span>{format(item.percentage)} · {item.count} {item.count===1?'player':'players'}</span></div>
       <div className="cheat-stats-track"><div style={{width:item.percentage+'%',background:palette[i%palette.length]}}/></div>
      </div>)}
      {!stats.distribution.length&&<p className="muted">No detected cheat types to display.</p>}
     </div>
    </article>
   </div>
   <p className="muted">Players with multiple cheat types count once in the player percentage and once per type in the distribution. The distribution totals 100% before display rounding.</p>
  </>}
 </section>;
}
