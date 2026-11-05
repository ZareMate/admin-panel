export const WEEK_MS=7*24*60*60*1000;
export const retryDelay=(failures:number)=>Math.min(60*60*1000,30_000*2**Math.min(7,Math.max(0,failures-1)));
