import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { Failure } from './common.js';
import { boundedBody } from './auth.js';
import { blockGui, cube, modelPreview } from './model.js';
export const validItem=(id:unknown):id is string=>typeof id==='string'&&id.length<=200&&/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id)&&id.split(/[:/]/).every(s=>s!=='.'&&s!=='..'&&s!=='');
const png=(data:Buffer)=>{
  if(data.length<24||data.length>2*1024*1024||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return false;
  const w=data.readUInt32BE(16),h=data.readUInt32BE(20);return w>0&&h>0&&w<=2048&&h<=16384&&w*h<=4194304;
};
export class Images {
  private cache=new Map<string,string>();
  private skins=new Map<string,{bytes:Buffer;expires:number}>();
  private assetCache=new Map<string,Buffer|null>();
  private jars:string[]=[];
  private skinJobs=0;
  constructor(private assets:string,private bundled:string,private fetcher:typeof fetch=fetch) {}
  async init() {this.jars=(await readdir(this.assets).catch(()=>[])).filter(f=>f.endsWith('.jar')).sort().reverse().map(f=>resolve(this.assets,f));}
  private async asset(path:string):Promise<Buffer|null> {
    if(this.assetCache.has(path)) return this.assetCache.get(path)!;
    let result:Buffer|null=null;
    for(const base of [this.assets,this.bundled]) {
      const root=resolve(base),file=resolve(base,path);if(!file.startsWith(root+sep))continue;
      try {if((await stat(file)).size<=2*1024*1024){result=await readFile(file);break;}}catch{}
    }
    if(!result) for(const jar of this.jars) {
      // Decompress only the requested entry, with declared-size and archive-size limits.
      const info=await stat(jar);if(info.size>256*1024*1024)continue;
      const entries=unzipSync(await readFile(jar),{filter:file=>file.name===path&&file.originalSize<=2*1024*1024});
      if(entries[path]){result=Buffer.from(entries[path]!);break;}
    }
    if(this.assetCache.size>=256)this.assetCache.delete(this.assetCache.keys().next().value!);
    this.assetCache.set(path,result);return result;
  }
  private path(id:string,folder:string,extension:string){if(!validItem(id))throw new Error('Invalid resource');const [ns,name]=id.split(':');return `assets/${ns}/${folder}/${name}${extension}`;}
  private resource(id:string){return id.includes(':')?id:'minecraft:'+id;}
  async icon(id:string):Promise<string> {
    if(this.cache.has(id))return this.cache.get(id)!;
    let value='';
    try {
      const exported=await this.asset(`icons/${id.replace(':','__')}.png`);
      if(exported&&png(exported))value='data:image/png;base64,'+exported.toString('base64');
      else {
        let model=id.split(':')[0]+':item/'+id.split(':')[1];const seen=new Set<string>(),textures:Record<string,string>={};let flat=false;let elements:Parameters<typeof modelPreview>[0]|undefined,gui:Parameters<typeof modelPreview>[1];
        for(let depth=0;depth<16;depth++){
          if(seen.has(model))break;seen.add(model);
          if(['minecraft:item/generated','minecraft:item/handheld','minecraft:item/handheld_rod','minecraft:builtin/generated'].includes(model)){flat=true;break;}
          if(['minecraft:block/cube_all','minecraft:block/cube_column','minecraft:block/cube_bottom_top','minecraft:block/cube','minecraft:block/orientable'].includes(model)){elements??=cube(model);gui??=blockGui;break;}
          if(model==='minecraft:block/block'){gui??=blockGui;break;}
          const data=await this.asset(this.path(model,'models','.json'));if(!data||data.length>262144)break;
          const json=JSON.parse(data.toString());if(json.loader)break;
          for(const [key,v] of Object.entries(json.textures||{}))if(!(key in textures)&&typeof v==='string')textures[key]=v;
          elements??=json.elements;gui??=json.display?.gui;
          if(!json.parent)break;model=this.resource(json.parent);
        }
        if(elements)value=await modelPreview(elements,gui,textures,id=>this.asset(this.path(id,'textures','.png')));
        else if(flat) {
          const layers:Buffer[]=[];
          for(let i=0;i<5;i++) {
            let texture=textures['layer'+i];if(!texture)break;const refs=new Set<string>();
            while(texture?.startsWith('#')){if(refs.has(texture))throw new Error('Texture cycle');refs.add(texture);texture=textures[texture.slice(1)];}
            if(!texture)break;const data=await this.asset(this.path(this.resource(texture),'textures','.png'));if(!data||!png(data))throw new Error('Missing texture');
            const image=sharp(data,{limitInputPixels:4194304});const meta=await image.metadata();const size=Math.min(meta.width!,meta.height!);
            layers.push(await image.extract({left:0,top:0,width:size,height:size}).resize(64,64,{kernel:'nearest'}).png().toBuffer());
          }
          if(layers.length)value='data:image/png;base64,'+(await sharp(layers[0]).composite(layers.slice(1).map(input=>({input}))).png().toBuffer()).toString('base64');
        }
      }
    }catch{/* Missing/custom assets retain the UI's labeled fallback. */}
    if(this.cache.size>=256)this.cache.delete(this.cache.keys().next().value!);this.cache.set(id,value);return value;
  }
  async icons(ids:string[]){const out:Record<string,string>={};for(const id of ids)out[id]=await this.icon(id);return out;}
  async skin(kind:string,name:string) {
    if(!['head','body'].includes(kind)||!/^[A-Za-z0-9_]{3,16}$/.test(name))throw new Failure(404,'Not found');
    const key=kind+':'+name.toLowerCase(),cached=this.skins.get(key);if(cached&&cached.expires>Date.now())return cached.bytes;
    if(this.skinJobs>=2)throw new Failure(503,'Skin service busy');this.skinJobs++;
    try {
      const response=await this.fetcher(kind==='head'?`https://mineskin.eu/helm/${name}/100.png`:`https://mineskin.eu/armor/body/${name}/256.png`,{redirect:'error',signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Failure(502,'Skin provider unavailable');const bytes=await boundedBody(response,1024*1024);if(!png(bytes))throw new Failure(502,'Invalid skin image');
      if(this.skins.size>=512)this.skins.delete(this.skins.keys().next().value!);this.skins.set(key,{bytes,expires:Date.now()+6*3600_000});return bytes;
    }finally{this.skinJobs--;}
  }
}
