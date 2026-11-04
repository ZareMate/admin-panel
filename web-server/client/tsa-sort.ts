/** Sort by the first filename displayed on the card; unknown names go last. */
export function sortHashesByFilename(hashes: string[], names: Record<string, { filename: string }[]>, enforced: ReadonlySet<string> = new Set()): string[] {
 const clean=(filename:string)=>filename.replace(/§./gu,'').trim();
 const label=(hash:string)=>names[hash]?.map(entry=>clean(entry.filename)).find(Boolean)??'';
 return [...hashes].sort((left,right)=>{
  const a=label(left),b=label(right);
  return Number(enforced.has(right))-Number(enforced.has(left))||
   Number(!a)-Number(!b)||
   (a||left).localeCompare(b||right,undefined,{sensitivity:'base'})||
   left.localeCompare(right);
 });
}
