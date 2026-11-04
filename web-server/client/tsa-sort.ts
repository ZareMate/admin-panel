/** Sort by the first filename displayed on the card; unknown names go last. */
export function sortHashesByFilename(hashes: string[], names: Record<string, { filename: string }[]>, enforced: ReadonlySet<string> = new Set()): string[] {
 const label=(hash:string)=>names[hash]?.find(entry=>entry.filename.trim())?.filename.trim()??'';
 return [...hashes].sort((left,right)=>{
  const a=label(left),b=label(right);
  return Number(enforced.has(right))-Number(enforced.has(left))||
   Number(!a)-Number(!b)||
   (a||left).localeCompare(b||right,undefined,{sensitivity:'base'})||
   left.localeCompare(right);
 });
}
