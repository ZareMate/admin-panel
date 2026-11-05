/** Shared skin identity, URL and cache lifetime for profiles, avatars and maps. */
import {WEEK_MS} from './cache-policy.js';
export const SKIN_CACHE_MS=WEEK_MS;
export const validSkinName=(name:string)=>/^[A-Za-z0-9_]{3,16}$/.test(name);
export const validSkinIdentity=(value:string)=>validSkinName(value)||/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(value);
export const skinPath=(kind:'head'|'body',name:string)=>'/api/skin/'+kind+'/'+encodeURIComponent(name)+'?provider=mineskin-v1';
