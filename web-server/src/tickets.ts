import { Failure, object } from './common.js';
import { has } from './permissions.js';
import { TICKET_CATEGORIES } from './ticket-categories.js';
export interface Ticket {id:string;name:string;category:string;guildId:string;tags:string[]}
interface Category {id:string;label:string}
const validId=(s:unknown):s is string=>typeof s==='string'&&/^[1-9][0-9]{16,19}$/.test(s);
export class Tickets {
 private rows:Ticket[]=[];
 private categories:Category[]=[...TICKET_CATEGORIES];
 private updatedAt=0;
 private pending?:{id:string;index:number;started:number;rows:Ticket[];categories:Category[]};
 accept(input:unknown) {
  const b=object(input),now=Date.now();
  if(typeof b.snapshot!=='string'||! /^[a-f0-9-]{36}$/.test(b.snapshot)||!Number.isInteger(b.index)||Number(b.index)<0||typeof b.final!=='boolean'||!Array.isArray(b.tickets)||!Array.isArray(b.categories))throw new Failure(400,'Invalid ticket batch');
  if(b.categories.length!==TICKET_CATEGORIES.length)throw new Failure(400,'Invalid ticket categories');
  const categories=b.categories.map((v,i)=>{const c=object(v);if(c.id!==TICKET_CATEGORIES[i]!.id||typeof c.label!=='string'||!c.label.trim()||c.label.length>80)throw new Failure(400,'Invalid ticket category');return {id:c.id as string,label:c.label};});
  const rows=b.tickets.map(v=>{const t=object(v);if(!validId(t.id)||!validId(t.guildId)||typeof t.name!=='string'||!t.name||t.name.length>100||!categories.some(c=>c.id===t.category)||!Array.isArray(t.tags)||t.tags.length>5||!t.tags.every(tag=>typeof tag==='string'&&tag.length<=100))throw new Failure(400,'Invalid ticket');return {id:t.id,guildId:t.guildId,name:t.name,category:t.category as string,tags:t.tags as string[]};});
  if(b.index===0)this.pending={id:b.snapshot,index:0,started:now,rows:[],categories};
  const p=this.pending;
  if(!p||now-p.started>120000||p.id!==b.snapshot||p.index!==b.index||JSON.stringify(p.categories)!==JSON.stringify(categories))throw new Failure(409,'Ticket batch out of order or expired');
  if(p.rows.length+rows.length>10000){this.pending=undefined;throw new Failure(413,'Too many tickets');}
  const seen=new Set(p.rows.map(t=>t.id));for(const row of rows){if(seen.has(row.id))throw new Failure(400,'Duplicate ticket');seen.add(row.id);}
  p.rows.push(...rows);p.index++;
  if(b.final){this.rows=p.rows;this.categories=p.categories;this.updatedAt=now;this.pending=undefined;}
 }
 authorize(user:{permissions?:readonly string[]},id:string) {
  const ticket=this.rows.find(t=>t.id===id);
  if(!has(user,'tab.tickets')||!ticket||!has(user,'tickets.'+ticket.category))throw new Failure(403,'Ticket access denied');
  return ticket;
 }
 list(user:{permissions?:readonly string[]},category:unknown,offset:unknown) {
  if(!has(user,'tab.tickets'))throw new Failure(403,'Permission required: tab.tickets');
  const categories=this.categories.filter(c=>has(user,'tickets.'+c.id));
  const selected=category??categories[0]?.id;
  if(selected!==undefined&&!categories.some(c=>c.id===selected))throw new Failure(403,'Ticket category permission required');
  const start=Number(offset??0);if(!Number.isSafeInteger(start)||start<0)throw new Failure(400,'Invalid offset');
  const rows=this.rows.filter(t=>t.category===selected);
  return {categories,category:selected??null,tickets:rows.slice(start,start+50),total:rows.length,offset:start,updatedAt:this.updatedAt,stale:!this.updatedAt||Date.now()-this.updatedAt>90000};
 }
}
