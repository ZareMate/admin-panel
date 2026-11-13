import { isIP } from 'node:net';
import { Failure, object } from './common.js';
export type DnsRecordSpec={key:string;type:'A'|'SRV';name:string};
export function dnsRecordsFromEnv(env:NodeJS.ProcessEnv):DnsRecordSpec[]{
 const groups=[['CLOUDFLARE_A_RECORDS','A'],['CLOUDFLARE_SRV_RECORDS','SRV']] as const;
 const records:DnsRecordSpec[]=[];
 for(const [variable,type] of groups){
  const names=(env[variable]||'').split(',').map(name=>name.trim().toLowerCase().replace(/\.$/,'')).filter(Boolean);
  for(const name of names){
   if(name.length>253||!name.includes('.')||!name.split('.').every(label=>label.length<=63&&/^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/.test(label)))throw new Error(`Invalid DNS record name in ${variable}`);
   if(records.some(record=>record.type===type&&record.name===name))throw new Error(`Duplicate DNS record in ${variable}`);
   records.push({key:`${type}:${name}`,type,name});
  }
 }
 return records;
}
type RecordData={id:string;type:string;name:string;content:string;data?:{port:number;priority:number;weight:number;target:string}};
export class CloudflareDns {
 private saving=false;
 constructor(private config:{apiToken?:string;zoneId?:string;records?:DnsRecordSpec[]},private fetcher:typeof fetch=fetch){}
 private async request(path:string,body?:unknown):Promise<any>{
  const {apiToken,zoneId}=this.config;
  if(!apiToken||!zoneId)throw new Failure(503,'Configure CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID on the web server.');
  try {
   const response=await this.fetcher(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zoneId)}/dns_records${path}`,{method:body?(path==='/batch'?'POST':'PATCH'):'GET',headers:{Authorization:`Bearer ${apiToken}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000),redirect:'error'});
   // Never forward upstream messages: they may contain credentials or request data.
   const value=await response.json().catch(()=>null) as any;
   if(!response.ok||value?.success!==true){
    const codes=Array.isArray(value?.errors)?value.errors.map((error:any)=>error?.code).filter((code:unknown)=>Number.isSafeInteger(code)).slice(0,5):[];
    const detail=`HTTP ${response.status}${codes.length?'; code '+codes.join(', '):''}`;
    const advice=response.status===401||response.status===403
     ? 'Cloudflare rejected API access. Use an API token (not a Global API Key) with Zone / DNS / Edit permission and Include / Specific zone / the zone containing your configured records. Check token expiry, client IP restrictions, and that CLOUDFLARE_ZONE_ID is the Zone ID, not the Account ID. After changing web-server/.env, restart the web server and reload records.'
     : 'Check Cloudflare availability and token DNS permissions; reload records before retrying.';
    throw new Failure(502,`Cloudflare DNS request failed (${detail}). ${advice}`);
   }
   return value.result;
  } catch(error){if(error instanceof Failure)throw error;throw new Failure(502,'Cloudflare DNS unavailable or response invalid. Reload records before retrying.');}
 }
 private async record(spec:DnsRecordSpec):Promise<RecordData>{
  const rows=await this.request(`?type=${spec.type}&name=${encodeURIComponent(spec.name)}&per_page=100`);
  if(!Array.isArray(rows))throw new Failure(502,'Invalid Cloudflare DNS response');
  const matches=rows.filter((r:any)=>r.type===spec.type&&r.name?.toLowerCase().replace(/\.$/,'')===spec.name);
  if(matches.length!==1)throw new Failure(409,`Expected exactly one ${spec.type} record for ${spec.name}; found ${matches.length}. Manage missing or duplicate records in Cloudflare.`);
  const row=matches[0] as RecordData;
  if(!/^[a-f0-9]{32}$/i.test(row.id)||spec.type==='A'&&isIP(row.content)!==4||spec.type==='SRV'&&(!row.data||!Number.isInteger(row.data.port)))throw new Failure(502,'Invalid Cloudflare DNS record');
  return row;
 }
 async list():Promise<{records:{key:string;type:string;name:string;value?:string|number;target?:string;error?:string}[]}>{if(!this.config.records?.length)throw new Failure(503,'Configure CLOUDFLARE_A_RECORDS and/or CLOUDFLARE_SRV_RECORDS on the web server.');return {records:await Promise.all((this.config.records||[]).map(async spec=>{try{const row=await this.record(spec);return {...spec,value:spec.type==='A'?row.content:row.data!.port,target:row.data?.target};}catch(error){if(!(error instanceof Failure))throw error;return {...spec,error:error.message};}}))};}
 async updateAll(input:unknown){
  const body=object(input),match=typeof body.endpoint==='string'?/^(\d{1,3}(?:\.\d{1,3}){3}):([0-9]{1,5})$/.exec(body.endpoint.trim()):null;
  if(!match||isIP(match[1]!)!==4||Number(match[2])<1||Number(match[2])>65535)throw new Failure(400,'Provide a valid IPv4:port, for example 192.0.2.1:25565');
  const specs=this.config.records;
  if(!specs?.length)throw new Failure(503,'No DNS records configured');
  const expected=object(body.expected);
  if(Object.keys(expected).length!==specs.length||specs.some(spec=>!Object.hasOwn(expected,spec.key)))throw new Failure(409,'Configured records changed. Reload records before saving.');
  if(this.saving)throw new Failure(409,'A DNS update is in progress');
  this.saving=true;
  try{
   // Resolve and check every record before submitting a single batch of changes.
   const rows=await Promise.all(specs.map(spec=>this.record(spec)));
   const changes=specs.map((spec,index)=>{
    const row=rows[index]!,previous=spec.type==='A'?row.content:row.data!.port,value=spec.type==='A'?match[1]!:Number(match[2]);
    if(expected[spec.key]!==previous)throw new Failure(409,'DNS record changed. Reload records before saving.');
    return {spec,row,previous,value};
   });
   const patches=changes.filter(change=>change.previous!==change.value).map(({spec,row,value})=>({id:row.id,...(spec.type==='A'?{content:value}:{data:{...row.data,port:value}})}));
   if(patches.length)await this.request('/batch',{patches});
   return {endpoint:`${match[1]}:${Number(match[2])}`,records:changes.map(({spec,previous,value})=>({...spec,previous,value})),updated:patches.length};
  }finally{this.saving=false;}
 }
 async update(input:unknown){
  const body=object(input),spec=this.config.records?.find(row=>row.key===body.key);
  if(!spec)throw new Failure(400,'Unknown DNS record');
  if(spec.type==='A'?typeof body.value!=='string'||isIP(body.value)!==4:!Number.isInteger(body.value)||Number(body.value)<1||Number(body.value)>65535)throw new Failure(400,spec.type==='A'?'Provide a valid IPv4 address':'Port must be an integer from 1 to 65535');
  if(this.saving)throw new Failure(409,'A DNS update is in progress');
  this.saving=true;
  try {
   const row=await this.record(spec),previous=spec.type==='A'?row.content:row.data!.port;
   if(body.expected!==previous)throw new Failure(409,'DNS record changed. Reload records before saving.');
   if(previous!==body.value)await this.request('/'+row.id,spec.type==='A'?{content:body.value}:{data:{...row.data,port:body.value}});
   return {key:spec.key,name:spec.name,type:spec.type,previous,value:body.value};
  }finally{this.saving=false;}
 }
}
