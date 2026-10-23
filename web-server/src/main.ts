import { loadConfig } from './config.js';
import { createApp } from './app.js';
const config=await loadConfig();
const {app}=await createApp(config,{logger:true});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void app.close();});
await app.listen({host:config.bind,port:config.port});
console.log(`Admin Panel: ${config.origin} — Minecraft connects to ${config.origin.replace(/^http/,'ws')}/bridge`);
