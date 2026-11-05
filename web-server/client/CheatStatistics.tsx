import {ToggleSelector} from './Selectors';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api } from './types';
const categoryLabel=(type:string)=>/^other detected files$/i.test(type)?'Other':type.charAt(0).toUpperCase()+type.slice(1);
import { calculateCheatStats, calculateTypeOverlaps, playerCategorySegments, categoryColor } from './cheat-stats';
import type { CheatSnapshot, StatsFile } from './cheat-stats';

const format=(value:number)=>value.toFixed(2)+'%';
const palette=['#b9e884','#8bd2bc','#87abe4','#e8bf8c','#d29edc','#e3a29a','#b5c6c5'];

function FileBreakdown({files}:{files:StatsFile[]}) {
 const [limit,setLimit]=useState(20);
 return <details className="stats-file-breakdown"><summary>Files ({files.length} hashes)</summary>
  <div className="stats-file-rows">{files.slice(0,limit).map(file=><article className="stats-file-row" key={file.hash}>
   <div>{file.names.map(name=><strong key={name}>{name}</strong>)}</div>
   <code>{file.hash}</code><span className="muted">{file.players} {file.players===1?'player':'players'}</span>
  </article>)}</div>
  {limit<files.length&&<button className="secondary small" onClick={()=>setLimit(old=>old+20)}>Show more files</button>}
 </details>;
}

export function CheatStatistics({api}:{api:Api}) {
 const [snapshot,setSnapshot]=useState<CheatSnapshot|null>(null);
 const listRef=useRef<HTMLDivElement>(null),wheelRowRef=useRef<HTMLDivElement>(null);
 const [wheelSize,setWheelSize]=useState(170);
 const ready=!!snapshot;
 useEffect(()=>{
  const list=listRef.current,row=wheelRowRef.current;if(!list||!row)return;
  const resize=()=>{
   const width=row.clientWidth;
   // Use the list's height on desktop; stacked cards keep a compact wheel.
   const height=window.matchMedia('(min-width: 981px)').matches?list.getBoundingClientRect().height:170;
   setWheelSize(Math.max(1,Math.min(width,320,Math.max(170,Math.round(height)))));
  };
  const observer=new ResizeObserver(resize);observer.observe(list);observer.observe(row);resize();
  return()=>observer.disconnect();
 },[ready]);

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
   const firstLoad=!initialized.current;
   const previousTypeCount=knownTypes.current.length;
   setSelected(old=>firstLoad||old.length===previousTypeCount?next.types:old.filter(type=>next.types.includes(type)));
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
 const colorFor=(type:string)=>categoryColor(types.indexOf(type));
 let end=0;
 const donutStops=snapshot?playerCategorySegments(snapshot,selected).map(segment=>{
  const start=end;end+=segment.percentage;
  return `${colorFor(segment.type)} ${start}% ${end}%`;
 }):[];
 donutStops.push(`var(--line) ${end}% 100%`);
 const overlaps=snapshot?calculateTypeOverlaps(snapshot):null;
 const packetErrors=snapshot?.packetErrors??{timeouts:0,modified:0,other:0};
 const packetTotal=packetErrors.timeouts+packetErrors.modified+packetErrors.other;
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
     <div className="cheat-stats-donut-row" ref={wheelRowRef}>
      <div className="cheat-stats-donut" style={{width:wheelSize,height:wheelSize,flexBasis:wheelSize,background:`conic-gradient(${donutStops.join(',')})`}}>
       <div className="cheat-stats-donut-center"><strong>{format(stats.prevalence)}</strong><span>detected</span></div>
      </div>
      <div className="cheat-stats-numbers"><strong>{stats.detectedPlayers} / {snapshot.totalPlayers}</strong><span className="muted">unique players</span></div>
     </div>
     <p className="muted">Colors show selected categories. Players with multiple selected categories share their slice equally between them.</p>
     <div className="cheat-stats-types">
      <div className="cheat-stats-filter-heading"><strong>Include file categories</strong><button className="secondary small" onClick={()=>setSelected(types)} disabled={selected.length===types.length}>Select all</button><button className="secondary small" onClick={()=>setSelected([])} disabled={!selected.length}>Clear</button></div>
      {types.length?<ToggleSelector label="Include file categories" className="cheat-stats-checks" multiple options={types.map(type=>({value:type,label:categoryLabel(type),icon:<span className="cheat-category-swatch" style={{background:colorFor(type)}} aria-hidden="true"/>}))} value={selected} onChange={toggle}/>:<p className="muted">No classified detections found.</p>}
     </div>
    </article>
    <article className="card cheat-stats-panel">
     <h2>File category distribution</h2>
     <p className="muted">Share of {stats.totalOccurrences} unique player/hash combinations. Repeated detections of the same hash for a player count once. This chart always uses all types.</p>
     <div className="cheat-stats-bars" ref={listRef}>
      {stats.distribution.map(item=><div className="cheat-stats-bar" key={item.type}>
       <div className="cheat-stats-bar-title"><strong>{categoryLabel(item.type)}</strong><span>{format(item.percentage)} · {item.count} {item.count===1?'file':'files'}</span></div>
       <div className="cheat-stats-track"><div style={{width:item.percentage+'%',background:colorFor(item.type)}}/></div>
       {snapshot.fileBreakdown?.[item.type]?.length
        ?<FileBreakdown files={snapshot.fileBreakdown[item.type]}/>
        :<p className="muted stats-breakdown-unavailable">{snapshot.fileBreakdown
         ?'File details were not provided for this category.'
         :'File details are unavailable from the connected Minecraft server. Install the latest Admin Panel mod build and restart the Minecraft server.'}</p>}
      </div>)}
      {!stats.distribution.length&&<p className="muted">No detected cheat types to display.</p>}
     </div>
    </article>
   </div>
   {overlaps&&<article className="card cheat-stats-panel" id="type-overlap-statistics">
    <h2>Detection type overlaps</h2>
    <p className="muted">{overlaps.multipleTypes} of {overlaps.detectedPlayers} players with file detections have multiple types. Percentages use these {overlaps.detectedPlayers} detected players. This graph uses all types, independently of the wheel filters. Each player counts once.</p>
    <div className="cheat-stats-bars">
     {overlaps.counts.map(item=><div className="type-overlap-count" key={item.types}>
      <div className="cheat-stats-bar-title"><strong>{item.types} {item.types===1?'type':'types'}</strong><span>{item.count} {item.count===1?'player':'players'} · {format(item.percentage)}</span></div>
      <div className="cheat-stats-track"><div style={{width:item.percentage+'%',background:categoryColor(item.types-1)}}/></div>
     </div>)}
    </div>
    {!!overlaps.combinations.length&&<details className="stats-file-breakdown"><summary>Overlapping type combinations ({overlaps.combinations.length})</summary>
     <div className="stats-file-rows">{overlaps.combinations.map(item=><div className="type-overlap-combination" key={JSON.stringify(item.types)}>
      <div className="cheat-stats-bar-title"><strong>{item.types.map(categoryLabel).join(' + ')}</strong><span>{item.count} {item.count===1?'player':'players'} · {format(item.percentage)}</span></div>
      <div className="cheat-stats-track"><div style={{width:item.percentage+'%',background:colorFor(item.types[0]!)}}/></div>
     </div>)}</div>
    </details>}
    {!overlaps.detectedPlayers&&<p className="muted">No file detections recorded.</p>}
    {!!overlaps.detectedPlayers&&!overlaps.multipleTypes&&<p className="muted">No players have multiple detection types.</p>}
   </article>}
   <article className="card cheat-stats-panel" id="packet-error-statistics">
    <h2>Packet timeouts and errors</h2>
    <p className="muted">{packetTotal} player/issue combinations across known players. Each issue category counts once per player.</p>
    <div className="cheat-stats-bars">
     {([['timeouts','Timeouts'],['modified','Modified packets'],['other','Other errors']] as const).map(([key,label],i)=>{
      const count=packetErrors[key],percentage=packetTotal?count/packetTotal*100:0;
      return <div className="packet-error-bar" key={key}>
       <div className="cheat-stats-bar-title"><strong>{label}</strong><span>{count} players · {format(percentage)}</span></div>
       <div className="cheat-stats-track"><div style={{width:percentage+'%',background:palette[i%palette.length]}}/></div>
      </div>;
     })}
    </div>
    {!packetTotal&&<p className="muted">No packet timeouts or errors recorded.</p>}
   </article>
   <p className="muted">Players count once in the player percentage. Each distinct hash counts once per player in the file distribution. The distribution totals 100% before display rounding.</p>
  </>}
 </section>;
}
