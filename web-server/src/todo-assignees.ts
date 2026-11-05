import type {Config} from './config.js';
import {Failure,object} from './common.js';
import type {TicketBridge} from './ticket-bridge.js';
import {has} from './permissions.js';
import type {Todo} from './todos.js';
export interface TodoAssignee {id:string;name:string;rank:string}
export class TodoAssignees {
 private cached?:{key:string;expires:number;rows:Promise<TodoAssignee[]>};
 constructor(private config:Config,private bot:TicketBridge){}
 list(staffDirectory=false):Promise<TodoAssignee[]> {
  const ranks=this.config.ranks.filter(rank=>/^[1-9][0-9]{16,19}$/.test(rank.discordRoleId)).map(rank=>({roleId:rank.discordRoleId,name:rank.name,assignable:has(rank,'panel.access')&&(staffDirectory||has(rank,'tab.todo'))}));
  const key=JSON.stringify([this.config.guildId,ranks]);
  if(this.cached?.key===key&&this.cached.expires>Date.now())return this.cached.rows;
  const rows=(async()=>{
   const response=await this.bot.request({action:'todo-assignees',guildId:this.config.guildId,ranks}) as {messages:unknown[];hasMore:boolean};
   if(response.hasMore||!Array.isArray(response.messages))throw new Failure(502,'Invalid bot assignee directory');
   const result:TodoAssignee[]=[],seen=new Set<string>();
   for(const message of response.messages){
    const value=object(message);if(!Array.isArray(value.assignees))throw new Failure(502,'Update the Discord bot to load task assignees');
    for(const row of value.assignees){
     if(!row||typeof row.id!=='string'||!/^[1-9][0-9]{16,19}$/.test(row.id)||seen.has(row.id)||typeof row.name!=='string'||!row.name||row.name.length>100||typeof row.rank!=='string'||row.rank.length>32||result.length>=2000)throw new Failure(502,'Invalid bot assignee directory');
     seen.add(row.id);result.push({id:row.id,name:row.name,rank:row.rank});
    }
   }
   return result;
  })().catch(error=>{if(this.cached?.rows===rows)this.cached=undefined;throw error;});
  this.cached={key,expires:Date.now()+120000,rows};return rows;
 }
 async input(input:unknown,old?:Todo) {
  const body={...object(input)};
  let id=body.assigneeId;
  if(id===undefined&&old&&body.assignee===old.assignee){body.assigneeId=old.assigneeId??'';return body;}
  if(id===undefined&&body.assignee==='')id='';
  if(typeof id!=='string'||id!==''&&!/^[1-9][0-9]{16,19}$/.test(id))throw new Failure(400,'Choose an assignee from the bot list');
  if(!id){body.assignee='';body.assigneeId='';return body;}
  if(old?.assigneeId===id){body.assignee=old.assignee;return body;}
  const person=(await this.list()).find(row=>row.id===id);
  if(!person)throw new Failure(400,'Selected assignee is not in the bot list');
  body.assigneeId=person.id;body.assignee=person.name;return body;
 }
}
