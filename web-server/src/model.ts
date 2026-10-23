import sharp from 'sharp';
type V=number[];
interface Gui {rotation?:V;scale?:V;translation?:V}
interface Element {from:V;to:V;faces:Record<string,{texture:string;uv?:V;rotation?:number;tintindex?:number}>;rotation?:{origin?:V;axis:string;angle:number;rescale?:boolean}}
const vector=(v:V|undefined,fallback:V):V=>{const out=v??fallback;if(out.length!==3||out.some(n=>!Number.isFinite(n)||Math.abs(n)>4096))throw new Error('Invalid model vector');return out;};
const rotate=(v:V,axis:number,angle:number)=>{const c=Math.cos(angle*Math.PI/180),s=Math.sin(angle*Math.PI/180),a=(axis+1)%3,b=(axis+2)%3,x=v[a]!,y=v[b]!;v[a]=x*c-y*s;v[b]=x*s+y*c;};
const n=(v:number)=>{if(!Number.isFinite(v)||Math.abs(v)>100000)throw new Error('Invalid coordinate');return v.toFixed(5);};
export const blockGui:Gui={rotation:[30,225,0],scale:[0.625,0.625,0.625]};
export function cube(parent:string):Element[] {
  const faces:Element['faces']={};for(const side of ['north','south','east','west','up','down']){
    const key=parent.endsWith('/cube_all')?'all':parent.endsWith('/cube_column')?(['up','down'].includes(side)?'end':'side'):parent.endsWith('/cube_bottom_top')?(side==='up'?'top':side==='down'?'bottom':'side'):parent.endsWith('/orientable')?(side==='north'?'front':['up','down'].includes(side)?'top':'side'):side;
    faces[side]={texture:'#'+key};
  }return [{from:[0,0,0],to:[16,16,16],faces}];
}
export async function modelPreview(elements:Element[],gui:Gui|undefined,textures:Record<string,string>,textureFile:(id:string)=>Promise<Buffer|null>):Promise<string> {
  if(!Array.isArray(elements)||elements.length>256)return '';
  const rotation=vector(gui?.rotation,[0,0,0]),scale=vector(gui?.scale,[1,1,1]),translation=vector(gui?.translation,[0,0,0]);
  const images=new Map<string,string>(),faces:{p:V[];uv:V[];texture:string;depth:number}[]=[];
  for(const element of elements){
    const [x,y,z]=vector(element.from,[]),[X,Y,Z]=vector(element.to,[]);if(!element.faces)return '';
    for(const [side,face] of Object.entries(element.faces)){
      if(face.tintindex!==undefined&&face.tintindex>=0)return '';
      let texture=face.texture;const seen=new Set<string>();
      while(texture.startsWith('#')){if(seen.has(texture))return '';seen.add(texture);texture=textures[texture.slice(1)]!;if(!texture)return '';}
      if(!texture.includes(':'))texture='minecraft:'+texture;
      if(!images.has(texture)){
        const data=await textureFile(texture);if(!data)return '';
        const image=sharp(data,{limitInputPixels:4194304}),meta=await image.metadata();if(meta.format!=='png')return '';
        const size=Math.min(meta.width!,meta.height!);const png=await image.extract({left:0,top:0,width:size,height:size}).png().toBuffer();images.set(texture,png.toString('base64'));
      }
      const points:Record<string,V[]>={south:[[x!,Y!,Z!],[X!,Y!,Z!],[X!,y!,Z!],[x!,y!,Z!]],north:[[X!,Y!,z!],[x!,Y!,z!],[x!,y!,z!],[X!,y!,z!]],east:[[X!,Y!,Z!],[X!,Y!,z!],[X!,y!,z!],[X!,y!,Z!]],west:[[x!,Y!,z!],[x!,Y!,Z!],[x!,y!,Z!],[x!,y!,z!]],up:[[x!,Y!,z!],[X!,Y!,z!],[X!,Y!,Z!],[x!,Y!,Z!]],down:[[x!,y!,Z!],[X!,y!,Z!],[X!,y!,z!],[x!,y!,z!]]};
      const defaults:Record<string,V>={north:[16-X!,16-Y!,16-x!,16-y!],south:[x!,16-Y!,X!,16-y!],east:[16-Z!,16-Y!,16-z!,16-y!],west:[z!,16-Y!,Z!,16-y!],up:[x!,z!,X!,Z!],down:[x!,16-Z!,X!,16-z!]};
      const p=points[side],uv=face.uv??defaults[side];if(!p||!uv||uv.length!==4||uv.some(v=>!Number.isFinite(v)||Math.abs(v)>4096))return '';
      const turn=face.rotation??0;if(turn%90)return '';const corners=[[uv[0]!,uv[1]!],[uv[2]!,uv[1]!],[uv[2]!,uv[3]!],[uv[0]!,uv[3]!]],mapped=p.map((_,i)=>corners[((i+turn/90)%4+4)%4]!);
      let depth=0;
      for(const v of p){
        const r=element.rotation;if(r){const origin=vector(r.origin,[8,8,8]),axis=['x','y','z'].indexOf(r.axis);if(axis<0||!Number.isFinite(r.angle))return '';for(let i=0;i<3;i++)v[i]=v[i]!-origin[i]!;rotate(v,axis,r.angle);if(r.rescale)for(let i=0;i<3;i++)if(i!==axis)v[i]=v[i]!/Math.cos(r.angle*Math.PI/180);for(let i=0;i<3;i++)v[i]=v[i]!+origin[i]!;}
        for(let i=0;i<3;i++)v[i]=(v[i]!-8)*scale[i]!;for(let i=0;i<3;i++)rotate(v,i,rotation[i]!);depth+=v[2]!;v[0]=32+4*(v[0]!+translation[0]!);v[1]=32-4*(v[1]!+translation[1]!);
      }
      const area=(p[1]![0]!-p[0]![0]!)*(p[3]![1]!-p[0]![1]!)-(p[1]![1]!-p[0]![1]!)*(p[3]![0]!-p[0]![0]!);
      if(area<-.0001)faces.push({p,uv:mapped,texture,depth:depth/4});
    }
  }
  if(!faces.length)return '';faces.sort((a,b)=>a.depth-b.depth);
  const ids=new Map<string,string>();let svg='<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64"><defs>';
  for(const [texture,data] of images){const id='t'+ids.size;ids.set(texture,id);svg+=`<image id="${id}" width="16" height="16" preserveAspectRatio="none" xlink:href="data:image/png;base64,${data}"/>`;}
  svg+='</defs>';let index=0;
  for(const {p,uv,texture} of faces){
    const u1=uv[1]![0]!-uv[0]![0]!,v1=uv[1]![1]!-uv[0]![1]!,u2=uv[3]![0]!-uv[0]![0]!,v2=uv[3]![1]!-uv[0]![1]!,det=u1*v2-u2*v1;if(Math.abs(det)<1e-8)continue;
    const dx1=p[1]![0]!-p[0]![0]!,dy1=p[1]![1]!-p[0]![1]!,dx2=p[3]![0]!-p[0]![0]!,dy2=p[3]![1]!-p[0]![1]!;
    const a=(dx1*v2-dx2*v1)/det,c=(dx2*u1-dx1*u2)/det,b=(dy1*v2-dy2*v1)/det,d=(dy2*u1-dy1*u2)/det,e=p[0]![0]!-a*uv[0]![0]!-c*uv[0]![1]!,f=p[0]![1]!-b*uv[0]![0]!-d*uv[0]![1]!;
    const clip='f'+index++;svg+=`<clipPath id="${clip}"><polygon points="${p.map(v=>n(v[0]!)+','+n(v[1]!)).join(' ')}"/></clipPath><g clip-path="url(#${clip})"><use xlink:href="#${ids.get(texture)}" transform="matrix(${[a,b,c,d,e,f].map(n).join(' ')})"/></g>`;
  }
  svg+='</svg>';if(!index||svg.length>4*1024*1024)return '';
  return 'data:image/png;base64,'+(await sharp(Buffer.from(svg),{limitInputPixels:4194304}).png().toBuffer()).toString('base64');
}
