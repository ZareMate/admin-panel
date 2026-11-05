export type CheatPlayer={types:string[];fileCounts?:Record<string,number>};
export type StatsFile={hash:string;names:string[];players:number};
export type CheatSnapshot={totalPlayers:number;players:CheatPlayer[];types:string[];fileBreakdown?:Record<string,StatsFile[]>;packetErrors?:{timeouts:number;modified:number;other:number}};
export type CheatStats={detectedPlayers:number;prevalence:number;totalOccurrences:number;distribution:{type:string;count:number;percentage:number}[]};

/** Count each player once for prevalence, and once per distinct hash for file distribution.
 * All statistics represent recorded TSA detections, not proof of cheating.
 */
export function calculateCheatStats(snapshot:CheatSnapshot,selected:readonly string[]):CheatStats {
 const selectedSet=new Set(selected);
 const totals=new Map<string,number>();
 let detectedPlayers=0;
 for(const player of snapshot.players) {
  const unique=new Set(player.types);
  if([...unique].some(type=>selectedSet.has(type)))detectedPlayers++;
  for(const type of unique)totals.set(type,(totals.get(type)??0)+(player.fileCounts?.[type]??1));
 }
 const totalOccurrences=[...totals.values()].reduce((sum,count)=>sum+count,0);
 const distribution=[...totals].map(([type,count])=>({type,count,percentage:totalOccurrences?count/totalOccurrences*100:0}))
  .sort((a,b)=>b.count-a.count||a.type.localeCompare(b.type));
 return {detectedPlayers,prevalence:snapshot.totalPlayers?detectedPlayers/snapshot.totalPlayers*100:0,totalOccurrences,distribution};
}

/** Split each detected player's share equally across their selected categories. */
export function playerCategorySegments(snapshot:CheatSnapshot,selected:readonly string[]):{type:string;percentage:number}[] {
 const shares=new Map(selected.map(type=>[type,0]));
 if(!snapshot.totalPlayers)return [];
 for(const player of snapshot.players) {
  const types=[...new Set(player.types)].filter(type=>shares.has(type));
  for(const type of types)shares.set(type,shares.get(type)!+100/snapshot.totalPlayers/types.length);
 }
 return [...shares].filter(([,percentage])=>percentage>0).map(([type,percentage])=>({type,percentage}));
}

export function categoryColor(index:number):string {
 return `hsl(${(95+index*137.508)%360} 62% 68%)`;
}

export function calculateTypeOverlaps(snapshot:CheatSnapshot) {
 const counts=new Map<number,number>();
 const combinations=new Map<string,{types:string[];count:number}>();
 let detectedPlayers=0,multipleTypes=0;
 for(const player of snapshot.players) {
  const types=[...new Set(player.types)].sort();
  if(!types.length)continue;
  detectedPlayers++;
  counts.set(types.length,(counts.get(types.length)??0)+1);
  if(types.length<2)continue;
  multipleTypes++;
  const key=JSON.stringify(types);
  const entry=combinations.get(key)??{types,count:0};
  entry.count++;combinations.set(key,entry);
 }
 const percentage=(count:number)=>detectedPlayers?count/detectedPlayers*100:0;
 return {detectedPlayers,multipleTypes,
  counts:[...counts].sort(([a],[b])=>a-b).map(([types,count])=>({types,count,percentage:percentage(count)})),
  combinations:[...combinations.values()].sort((a,b)=>b.count-a.count||JSON.stringify(a.types).localeCompare(JSON.stringify(b.types)))
   .map(entry=>({...entry,percentage:percentage(entry.count)}))};
}
