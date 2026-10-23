import { cp, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=new URL('../',import.meta.url);
await mkdir(new URL('public/icons/',root),{recursive:true});
for(const path of ['../src/main/resources/icons/','../src/resources/icons/']) {
  const source=new URL(path,root);try{await access(source);}catch{continue;}
  await cp(source,new URL('public/icons/',root),{recursive:true});
}
console.log('Prepared bundled icons in '+fileURLToPath(new URL('public/icons/',root)));
