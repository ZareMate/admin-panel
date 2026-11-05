/** Only explicit Minecraft player fields are resolved; stored messages and item/NBT data stay intact. */
export type PlayerIdentity={row:Record<string,unknown>;uuid:string;historical:boolean};
export function playerIdentities(input:unknown):PlayerIdentity[]{
 const result:PlayerIdentity[]=[];
 const object=(value:unknown):Record<string,unknown>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
 const add=(value:unknown,historical=false)=>{
  const row=object(value);
  if(row&&typeof row.uuid==='string'&&row.player!==false)result.push({row,uuid:row.uuid,historical});
 };
 const player=(value:unknown)=>{
  add(value);const teams=object(object(value)?.teams);
  if(Array.isArray(teams?.members))teams.members.forEach(member=>add(member));
 };
 const death=(value:unknown)=>{
  const row=object(value);if(!row)return;
  for(const key of ['victim','killer','directEntity']){
   const entity=object(row[key]);if(entity?.player===true)add(entity,true);
  }
 };
 const root=object(input);if(!root)return result;
 if(Array.isArray(root.players))root.players.forEach(player);else player(root);
 if(Array.isArray(root.entries))root.entries.forEach(death);else death(root);
 return result;
}
export function setPlayerName(row:Record<string,unknown>,name:string){
 row.name=name;
 for(const [key,field] of [['identity','name'],['tsa','playerName'],['ass','playerName'],['clockin','name']] as const){
  const section=row[key];
  if(section&&typeof section==='object'&&!Array.isArray(section)){
   const value=section as Record<string,unknown>;
   if(key==='identity'||key==='tsa'||field in value)value[field]=name;
  }
 }
}
