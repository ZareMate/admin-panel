import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
const data=resolve(process.env.DATA_DIR||'data');
await mkdir(data+'/config',{recursive:true});
try{await copyFile(new URL('../admin-panel.example.properties',import.meta.url),data+'/config/admin-panel.properties',constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}
try{await writeFile('.env','ADMIN_PANEL_BRIDGE_TOKEN='+randomBytes(32).toString('base64url')+'\nPUBLIC_ORIGIN=http://localhost:3000\nHOST=0.0.0.0\nPORT=3000\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
console.log('Configuration: '+data+'/config/admin-panel.properties\nBridge secret: .env (copy its value into Minecraft bridge config).\nFill in Discord settings or local user entries, set enabled=true, then npm start. Existing files were preserved.');
