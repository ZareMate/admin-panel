import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=new URL('../',import.meta.url);
const destination=new URL('public/icons/',root);
// Rebuild generated assets so deleted source icons cannot linger in releases.
await rm(destination,{recursive:true,force:true});
await mkdir(destination,{recursive:true});
await cp(new URL('assets/icons/',root),destination,{recursive:true});
console.log('Prepared bundled icons in '+fileURLToPath(destination));
