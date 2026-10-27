import { Fragment, useState, type ReactNode } from 'react';
function Spoiler({children}:{children:ReactNode}){const [shown,setShown]=useState(false);return <button type="button" className={'discord-spoiler '+(shown?'revealed':'')} aria-label={shown?'Hide spoiler':'Reveal spoiler'} onClick={()=>setShown(!shown)}>{shown?children:'Spoiler'}</button>;}
const safeHref=(value:string)=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:undefined;}catch{return undefined;}};
export function DiscordText({text,mentions={}}:{text:string;mentions?:Record<string,string>}) {
 let budget=3000;
 const inline=(source:string,depth=0):ReactNode=>{
  if(depth>12||--budget<0)return source;
  const out:ReactNode[]=[];let rest=source;
  while(rest&&--budget>=0){
   let m:RegExpMatchArray|null;
   if((m=rest.match(/^\\([\\`*_~|>#[\]()])/))){out.push(m[1]);rest=rest.slice(m[0].length);continue;}
   if((m=rest.match(/^(`+)([\s\S]*?)\1/))){out.push(<code key={out.length}>{m[2]}</code>);rest=rest.slice(m[0].length);continue;}
   if((m=rest.match(/^<@(?:[!&])?[0-9]{17,20}>|^@(?:everyone|here)\b/))){out.push(<span className="discord-mention" key={out.length}>{mentions[m[0]]??m[0]}</span>);rest=rest.slice(m[0].length);continue;}
   if((m=rest.match(/^\[([^\]\n]+)\]\(([^\s)]+)\)/))){const href=safeHref(m[2]!);out.push(href?<a key={out.length} href={href} target="_blank" rel="noreferrer">{inline(m[1]!,depth+1)}</a>:m[0]);rest=rest.slice(m[0].length);continue;}
   if((m=rest.match(/^(?:https?:\/\/[^\s<>]+|<https?:\/\/[^\s<>]+>)/))){const raw=m[0],label=raw.startsWith('<')?raw.slice(1,-1):raw,href=safeHref(label);out.push(href?<a key={out.length} href={href} target="_blank" rel="noreferrer">{label}</a>:raw);rest=rest.slice(raw.length);continue;}
   let matched=false;
   for(const [mark,tag] of [['***','both'],['___','underlineItalic'],['**','strong'],['__','u'],['~~','s'],['||','spoiler'],['*','em'],['_','em']] as const){
    if(!rest.startsWith(mark))continue;let end=rest.indexOf(mark,mark.length);
    while(end>=0){let slashes=0;for(let j=end-1;j>=0&&rest[j]==='\\';j--)slashes++;if(slashes%2){end=rest.indexOf(mark,end+mark.length);continue;}let run=mark.length;while(rest[end+run]===mark[0])run++;if(run>mark.length&&run<=3)end+=run-mark.length;break;}
    if(end<=mark.length)continue;
    const body=inline(rest.slice(mark.length,end),depth+1),key=out.length;
    out.push(tag==='spoiler'?<Spoiler key={key}>{body}</Spoiler>:tag==='both'?<strong key={key}><em>{body}</em></strong>:tag==='underlineItalic'?<u key={key}><em>{body}</em></u>:tag==='strong'?<strong key={key}>{body}</strong>:tag==='u'?<u key={key}>{body}</u>:tag==='s'?<s key={key}>{body}</s>:<em key={key}>{body}</em>);
    rest=rest.slice(end+mark.length);matched=true;break;
   }
   if(matched)continue;
   const plain=rest.match(/^[^\\`*_~|<@\[h]+/)?.[0]??rest[0]!;out.push(plain);rest=rest.slice(plain.length);
  }
  if(rest)out.push(rest);return out;
 };
 const lines=text.split('\n'),nodes:ReactNode[]=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i]!;
  if(line.startsWith('```')){const code:string[]=[];const first=line.slice(3);if(first.includes('```')){nodes.push(<pre key={i}><code>{first.slice(0,first.indexOf('```'))}</code></pre>);continue;}while(i+1<lines.length&&!lines[i+1]!.startsWith('```'))code.push(lines[++i]!);if(i+1<lines.length)i++;nodes.push(<pre key={i}><code>{code.join('\n')}</code></pre>);continue;}
  const heading=line.match(/^(#{1,3}) (.*)$/),list=line.match(/^\s*(?:[-*]|\d+\.) (.*)$/);
  if(line.startsWith('>>> ')){nodes.push(<blockquote key={i}>{inline([line.slice(4),...lines.slice(i+1)].join('\n'))}</blockquote>);break;}
  if(line.startsWith('> ')){nodes.push(<blockquote key={i}>{inline(line.slice(2))}</blockquote>);continue;}
  if(heading){nodes.push(<div role="heading" aria-level={heading[1]!.length} className={'discord-heading level-'+heading[1]!.length} key={i}>{inline(heading[2]!)}</div>);continue;}
  if(line.startsWith('-# ')){nodes.push(<small className="discord-subtext" key={i}>{inline(line.slice(3))}</small>);continue;}
  if(list){nodes.push(<div className="discord-list-item" key={i}><span>{line.trim().match(/^\d+\./)?.[0]??'•'}</span><span>{inline(list[1]!)}</span></div>);continue;}
  nodes.push(<Fragment key={i}>{inline(line)}{i<lines.length-1&&<br/>}</Fragment>);
 }
 return <div className="discord-text">{nodes}</div>;
}
