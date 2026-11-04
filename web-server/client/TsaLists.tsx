import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Api } from './types';
import { sortHashesByFilename } from './tsa-sort';
import { filenameDetectionKeyword, matchesTsaNameOrHash, matchesTsaFileType, TSA_FILE_TYPES } from './tsa-filename-detection';
import type { TsaFileType } from './tsa-filename-detection';
import { sharedPageHeight, heightPages, matchingHeights } from './tsa-pagination';
import type { ColumnHeights, PageRange } from './tsa-pagination';
type Entry={hash:string;type:string;filename:string;playerCount?:number};
type Snapshot={lists:Record<string,string[]>;changed?:boolean};
type Names=Record<string,Entry[]>;
type TsaSetting={key:string;value?:unknown};
type Change={list:string;action:string;hash?:string;name?:string};
const PAGE_OPTIONS=[5,10,20,30,50,100] as const;
const CARD_GAP=12;
const filenameKey=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');
export function TsaLists({api,canEdit}:{api:Api;canEdit:boolean}) {
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[settings,setSettings]=useState<TsaSetting[]>([]),[names,setNames]=useState<Names>({}),[unlisted,setUnlisted]=useState<Entry[]>([]),[scanned,setScanned]=useState(0);
 const [error,setError]=useState(''),[inventoryError,setInventoryError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[queries,setQueries]=useState<Record<string,string>>({});
 const [typeFilters,setTypeFilters]=useState<Record<string,TsaFileType[]>>({});
 const [pageSize,setPageSize]=useState<number>(20);
 const [measurements,setMeasurements]=useState<Record<string,ColumnHeights>>({});
 const measureRefs=useRef<Record<string,HTMLDivElement|null>>({});
 const [pages,setPages]=useState<Record<string,number>>({}),[dragging,setDragging]=useState<string|null>(null),[over,setOver]=useState<string|null>(null);
 const [unlistedPage,setUnlistedPage]=useState(0),[returned,setReturned]=useState<Record<string,Entry[]>>({});
 const dragged=useRef<string|null>(null);
 const mutation=useRef(false),namesRef=useRef(names);namesRef.current=names;
 const load=useCallback(async()=>{
  setError('');setInventoryError('');setBusy(true);
  await Promise.all([
   api<Snapshot>('/tsa/lists').then(result=>{
    // Reset the cache with the new snapshot so its lookup effect can refill names.
    namesRef.current={};setNames({});setReturned({});setSnapshot(result);
   }).catch(e=>setError((e as Error).message)),
   api<{entries:Entry[];playersScanned:number}>('/tsa/unlisted').then(result=>{setUnlisted(result.entries);setScanned(result.playersScanned);}).catch(e=>setInventoryError((e as Error).message)),
   api<{settings:TsaSetting[]}>('/tsa/settings').then(result=>setSettings(result.settings??[])).catch(e=>setError((e as Error).message))
  ]);setBusy(false);
 },[api]);
 useEffect(()=>{void load();},[load]);
 // Fill names in bounded batches. Each observed hash is looked up only once until reload.
 useEffect(()=>{
  if(!snapshot?.lists)return;let active=true;
  const hashes=[...new Set(['BLACKLISTED','ALLOWED','ENFORCEMENT'].flatMap(key=>snapshot.lists[key]??[]))];
  void(async()=>{for(let offset=0;offset<hashes.length;offset+=50){
   const missing=hashes.slice(offset,offset+50).filter(hash=>!(hash in namesRef.current));if(!missing.length)continue;
   try{const result=await api<{names:Names}>('/tsa/names',{hashes:missing});if(!active)return;setNames(previous=>({...previous,...result.names}));}
   catch(e){if(active)setError((e as Error).message);return;}
  }})();return()=>{active=false;};
 },[api,snapshot]);
 const run=async(changes:Change[],message='List updated.')=>{
  if(mutation.current||!canEdit)return false;mutation.current=true;setBusy(true);setError('');setStatus('');
  try{let next:Snapshot|undefined;for(const change of changes)next=await api<Snapshot>('/tsa/lists',change);if(next)setSnapshot(next);setStatus(message);return true;}
  catch(e){setError((e as Error).message+' Reload lists to check the current state.');return false;}
  finally{mutation.current=false;setBusy(false);}
 };
 const move=async(hash:string,target:string)=>{
  const leavingAllowed=snapshot?.lists?.ALLOWED?.includes(hash)??false;
  const changes:Change[]=target==='UNLISTED'
   // Keep the allowance until both punishment sources have been cleared.
   ? ['ENFORCEMENT','BLACKLISTED','ALLOWED'].map(list=>({list,action:'remove',hash}))
   : [...(target==='BLACKLISTED'&&leavingAllowed?[{list:'ENFORCEMENT',action:'remove',hash}]:[]),
      {list:target,action:'add',hash},
      ...(target==='ALLOWED'?[{list:'ENFORCEMENT',action:'remove',hash}]:[]),
      {list:target==='ALLOWED'?'BLACKLISTED':'ALLOWED',action:'remove',hash}];
  const done=await run(changes,'Hash moved to '+(target==='ALLOWED'?'Allow list':target==='BLACKLISTED'?'Blacklist':'Unlisted')+'.');
  if(done&&target==='UNLISTED'&&!unlisted.some(entry=>entry.hash===hash))setReturned(previous=>({...previous,[hash]:namesRef.current[hash]?.length?namesRef.current[hash]:[{hash,type:'',filename:'Unknown filename'}]}));
  return done;
 };
 const list=(key:string)=>snapshot?.lists?.[key]??[];
 const enforced=new Set(list('ENFORCEMENT')),allowed=new Set(list('ALLOWED')),blacklisted=new Set(list('BLACKLISTED'));
 const blacklist=sortHashesByFilename([...new Set([...blacklisted,...enforced])].filter(hash=>!allowed.has(hash)),names,enforced);
 const allowlist=sortHashesByFilename([...allowed],names);
 const matches=(hash:string,column:string,entries:Entry[]=names[hash]??[])=>{
  const filenames=entries.map(entry=>entry.filename);
  return matchesTsaNameOrHash(hash,filenames,queries[column]??'')
   &&matchesTsaFileType(filenames,new Set(typeFilters[column]??TSA_FILE_TYPES));
 };
 const toggleType=(column:string,type:TsaFileType)=>{
  setTypeFilters(previous=>{
   const selected=previous[column]??[...TSA_FILE_TYPES];
   return {...previous,[column]:selected.includes(type)?selected.filter(value=>value!==type):[...selected,type]};
  });
  setPages(previous=>({...previous,[column]:0}));
  if(column==='UNLISTED')setUnlistedPage(0);
 };
 const setFilter=(column:string,value:string)=>{setQueries(previous=>({...previous,[column]:value}));setPages(previous=>({...previous,[column]:0}));if(column==='UNLISTED')setUnlistedPage(0);};
 const allowedNames=new Set(list('FILENAMES').map(filenameKey));
 const settingNames=(key:string):string[]=>{
  const value=settings.find(setting=>setting.key===key)?.value;
  return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];
 };
 const keywordSettingsPresent=settings.some(setting=>setting.key==='FILENAME_DETECTION_KEYWORDS');
 const detectionKeywords=settingNames('FILENAME_DETECTION_KEYWORDS');
 const exemptions=[...list('FILENAMES'),...settingNames('RAY_FILENAME_ALLOWLIST')];
 const candidates=new Map<string,Entry[]>();
 for(const entry of [...unlisted,...Object.values(returned).flat()]) {
  if(allowedNames.has(filenameKey(entry.filename)))continue;
  const entries=candidates.get(entry.hash)??[];
  if(!entries.some(known=>known.filename===entry.filename&&known.type===entry.type))entries.push(entry);
  candidates.set(entry.hash,entries);
 }
 const unresolved=[...candidates.keys()].filter(hash=>!allowed.has(hash)&&!blacklisted.has(hash)&&!enforced.has(hash)
  && matches(hash,'UNLISTED',candidates.get(hash)!)).sort((left,right)=>
  (candidates.get(left)?.[0]?.filename??left).localeCompare(candidates.get(right)?.[0]?.filename??right,undefined,{sensitivity:'base'}));
 const filtered:Record<string,string[]>={
  BLACKLISTED:blacklist.filter(hash=>matches(hash,'BLACKLISTED')),
  ALLOWED:allowlist.filter(hash=>matches(hash,'ALLOWED')),
  UNLISTED:unresolved,
 };
 const measured=Object.fromEntries(Object.entries(filtered).map(([id,hashes])=>[id,matchingHeights(hashes,measurements[id])])) as Record<string,number[]|null>;
 const measuredReady=Object.values(measured).every(heights=>heights!==null);
 const budget=measuredReady?sharedPageHeight(Object.values(measured) as number[][],pageSize,CARD_GAP):0;
 const ranges:Record<string,PageRange[]>=Object.fromEntries(Object.entries(filtered).map(([id,hashes])=>
  [id,measuredReady?heightPages(measured[id]!,budget,pageSize,CARD_GAP):
   Array.from({length:Math.ceil(hashes.length/pageSize)},(_,i)=>({start:i*pageSize,end:Math.min((i+1)*pageSize,hashes.length)}))]));
 const stateFor=(id:string,requested:number)=>{
  const sections=ranges[id]??[];
  const index=Math.min(requested,Math.max(0,sections.length-1));
  return {index,total:sections.length,range:sections[index]??{start:0,end:0}};
 };
 const unlistedState=stateFor('UNLISTED',unlistedPage);
 const hashCard=(hash:string,column:string,measuring=false)=><article className={'card todo-task '+(measuring?'tsa-measure-card':'tsa-hash-card')+' '+(!measuring&&dragging===hash?'dragging':'')} key={hash} data-hash={measuring?undefined:hash} data-measure-hash={measuring?hash:undefined} draggable={!measuring&&canEdit&&!busy}
  onDragStart={event=>{if(measuring){event.preventDefault();return;}if((event.target as HTMLElement).closest('button,input,select,textarea')){event.preventDefault();return;}event.dataTransfer.setData('text/plain',hash);event.dataTransfer.effectAllowed='move';dragged.current=hash;setDragging(hash);}}
  onDragEnd={()=>{dragged.current=null;setDragging(null);setOver(null);}}>
  <FileLabel hash={hash} entries={names[hash]} reason={column==='BLACKLISTED'&&blacklisted.has(hash)&&keywordSettingsPresent
   ? (()=>{const keyword=filenameDetectionKeyword((names[hash]??[]).map(entry=>entry.filename),detectionKeywords,exemptions);
      return keyword?'Filename contains "'+keyword+'" (current rule)':'Reason unknown (no current keyword match)';})()
   : undefined}/>
  {column==='BLACKLISTED'&&!blacklisted.has(hash)&&<p className="muted">Enforcement only</p>}
  <div className="board-actions">
   {column==='BLACKLISTED'&&<button className={'secondary small enforcement-toggle '+(enforced.has(hash)?'enabled':'')} role="switch" aria-checked={enforced.has(hash)} aria-label={'Enforcement for '+hash} disabled={!canEdit||busy} onClick={()=>void run([{list:'ENFORCEMENT',action:enforced.has(hash)?'remove':'add',hash}],enforced.has(hash)?'Enforcement disabled for this hash.':'Enforcement enabled for this hash.')}>Enforcement {enforced.has(hash)?'on':'off'}</button>}
   <button className="secondary small" disabled={!canEdit||busy} onClick={()=>void move(hash,column==='BLACKLISTED'?'ALLOWED':'BLACKLISTED')}>{column==='BLACKLISTED'?'Allow':'Blacklist'}</button>
   <button className="secondary small" disabled={!canEdit||busy} onClick={()=>void move(hash,'UNLISTED')}>Unlist</button>
  </div>
 </article>;
 const unlistedCard=(hash:string,measuring=false)=><article className={'card todo-task '+(measuring?'tsa-measure-card':'tsa-hash-card')+' '+(!measuring&&dragging===hash?'dragging':'')}
  key={hash} data-hash={measuring?undefined:hash} data-measure-hash={measuring?hash:undefined} draggable={!measuring&&canEdit&&!busy}
  onDragStart={event=>{if(measuring||((event.target as HTMLElement).closest('button,input,select,textarea'))){event.preventDefault();return;}
   dragged.current=hash;setDragging(hash);event.dataTransfer.setData('text/plain',hash);event.dataTransfer.effectAllowed='move';}}
  onDragEnd={()=>{dragged.current=null;setDragging(null);setOver(null);}}>
  <FileLabel hash={hash} entries={candidates.get(hash)}/>
  <div className="board-actions"><button className="secondary small" disabled={!canEdit||busy} onClick={()=>void move(hash,'BLACKLISTED')}>Blacklist</button>
   <button className="secondary small" disabled={!canEdit||busy} onClick={()=>void move(hash,'ALLOWED')}>Allow</button></div>
 </article>;
 // Off-screen cards have identical widths/content to the live cards, so wrapping and reason
 // text contribute their real rendered heights rather than a guessed per-item average.
 useLayoutEffect(()=>{
  const read=()=>{
   const next:Record<string,ColumnHeights>={};
   for(const id of ['BLACKLISTED','ALLOWED','UNLISTED']){
    const root=measureRefs.current[id];
    if(!root)continue;
    const cards=Array.from(root.querySelectorAll<HTMLElement>('[data-measure-hash]'));
    next[id]={hashes:cards.map(card=>card.dataset.measureHash??''),heights:cards.map(card=>card.getBoundingClientRect().height)};
   }
   setMeasurements(previous=>{
    const ids=Object.keys(next);
    const unchanged=ids.every(id=>{
     const a=previous[id],b=next[id];
     return a&&a.hashes.length===b.hashes.length&&
      a.hashes.every((value,index)=>value===b.hashes[index]&&Math.abs(a.heights[index]-b.heights[index])<.5);
    });
    return unchanged?previous:{...previous,...next};
   });
  };
  read();
  const observer=new ResizeObserver(read);
  for(const element of Object.values(measureRefs.current))if(element)observer.observe(element);
  return ()=>observer.disconnect();
 },[snapshot,names,settings,unlisted,returned,queries,typeFilters,pageSize]);
 return <section id="tsa-board"><div className="card section-header"><div><h2>Hash and filename lists</h2><p className="muted">Drag a hash between columns, or use Allow and Blacklist. Enforcement follows TSA’s global mode.</p></div><button className="secondary" disabled={busy} onClick={()=>void load()}>Reload lists</button></div>
 {!canEdit&&<p className="notice">You have read-only access to TSA lists.</p>}{error&&<p className="banner error" role="alert">{error}</p>}{status&&<p className="notice" role="status">{status}</p>}
 <div className="tsa-pagination-control"><label htmlFor="tsa-page-size">Reference page size</label><select id="tsa-page-size" aria-label="TSA reference page size" value={pageSize} onChange={event=>{setPageSize(Number(event.target.value));setPages({});setUnlistedPage(0);}}>{PAGE_OPTIONS.map(size=><option key={size} value={size}>{size} items</option>)}</select><span className="muted">The shortest {pageSize}-item column sets a shared card-height budget.</span></div>
 <div className="todo-columns tsa-columns">{[['BLACKLISTED','Blacklist'],['ALLOWED','Allow list']] .map(([key,title])=>{
  const id=key as string,hashes=filtered[id],paging=stateFor(id,pages[id]??0);
  return <section className={'todo-column '+(over===id?'drop-target':'')} data-tsa-list={id} key={id}
   onDragOver={event=>{if(canEdit&&!busy&&dragged.current){event.preventDefault();event.dataTransfer.dropEffect='move';setOver(id);}}}
   onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setOver(null);}}
   onDrop={event=>{event.preventDefault();const hash=dragged.current;dragged.current=null;setDragging(null);setOver(null);if(hash&&canEdit&&!busy)void move(hash,id);}}>
   <header><h2>{title as string}</h2><span className="pill">{hashes.length}</span></header>
   <input className="board-search" type="search" aria-label={'Filter '+title+' by name or hash'} placeholder="Filter by name or hash…" value={queries[id]??''} onChange={event=>setFilter(id,event.target.value)}/>
   <TypeFilters column={id} selected={typeFilters[id]??TSA_FILE_TYPES} toggle={type=>toggleType(id,type)}/>
   <AddHash id={id} disabled={!snapshot||!canEdit||busy} add={hash=>run([{list:id,action:'add',hash}])}/>
   <div className="tsa-page-cards">{hashes.slice(paging.range.start,paging.range.end).map(hash=>hashCard(hash,id))}</div>
   {!hashes.length&&<p className="empty">No matching entries.</p>}
   <Pages page={paging.index} total={paging.total} change={value=>setPages(previous=>({...previous,[id]:value}))}/>
   <div className="tsa-measure-list" aria-hidden="true" inert={true} ref={node=>{measureRefs.current[id]=node;}}>
    {hashes.map(hash=>hashCard(hash,id,true))}
   </div>
  </section>;
 })}
 <section className={'todo-column '+(over==='UNLISTED'?'drop-target':'')} data-tsa-list="UNLISTED"
  onDragOver={event=>{if(canEdit&&!busy&&dragged.current){event.preventDefault();event.dataTransfer.dropEffect='move';setOver('UNLISTED');}}}
  onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setOver(null);}}
  onDrop={event=>{event.preventDefault();const hash=dragged.current;dragged.current=null;setDragging(null);setOver(null);if(hash&&canEdit&&!busy)void move(hash,'UNLISTED');}}>
  <header><h2>Unlisted</h2><span className="pill">{unresolved.length}</span></header>
  <p className="muted">Files from the latest cached scans of {scanned} player(s). Drag here to remove a hash from all hash lists. Run /tsa unlisted in-game for fresh inventories.</p>
  <input className="board-search" type="search" aria-label="Filter Unlisted by name or hash" placeholder="Filter by name or hash…" value={queries.UNLISTED??''} onChange={event=>setFilter('UNLISTED',event.target.value)}/>
  <TypeFilters column="UNLISTED" selected={typeFilters.UNLISTED??TSA_FILE_TYPES} toggle={type=>toggleType('UNLISTED',type)}/>
  {inventoryError&&<p className="error" role="alert">{inventoryError}</p>}
  <div className="tsa-page-cards">{unresolved.slice(unlistedState.range.start,unlistedState.range.end).map(hash=>unlistedCard(hash))}</div>
  {!unresolved.length&&!inventoryError&&<p className="empty">No unlisted files in cached scans.</p>}
  <Pages page={unlistedState.index} total={unlistedState.total} change={setUnlistedPage}/>
  <div className="tsa-measure-list" aria-hidden="true" inert={true} ref={node=>{measureRefs.current.UNLISTED=node;}}>
   {unresolved.map(hash=>unlistedCard(hash,true))}
  </div>
 </section></div>
 <details className="card tsa-filename-list"><summary>Allowed filenames ({list('FILENAMES').length})</summary><p className="muted">Filename exemptions, separate from allowed hashes.</p>
  <FilenameEditor entries={list('FILENAMES')} disabled={!canEdit||busy||!snapshot} run={run}/>
 </details>
 </section>;
}
function TypeFilters({column,selected,toggle}:{column:string;selected:readonly TsaFileType[];toggle:(type:TsaFileType)=>void}) {
 return <div className="tsa-type-filters" role="group" aria-label={column+' file type filters'}>
  {TSA_FILE_TYPES.map(type=><button key={type} type="button" className={'secondary small tsa-type-filter '+(selected.includes(type)?'active':'')}
   aria-label={column+' '+(type==='other'?'Other':'.'+type)} aria-pressed={selected.includes(type)} onClick={()=>toggle(type)}>
   {type==='other'?'Other':'.'+type}
  </button>)}
 </div>;
}
function FileLabel({hash,entries,reason}:{hash:string;entries?:Entry[];reason?:string}) {
 const labels=[...new Set(entries?.map(entry=>entry.filename)??[])];
 return <div className="tsa-file-label"><strong>{labels.length?labels.join(', '):entries?'Unknown filename':'Loading filename…'}</strong>
  <div className="tsa-hash-meta"><small className="tsa-hash">{hash}</small>{reason&&<small className="muted tsa-blacklist-reason">{reason}</small>}</div>
 </div>;
}
function Pages({page,total,change}:{page:number;total:number;change:(value:number)=>void}) {
 if(total<=1)return null;return <div className="board-actions"><button className="secondary small" disabled={!page} onClick={()=>change(page-1)}>Previous</button><span>{page+1} / {total}</span><button className="secondary small tsa-page-nav-next" disabled={page+1>=total} onClick={()=>change(page+1)}>Next</button></div>;
}
function AddHash({id,disabled,add}:{id:string;disabled:boolean;add:(hash:string)=>Promise<boolean>}) {
 const [hash,setHash]=useState('');return <form className="tsa-list-add" onSubmit={async event=>{event.preventDefault();if(await add(hash))setHash('');}}><label>SHA-256 hash<input aria-label={'Add hash to '+id} required pattern="[a-fA-F0-9]{64}" maxLength={64} disabled={disabled} value={hash} onChange={event=>setHash(event.target.value.trim().toLowerCase())}/></label><button className="primary" disabled={disabled}>Add entry</button></form>;
}
function FilenameEditor({entries,disabled,run}:{entries:string[];disabled:boolean;run:(changes:Change[])=>Promise<boolean>}) {
 const [name,setName]=useState('');return <><ul>{entries.map(entry=><li key={entry}>{entry}<button className="danger small" disabled={disabled} onClick={()=>void run([{list:'FILENAMES',action:'remove',name:entry}])}>Remove</button></li>)}</ul><form onSubmit={async event=>{event.preventDefault();if(await run([{list:'FILENAMES',action:'add',name}]))setName('');}}><label>Filename<input required value={name} maxLength={1024} disabled={disabled} onChange={event=>setName(event.target.value)}/></label><button className="primary" disabled={disabled}>Add filename</button></form></>;
}
