export type CheatPlayer={types:string[]};
export type CheatSnapshot={totalPlayers:number;players:CheatPlayer[];types:string[]};
export type CheatStats={detectedPlayers:number;prevalence:number;totalOccurrences:number;distribution:{type:string;count:number;percentage:number}[]};

/** Count each player once for prevalence, and once per distinct cheat type for distribution.
 * All statistics represent recorded TSA detections, not proof of cheating.
 */
export function calculateCheatStats(snapshot:CheatSnapshot,selected:readonly string[]):CheatStats {
 const selectedSet=new Set(selected);
 const totals=new Map<string,number>();
 let detectedPlayers=0;
 for(const player of snapshot.players) {
  const unique=new Set(player.types);
  if([...unique].some(type=>selectedSet.has(type)))detectedPlayers++;
  for(const type of unique)totals.set(type,(totals.get(type)??0)+1);
 }
 const totalOccurrences=[...totals.values()].reduce((sum,count)=>sum+count,0);
 const distribution=[...totals].map(([type,count])=>({type,count,percentage:totalOccurrences?count/totalOccurrences*100:0}))
  .sort((a,b)=>b.count-a.count||a.type.localeCompare(b.type));
 return {detectedPlayers,prevalence:snapshot.totalPlayers?detectedPlayers/snapshot.totalPlayers*100:0,totalOccurrences,distribution};
}
