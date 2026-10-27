import { mkdir,readFile,writeFile,rename,unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Failure,object,text } from './common.js';
export interface Todo {id:string;title:string;description:string;status:'todo'|'doing'|'done';priority:'low'|'normal'|'high';assignee:string;source?:{id:string;guildId:string};version:number;createdAt:number;updatedAt:number;createdBy:string;updatedBy:string}
export class Todos {
 private rows:Todo[]=[];private busy=false;
 constructor(private path:string){}
 async load(){try{const value=JSON.parse(await readFile(this.path,'utf8'));if(!Array.isArray(value)||value.length>2000||value.some(t=>!t||typeof t.id!=='string'||!Number.isInteger(t.version)))throw new Error('Invalid task data');this.rows=value;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 list(){return this.rows.map(t=>({...t}));}
 async mutate(actor:string,input:unknown,id?:string,remove=false){
  if(this.busy)throw new Failure(409,'Task board is being saved. Please retry.');this.busy=true;
  let temporary='';
  try{
   const b=object(input),index=id?this.rows.findIndex(t=>t.id===id):-1,old=this.rows[index];
   if(id&&!old)throw new Failure(404,'Task not found');
   if(old&&b.version!==old.version)throw new Failure(409,'Task changed. Refresh before saving.');
   const rows=[...this.rows];let task:Todo|undefined;
   if(remove)rows.splice(index,1);
   else {
    if(!old&&rows.length>=2000)throw new Failure(409,'Task limit reached');
    const title=text(b.title,160,'Title').trim(),description=typeof b.description==='string'&&b.description.length<=4000?b.description:undefined;
    if(description===undefined||!['todo','doing','done'].includes(String(b.status))||!['low','normal','high'].includes(String(b.priority))||typeof b.assignee!=='string'||b.assignee.length>80)throw new Failure(400,'Invalid task fields');
    let source=old?.source;
    if(!old&&b.source!==undefined){const s=object(b.source);if(![s.id,s.guildId].every(v=>typeof v==='string'&&/^[1-9][0-9]{16,19}$/.test(v)))throw new Failure(400,'Invalid suggestion link');source={id:s.id as string,guildId:s.guildId as string};if(rows.some(t=>t.source?.id===source!.id))throw new Failure(409,'This suggestion already has a task');}
    task={id:old?.id??randomUUID(),title,description,status:b.status as Todo['status'],priority:b.priority as Todo['priority'],assignee:b.assignee.trim(),source,version:(old?.version??0)+1,createdAt:old?.createdAt??Date.now(),updatedAt:Date.now(),createdBy:old?.createdBy??actor,updatedBy:actor};
    if(old)rows[index]=task;else rows.unshift(task);
   }
   await mkdir(dirname(this.path),{recursive:true});temporary=this.path+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(rows),{mode:0o600});await rename(temporary,this.path);this.rows=rows;return task??{removed:true};
  }finally{if(temporary)await unlink(temporary).catch(()=>{});this.busy=false;}
 }
}
