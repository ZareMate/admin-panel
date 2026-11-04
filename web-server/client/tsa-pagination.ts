export type PageRange={start:number;end:number};
export type ColumnHeights={hashes:string[];heights:number[]};

/** Columns with at least `targetSize` cards compete to set the shared card-height budget.
 * A shorter list must not shrink the budget for a longer list.
 * If none has enough cards, the fullest column defines the budget. */
export function sharedPageHeight(columns:readonly number[][],targetSize:number,gap=12):number {
 const nonempty=columns.filter(column=>column.length>0);
 if(!nonempty.length)return 0;
 const long=nonempty.filter(column=>column.length>=targetSize);
 const candidates=long.length?long:nonempty.filter(column=>column.length===Math.max(...nonempty.map(values=>values.length)));
 return Math.min(...candidates.map(column=>
  column.slice(0,targetSize).reduce((sum,height)=>sum+height,0)+Math.max(0,Math.min(targetSize,column.length)-1)*gap));
}

/** Variable-sized pages, with at least one card and at most targetSize per page.
 * Card heights come from invisible layout-identical DOM cards (not estimates).
 * Each page starts immediately after the preceding page. */
export function heightPages(heights:readonly number[],budget:number,targetSize:number,gap=12):PageRange[] {
 const result:PageRange[]=[];
 const size=Math.max(1,Math.floor(targetSize));
 for(let start=0;start<heights.length;) {
  let end=start,total=0;
  while(end<heights.length&&end-start<size) {
   const next=heights[end]+(end>start?gap:0);
   if(end>start&&total+next>budget+0.5)break;
   total+=next;end++;
  }
  result.push({start,end});
  start=end;
 }
 return result;
}

export function matchingHeights(current:readonly string[],measured?:ColumnHeights):number[]|null {
 if(!measured||measured.hashes.length!==current.length)return null;
 return current.every((hash,i)=>hash===measured.hashes[i])?measured.heights:null;
}
