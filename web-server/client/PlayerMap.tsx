import {ToggleSelector} from './Selectors';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {Api,Session} from './types';
import {useMapHeads} from './map-heads';
import {has} from '../src/permissions';

type WorldSpawn={dimension:string;x:number;y:number;z:number};
type MapPlayer={online?:boolean;savedAt?:number;uuid:string;name:string;dimension:string;x:number;y:number;z:number};
type ClaimTeam={id:string;name:string;color:string;chunks:{x:number;z:number;forceLoaded:boolean}[]};
type Claims={available:boolean;reason?:string;truncated?:boolean;teams:ClaimTeam[]};
type Region={name:string;x:number;z:number;updatedAt:number};
const dimensions=['minecraft:overworld','minecraft:the_nether','minecraft:the_end'];
const dimensionLabel=(value:string)=>value.slice(value.indexOf(':')+1).replace(/[_/\-]+/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());
const boundedZoom=(value:number)=>Math.min(8,Math.max(.05,value));
export function PlayerMap({api,session}:{api:Api;session:Session}) {
 const [dimension,setDimension]=useState(dimensions[0]!);
 const [serverDimensions,setServerDimensions]=useState<string[]>([]);
 const [players,setPlayers]=useState<MapPlayer[]>([]),[regions,setRegions]=useState<Region[]>([]);
 const [spawn,setSpawn]=useState<WorldSpawn|null>(null);
 const initialCentered=useRef(false);
 const [center,setCenter]=useState({x:0,z:0}),[zoom,setZoom]=useState(.5);
 const [showClaims,setShowClaims]=useState(true),[claims,setClaims]=useState<Claims|null>(null);
 const [claimError,setClaimError]=useState(''),[hoveredClaim,setHoveredClaim]=useState('');
 const [showOffline,setShowOffline]=useState(false);
 const [follow,setFollow]=useState(''),[search,setSearch]=useState('');
 const [error,setError]=useState(''),[terrainError,setTerrainError]=useState(''),[message,setMessage]=useState('');
 const [updated,setUpdated]=useState(0),[uploading,setUploading]=useState(false),[imageVersion,setImageVersion]=useState(0);
 const [size,setSize]=useState({width:800,height:600});
 const currentDimension=useRef(dimension);currentDimension.current=dimension;
 const canvas=useRef<HTMLCanvasElement>(null),viewport=useRef<HTMLDivElement>(null);
 const cache=useRef(new Map<string,HTMLImageElement>()),drag=useRef<{x:number;y:number;center:{x:number;z:number}}|null>(null);
 const shownPlayers=players.filter(player=>showOffline||player.online!==false);
 const visiblePlayers=shownPlayers.filter(player=>player.dimension===dimension);
 const headNames=visiblePlayers.filter(player=>Math.abs((player.x-center.x)*zoom)<size.width/2+40&&Math.abs((player.z-center.z)*zoom)<size.height/2+40).map(player=>player.uuid);
 const heads=useMapHeads(headNames);
 const claimCells=useMemo(()=>{
  const cells=new Map<string,{team:ClaimTeam;forceLoaded:boolean}>();
  if(showClaims)for(const team of claims?.teams??[])for(const chunk of team.chunks)cells.set(chunk.x+','+chunk.z,{team,forceLoaded:chunk.forceLoaded});
  return cells;
 },[claims,showClaims]);
 useEffect(()=>{
  let stopped=false;setClaims(null);setClaimError('');setHoveredClaim('');
  if(!showClaims)return;
  const load=async()=>{try{
   const result=await api<Claims>('/map/claims?dimension='+encodeURIComponent(dimension));
   if(!stopped){setClaims(result);setClaimError('');}
  }catch(e){if(!stopped){setClaims(null);setClaimError((e as Error).message);}}};
  void load();const timer=setInterval(()=>{if(!document.hidden)void load();},30000);
  return()=>{stopped=true;clearInterval(timer);};
 },[api,dimension,showClaims]);
 const loadRegions=useCallback(async()=>{
  const result=await api<{regions:Region[]}>('/map/regions?dimension='+encodeURIComponent(dimension));
  if(currentDimension.current===dimension){setRegions(result.regions);setTerrainError('');}
 },[api,dimension]);
 useEffect(()=>{
  let stopped=false;
  const load=async()=>{try{
   const result=await api<{players:MapPlayer[];updatedAt:number;dimensions?:string[];spawn?:WorldSpawn}>('/map/players?offline='+showOffline);
   if(!stopped){
    if(result.spawn){setSpawn(result.spawn);if(!initialCentered.current){initialCentered.current=true;setDimension(result.spawn.dimension);setCenter({x:result.spawn.x,z:result.spawn.z});}}
    setPlayers(result.players);setServerDimensions(result.dimensions??[]);setUpdated(result.updatedAt);setError('');}
  }catch(e){if(!stopped){setPlayers([]);setUpdated(0);setError((e as Error).message);}}};
  void load();const timer=setInterval(()=>{if(!document.hidden)void load();},5000);
  return()=>{stopped=true;clearInterval(timer);};
 },[api,showOffline]);
 useEffect(()=>{
  let stopped=false;setRegions([]);cache.current.clear();setTerrainError('');
  const load=async()=>{try{const result=await api<{regions:Region[]}>('/map/regions?dimension='+encodeURIComponent(dimension));if(!stopped)setRegions(result.regions);}catch(e){if(!stopped)setTerrainError((e as Error).message);}};
  void load();const timer=setInterval(()=>{if(!document.hidden)void load();},30000);
  return()=>{stopped=true;clearInterval(timer);};
 },[api,dimension]);
 useEffect(()=>{
  const player=players.find(player=>player.uuid===follow&&(showOffline||player.online!==false));
  if(player){setDimension(player.dimension);setCenter({x:player.x,z:player.z});}
  else if(follow)setFollow('');
 },[players,follow,showOffline]);
 useEffect(()=>{
  const element=viewport.current;if(!element)return;
  const observer=new ResizeObserver(()=>setSize({width:element.clientWidth,height:element.clientHeight}));
  observer.observe(element);return()=>observer.disconnect();
 },[]);
 useEffect(()=>{
  const element=canvas.current;if(!element)return;
  const wheel=(event:WheelEvent)=>{event.preventDefault();setZoom(old=>boundedZoom(old*Math.exp(-event.deltaY*.001)));};
  element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);
 },[]);
 useEffect(()=>{
  const element=canvas.current;if(!element)return;
  const ratio=window.devicePixelRatio||1;element.width=size.width*ratio;element.height=size.height*ratio;
  const context=element.getContext('2d');if(!context)return;
  context.scale(ratio,ratio);context.fillStyle='#131e22';context.fillRect(0,0,size.width,size.height);
  const screen=(x:number,z:number)=>({x:(x-center.x)*zoom+size.width/2,y:(z-center.z)*zoom+size.height/2});
  const visible=regions.filter(region=>{const point=screen(region.x*512,region.z*512);return point.x<size.width&&point.y<size.height&&point.x+512*zoom>0&&point.y+512*zoom>0;})
   .sort((a,b)=>Math.hypot(a.x*512+256-center.x,a.z*512+256-center.z)-Math.hypot(b.x*512+256-center.x,b.z*512+256-center.z)).slice(0,96);
  const keys=new Set(visible.map(region=>dimension+'|'+region.name+'|'+region.updatedAt));
  for(const key of cache.current.keys())if(!keys.has(key))cache.current.delete(key);
  context.imageSmoothingEnabled=false;
  for(const region of visible){
   const key=dimension+'|'+region.name+'|'+region.updatedAt;
   let image=cache.current.get(key);
   if(!image){image=new Image();image.onload=()=>setImageVersion(old=>old+1);image.onerror=()=>setTerrainError('Some terrain tiles could not be loaded. Refresh terrain to retry.');image.src='/api/map/tiles/'+region.name+'?dimension='+encodeURIComponent(dimension)+'&v='+region.updatedAt;cache.current.set(key,image);}
   const point=screen(region.x*512,region.z*512);
   if(image.complete&&image.naturalWidth)context.drawImage(image,point.x,point.y,512*zoom,512*zoom);
  }
  if(showClaims)for(const team of claims?.teams??[]){
   const color=/^#[0-9a-f]{6}$/i.test(team.color)?team.color:'#91a2b5';
   const occupied=new Set(team.chunks.map(chunk=>chunk.x+','+chunk.z));
   context.fillStyle=color+'44';context.strokeStyle=color;context.lineWidth=1.5;
   for(const chunk of team.chunks){
    const point=screen(chunk.x*16,chunk.z*16),side=16*zoom;
    if(point.x+side<0||point.y+side<0||point.x>size.width||point.y>size.height)continue;
    context.fillRect(point.x,point.y,side,side);
    context.setLineDash(chunk.forceLoaded?[3,2]:[]);context.beginPath();
    if(!occupied.has(chunk.x+','+(chunk.z-1))){context.moveTo(point.x,point.y);context.lineTo(point.x+side,point.y);}
    if(!occupied.has((chunk.x+1)+','+chunk.z)){context.moveTo(point.x+side,point.y);context.lineTo(point.x+side,point.y+side);}
    if(!occupied.has(chunk.x+','+(chunk.z+1))){context.moveTo(point.x+side,point.y+side);context.lineTo(point.x,point.y+side);}
    if(!occupied.has((chunk.x-1)+','+chunk.z)){context.moveTo(point.x,point.y+side);context.lineTo(point.x,point.y);}
    context.stroke();
   }
  }
  context.setLineDash([]);
  const spacing=zoom<.2?512:zoom<1?128:16;
  context.strokeStyle='#ffffff16';context.lineWidth=1;context.beginPath();
  for(let x=Math.floor((center.x-size.width/2/zoom)/spacing)*spacing;x<center.x+size.width/2/zoom;x+=spacing){const point=screen(x,0);context.moveTo(point.x,0);context.lineTo(point.x,size.height);}
  for(let z=Math.floor((center.z-size.height/2/zoom)/spacing)*spacing;z<center.z+size.height/2/zoom;z+=spacing){const point=screen(0,z);context.moveTo(0,point.y);context.lineTo(size.width,point.y);}
  context.stroke();context.font='bold 12px sans-serif';
  for(const player of visiblePlayers){
   const point=screen(player.x,player.z);
   if(point.x<-40||point.y<-40||point.x>size.width+40||point.y>size.height+40)continue;
   const image=heads.images.get(player.uuid),side=24,left=point.x-side/2,top=point.y-side/2;
   if(image)context.drawImage(image,left,top,side,side);
   else{
    context.fillStyle='#b78c68';context.fillRect(left,top,side,side);
    context.fillStyle='#4c352a';context.fillRect(left,top,side,6);
    context.fillStyle='#dde3e9';context.fillRect(left+3,top+9,6,3);context.fillRect(left+15,top+9,6,3);
    context.fillStyle='#414773';context.fillRect(left+6,top+9,3,3);context.fillRect(left+15,top+9,3,3);
    context.fillStyle='#684431';context.fillRect(left+6,top+18,12,3);
   }
   context.strokeStyle=player.online===false?'#91a2b5':'#b9e884';context.lineWidth=3;
   context.setLineDash(player.online===false?[4,2]:[]);context.strokeRect(left-2,top-2,side+4,side+4);context.setLineDash([]);
   if(player.uuid===follow){context.strokeStyle='#f6cd78';context.lineWidth=1;context.strokeRect(left-5,top-5,side+10,side+10);}
   const label=player.name+(player.online===false?' (offline)':''),width=context.measureText(label).width;
   context.fillStyle='#102026dd';context.fillRect(point.x-width/2-5,point.y-38,width+10,17);
   context.fillStyle='#fff';context.fillText(label,point.x-width/2,point.y-25);
  }
 },[regions,dimension,players,follow,center,zoom,size,imageVersion,showOffline,claims,showClaims,heads.version,heads.images]);
 const reset=()=>{if(!spawn)return;setFollow('');setDimension(spawn.dimension);setCenter({x:spawn.x,z:spawn.z});setZoom(.5);};
 const upload=async(files:File[])=>{
  if(uploading)return;setFollow('');setUploading(true);setMessage('');setTerrainError('');
  let completed=0,importedRegions=0;
  try{
   for(const file of files){
    if(file.size>20*1024*1024)throw new Error(file.name+' exceeds 20 MiB');
    const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]!);reader.onerror=()=>reject(new Error('Could not read '+file.name));reader.readAsDataURL(file);});
    const result=await api<{merged:boolean;regions:number}>('/map/import',{dimension,filename:file.name,data});completed++;importedRegions+=result.regions;
    setMessage(`${completed} / ${files.length} ZIPs imported · ${importedRegions} terrain regions${result.merged?' (merged newer chunks)':''}`);
   }
  }catch(e){setTerrainError((e as Error).message);}finally{await loadRegions().catch(e=>setTerrainError((e as Error).message));setUploading(false);}
 };
 return <section id="player-map">
  <div className="card map-toolbar">
   <label>Dimension<select id="map-dimension" value={dimension} disabled={uploading} onChange={event=>{setFollow('');setDimension(event.target.value);}}>
    {[...new Set([...dimensions,...serverDimensions,...players.map(player=>player.dimension),dimension])].sort((a,b)=>dimensionLabel(a).localeCompare(dimensionLabel(b))).map(value=><option key={value} value={value}>{dimensionLabel(value)}</option>)}
   </select></label>
   <button className="secondary" onClick={()=>setZoom(old=>boundedZoom(old*1.5))}>Zoom in</button><button className="secondary" onClick={()=>setZoom(old=>boundedZoom(old/1.5))}>Zoom out</button>
   <button className="secondary" disabled={!spawn||uploading} title={spawn?'Return to world spawn':'World spawn unavailable; update the Admin Panel mod'} onClick={reset}>Center map</button>
   <button className="secondary" onClick={()=>{cache.current.clear();void loadRegions().catch(e=>setTerrainError(e.message));}}>Refresh terrain</button>
   <ToggleSelector label="Map layers" className="map-filters" multiple options={[{value:'claims',label:'Claims',id:'map-show-claims'},{value:'offline',label:'Offline players',id:'map-show-offline'}]} value={[...(showClaims?['claims']:[]),...(showOffline?['offline']:[])]} onChange={value=>{if(value==='claims')setShowClaims(old=>!old);else{setPlayers(old=>old.filter(player=>player.online!==false));setShowOffline(old=>!old);}}}/>
   <span className="map-marker-legend"><span className="map-online-key"/> Online <span className="map-offline-key"/> Offline</span>
   <span className="muted">X {Math.round(center.x)} · Z {Math.round(center.z)} · {zoom.toFixed(2)} px/block</span>
  </div>
  {error&&<p role="alert" className="banner error">{error}</p>}
  {showClaims&&claimError&&<p role="alert" className="banner error">{claimError}</p>}
  {showClaims&&claims&&!claims.available&&<p className="muted map-claims-unavailable">{claims.reason||'FTB Chunks claims are unavailable'}</p>}
  {showClaims&&claims?.truncated&&<p className="muted">Showing the first 100,000 claimed chunks in this dimension.</p>}
  {terrainError&&<p role="alert" className="banner error">{terrainError}</p>}
  {message&&<p role="status">{message}</p>}
  <div className="map-layout"><div className="map-viewport card" ref={viewport}>
   <canvas ref={canvas} aria-label="Player map. Drag to pan, scroll to zoom, or use arrow keys." tabIndex={0}
    onPointerDown={event=>{if(event.button!==0)return;setFollow('');drag.current={x:event.clientX,y:event.clientY,center};event.currentTarget.setPointerCapture(event.pointerId);}}
    onPointerMove={event=>{if(drag.current){setHoveredClaim('');setCenter({x:drag.current.center.x-(event.clientX-drag.current.x)/zoom,z:drag.current.center.z-(event.clientY-drag.current.y)/zoom});}else{
     const bounds=event.currentTarget.getBoundingClientRect();
     const x=Math.floor((center.x+(event.clientX-bounds.left-size.width/2)/zoom)/16),z=Math.floor((center.z+(event.clientY-bounds.top-size.height/2)/zoom)/16);
     const claim=claimCells.get(x+','+z);setHoveredClaim(claim?claim.team.name+' · chunk '+x+', '+z+(claim.forceLoaded?' · force-loading enabled':''):'');
    }}}
    onPointerLeave={()=>setHoveredClaim('')} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}
    onKeyDown={event=>{const move=64/zoom;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();setFollow('');setCenter(old=>({x:old.x+(event.key==='ArrowRight'?move:event.key==='ArrowLeft'?-move:0),z:old.z+(event.key==='ArrowDown'?move:event.key==='ArrowUp'?-move:0)}));}}}/>
   {hoveredClaim&&<p className="map-claim-info">{hoveredClaim}</p>}
   {!regions.length&&<p className="map-empty">No terrain uploaded for this dimension. Player markers still show their positions.</p>}
  </div><aside className="card map-player-list"><h2>{showOffline?'Players':'Online players'} ({shownPlayers.length})</h2><small className="muted map-dimension-count">{visiblePlayers.length} in this dimension</small>
   <input type="search" aria-label="Find map player" placeholder="Find player" value={search} onChange={event=>setSearch(event.target.value)}/>
   {shownPlayers.filter(player=>player.name.toLowerCase().includes(search.toLowerCase())).map(player=><button key={player.uuid} className={'map-player secondary '+(follow===player.uuid?'active':'')} disabled={uploading} onClick={()=>setFollow(old=>old===player.uuid?'':player.uuid)}>
    <strong>{player.name}{player.online===false?' · Offline':' · Online'}</strong>{player.online===false&&<small>Last saved position{player.savedAt?' · '+new Date(player.savedAt).toLocaleString():''}</small>}<small>{dimensionLabel(player.dimension)} · {Math.round(player.x)}, {Math.round(player.y)}, {Math.round(player.z)}</small>
   </button>)}
   {updated>0&&<small className="muted">Updated {new Date(updated).toLocaleTimeString()} · refreshes every 5 seconds</small>}
  </aside></div>
  {showClaims&&claims?.available&&<details className="card map-import map-claims-legend"><summary>Claim teams ({claims.teams.length})</summary>
   <p>Team-colored claims cover 16 × 16 blocks each. Only outer team boundaries are outlined. Dashed boundary segments mean force-loading is enabled, which does not guarantee the chunk is currently loaded. Hover a claim to see its owner. Refreshes every 30 seconds.</p>
   {!claims.teams.length&&<p>No claimed chunks in this dimension.</p>}
   <div className="map-region-list">{claims.teams.map(team=><button key={team.id} className="secondary map-claim-team" onClick={()=>{const chunk=team.chunks[0];if(chunk){setFollow('');setCenter({x:chunk.x*16+8,z:chunk.z*16+8});}}}>
    <span className="cheat-category-swatch" style={{background:/^#[0-9a-f]{6}$/i.test(team.color)?team.color:'#91a2b5'}}/><strong>{team.name}</strong><span>{team.chunks.length} chunks</span>
   </button>)}</div>
  </details>}
  <details id="map-terrain" className="card map-import"><summary>FTB Chunks terrain ({regions.length} regions)</summary>
   <p>Upload individual region ZIPs (XXXXX-XXXXX.zip) or a full FTB Chunks cache export. Cache exports import only the selected dimension and use their block_map.txt palette. Newer chunks are merged with existing terrain. Maximum 20 MiB per ZIP.</p>
   {has(session,'map.upload')&&<label>Upload region or cache ZIPs<input id="map-upload" type="file" accept=".zip" multiple disabled={uploading} onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';void upload(files);}}/></label>}
   <div className="map-region-list">{regions.map(region=><div key={region.name}><button className="secondary small" onClick={()=>{setFollow('');setCenter({x:region.x*512+256,z:region.z*512+256});}}>{region.name} · region {region.x}, {region.z}</button>
    {has(session,'map.remove')&&<button className="danger small" disabled={uploading} onClick={()=>{if(!confirm('Remove terrain region '+region.name+'?'))return;void api('/map/remove',{dimension,region:region.name}).then(()=>loadRegions()).catch(e=>setTerrainError(e.message));}}>Remove</button>}</div>)}</div>
  </details>
 </section>;
}
