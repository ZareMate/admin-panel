import { open, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';
export interface AuditRow { at:number;actor:string;action:string;target:string;state:string;detail:unknown }
export class Audit {
  private rows:AuditRow[]=[];
  private writing:Promise<void>=Promise.resolve();
  constructor(private file:string) {}
  async load() {
    await mkdir(dirname(this.file),{recursive:true});
    try {const stream=createReadStream(this.file,{encoding:'utf8'}); const lines=createInterface({input:stream,crlfDelay:Infinity});
      for await(const line of lines) {try {this.remember(JSON.parse(line));}catch{}}
    } catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  private remember(row:AuditRow) {this.rows.unshift(row);this.rows.length=Math.min(this.rows.length,500);}
  recent(){return structuredClone(this.rows);}
  write(actor:string,action:string,target:string,state:string,detail:unknown) {
    const row={at:Date.now(),actor,action,target,state,detail};
    const result=this.writing.then(async()=>{
      const file=await open(this.file,'a',0o600);
      try {await file.writeFile(JSON.stringify(row)+'\n');await file.sync();}finally{await file.close();}
      this.remember(row);
    });
    this.writing=result.catch(()=>{});return result;
  }
}
