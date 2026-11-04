import { useCallback, useEffect, useRef, useState } from 'react';
import type { Api } from './types';
type Entry={hash:string;type:string;filename:string;playerCount?:number};
type Snapshot={lists:Record<string,string[]>;changed?:boolean};
type Names=Record<string,Entry[]>;
type Change={list:string;action:string;hash?:string;name?:string};
const PAGE=30;
const filenameKey=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');
export function TsaLists({api,canEdit}:{api:Api;canEdit:boolean}) {
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[names,setNames]=useState<Names>({}),[unlisted,setUnlisted]=useState<Entry[]>([]),[scanned,setScanned]=useState(0);
 const [error,setError]=useState(''),[inventoryError,setInventoryError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[queries,setQueries]=useState<Record<string,string>>({});
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
   api<{entries:Entry[];playersScanned:number}>('/tsa/unlisted').then(result=>{setUnlisted(result.entries);setScanned(result.playersScanned);}).catch(e=>setInventoryError((e as Error).message))
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
 // Sort by the filename users actually see, not by enforcement state or SHA-256.
 // Hashes without a known name always appear after named entries.
 const label=(hash:string)=>names[hash]?.find(entry=>entry.filename.trim())?.filename.trim()??'';
 const byFilename=(left:string,right:string)=>{
  const a=label(left),b=label(right);
  return Number(!a)-Number(!b)||
   (a||left).localeCompare(b||right,undefined,{sensitivity:'base'})||
   left.localeCompare(right);
 };
 const blacklist=[...new Set([...blacklisted,...enforced])].filter(hash=>!allowed.has(hash)).sort(byFilename);
 const allowlist=[...allowed].sort(byFilename);
 const matches=(hash:string,column:string,entries:Entry[]=names[hash]??[])=>[hash,...entries.map(entry=>entry.filename)]
  .join(' ').toLocaleLowerCase().includes((queries[column]??'').trim().toLocaleLowerCase());
 const setFilter=(column:string,value:string)=>{setQueries(previous=>({...previous,[column]:value}));setPages(previous=>({...previous,[column]:0}));if(column==='UNLISTED')setUnlistedPage(0);};
 const allowedNames=new Set(list('FILENAMES').map(filenameKey));
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
 const unlistedCurrent=Math.min(unlistedPage,Math.max(0,Math.ceil(unresolved.length/PAGE)-1));
 const hashCard=(hash:string,column:string)=><article className={'card todo-task tsa-hash-card '+(dragging===hash?'dragging':'')} key={hash} data-hash={hash} draggable={canEdit&&!busy}
  onDragStart={event=>{if((event.target as HTMLElement).closest('button,input,select,textarea')){event.preventDefault();return;}event.dataTransfer.setData('text/plain',hash);event.dataTransfer.effectAllowed='move';dragged.current=hash;setDragging(hash);}}
  onDragEnd={()=>{dragged.current=null;setDragging(null);setOver(null);}}>
  <FileLabel hash={hash} entries={names[hash]} />
  {column==='BLACKLISTED'&&!blacklisted.has(hash)&&<p className="muted">Enforcement only</p>}
  <div className="board-actions">
   {column==='BLACKLISTED'&&<button className={'secondary small enforcement-toggle '+(enforced.has(hash)?'enabled':'')} role="switch" aria-checked={enforced.has(hash)} aria-label={'Enforcement for '+hash} disabled={!canEdit||busy} onClick={()=>void run([{list:'ENFORCEMENT',action:enforced.has(hash)?'remove':'add',hash}],enforced.has(hash)?'Enforcement disabled for this hash.':'Enforcement enabled for this hash.')}>Enforcement {enforced.has(hash)?'on':'off'}</button>}
   <button className="secondary small" disabled={!canEdit||busy} onClick={()=>void move(hash,column==='BLACKLISTED'?'ALLOWED':'BLACKLISTED')}>{column==='BLACKLISTED'?'Allow':'Blacklist'}</button>
   <button className="secondary small" disabled={!canEdit||busy} onClick={()=>void move(hash,'UNLISTED')}>Unlist</button>
  </div>
 </article>;
 return <section id="tsa-board"><div className="card section-header"><div><h2>Hash and filename lists</h2><p className="muted">Drag a hash between columns, or use Allow and Blacklist. Enforcement follows TSA’s global mode.</p></div><button className="secondary" disabled={busy} onClick={()=>void load()}>Reload lists</button></div>
 {!canEdit&&<p className="notice">You have read-only access to TSA lists.</p>}{error&&<p className="banner error" role="alert">{error}</p>}{status&&<p className="notice" role="status">{status}</p>}
 <div className="todo-columns tsa-columns">{[['BLACKLISTED','Blacklist',blacklist],['ALLOWED','Allow list',allowlist]] .map(([key,title,values])=>{
  const id=key as string,hashes=(values as string[]).filter(hash=>matches(hash,id)),page=Math.min(pages[id]??0,Math.max(0,Math.ceil(hashes.length/PAGE)-1));
  return <section className={'todo-column '+(over===id?'drop-target':'')} data-tsa-list={id} key={id}
   onDragOver={event=>{if(canEdit&&!busy&&dragged.current){event.preventDefault();event.dataTransfer.dropEffect='move';setOver(id);}}}
   onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setOver(null);}}
   onDrop={event=>{event.preventDefault();const hash=dragged.current;dragged.current=null;setDragging(null);setOver(null);if(hash&&canEdit&&!busy)void move(hash,id);}}>
   <header><h2>{title as string}</h2><span className="pill">{hashes.length}</span></header>
   <input className="board-search" type="search" aria-label={'Filter '+title+' by name or hash'} placeholder="Filter by name or hash…" value={queries[id]??''} onChange={event=>setFilter(id,event.target.value)}/>
   <AddHash id={id} disabled={!snapshot||!canEdit||busy} add={hash=>run([{list:id,action:'add',hash}])}/>
   {hashes.slice(page*PAGE,page*PAGE+PAGE).map(hash=>hashCard(hash,id))}{!hashes.length&&<p className="empty">No matching entries.</p>}
   <Pages page={page} count={hashes.length} change={value=>setPages(previous=>({...previous,[id]:value}))}/>
  </section>;
 })}
 <section className={'todo-column '+(over==='UNLISTED'?'drop-target':'')} data-tsa-list="UNLISTED"
  onDragOver={event=>{if(canEdit&&!busy&&dragged.current){event.preventDefault();event.dataTransfer.dropEffect='move';setOver('UNLISTED');}}}
  onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setOver(null);}}
  onDrop={event=>{event.preventDefault();const hash=dragged.current;dragged.current=null;setDragging(null);setOver(null);if(hash&&canEdit&&!busy)void move(hash,'UNLISTED');}}>
  <header><h2>Unlisted</h2><span className="pill">{unresolved.length}</span></header>
  <p className="muted">Files from the latest cached scans of {scanned} player(s). Drag here to remove a hash from all hash lists. Run /tsa unlisted in-game for fresh inventories.</p>
  <input className="board-search" type="search" aria-label="Filter Unlisted by name or hash" placeholder="Filter by name or hash…" value={queries.UNLISTED??''} onChange={event=>setFilter('UNLISTED',event.target.value)}/>
  {inventoryError&&<p className="error" role="alert">{inventoryError}</p>}
  {unresolved.slice(unlistedCurrent*PAGE,unlistedCurrent*PAGE+PAGE).map(hash=><article className={'card todo-task tsa-hash-card '+(dragging===hash?'dragging':'')} key={hash} data-hash={hash} draggable={canEdit&&!busy} onDragStart={event=>{if((event.target as HTMLElement).closest('button')){event.preventDefault();return;}dragged.current=hash;setDragging(hash);event.dataTransfer.setData('text/plain',hash);event.dataTransfer.effectAllowed='move';}} onDragEnd={()=>{dragged.current=null;setDragging(null);setOver(null);}}>
   <FileLabel hash={hash} entries={candidates.get(hash)}/>
   <div className="board-actions"><button className="secondary small" disabled={!canEdit||busy} onClick={()=>void move(hash,'BLACKLISTED')}>Blacklist</button><button className="secondary small" disabled={!canEdit||busy} onClick={()=>void move(hash,'ALLOWED')}>Allow</button></div>
  </article>)}{!unresolved.length&&!inventoryError&&<p className="empty">No unlisted files in cached scans.</p>}
  <Pages page={unlistedCurrent} count={unresolved.length} change={setUnlistedPage}/>
 </section></div>
 <details className="card tsa-filename-list"><summary>Allowed filenames ({list('FILENAMES').length})</summary><p className="muted">Filename exemptions, separate from allowed hashes.</p>
  <FilenameEditor entries={list('FILENAMES')} disabled={!canEdit||busy||!snapshot} run={run}/>
 </details>
 </section>;
}
function FileLabel({hash,entries}:{hash:string;entries?:Entry[]}) {
 const labels=[...new Set(entries?.map(entry=>entry.filename)??[])];
 return <div className="tsa-file-label"><strong>{labels.length?labels.join(', '):entries?'Unknown filename':'Loading filename…'}</strong><small className="tsa-hash">{hash}</small></div>;
}
function Pages({page,count,change}:{page:number;count:number;change:(value:number)=>void}) {
 if(count<=PAGE)return null;return <div className="board-actions"><button className="secondary small" disabled={!page} onClick={()=>change(page-1)}>Previous</button><span>{page+1} / {Math.ceil(count/PAGE)}</span><button className="secondary small" disabled={(page+1)*PAGE>=count} onClick={()=>change(page+1)}>Next</button></div>;
}
function AddHash({id,disabled,add}:{id:string;disabled:boolean;add:(hash:string)=>Promise<boolean>}) {
 const [hash,setHash]=useState('');return <form className="tsa-list-add" onSubmit={async event=>{event.preventDefault();if(await add(hash))setHash('');}}><label>SHA-256 hash<input aria-label={'Add hash to '+id} required pattern="[a-fA-F0-9]{64}" maxLength={64} disabled={disabled} value={hash} onChange={event=>setHash(event.target.value.trim().toLowerCase())}/></label><button className="primary" disabled={disabled}>Add entry</button></form>;
}
function FilenameEditor({entries,disabled,run}:{entries:string[];disabled:boolean;run:(changes:Change[])=>Promise<boolean>}) {
 const [name,setName]=useState('');return <><ul>{entries.map(entry=><li key={entry}>{entry}<button className="danger small" disabled={disabled} onClick={()=>void run([{list:'FILENAMES',action:'remove',name:entry}])}>Remove</button></li>)}</ul><form onSubmit={async event=>{event.preventDefault();if(await run([{list:'FILENAMES',action:'add',name}]))setName('');}}><label>Filename<input required value={name} maxLength={1024} disabled={disabled} onChange={event=>setName(event.target.value)}/></label><button className="primary" disabled={disabled}>Add filename</button></form></>;
}
