/** Shared skin identity, URL and cache lifetime for profiles, avatars and maps. */
export const SKIN_CACHE_MS=2*60*60*1000;
export const validSkinName=(name:string)=>/^[A-Za-z0-9_]{3,16}$/.test(name);
export const skinPath=(kind:'head'|'body',name:string)=>'/api/skin/'+kind+'/'+encodeURIComponent(name);
