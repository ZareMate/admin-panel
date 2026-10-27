import { useState } from 'react';
export interface MediaAttachment {name:string;url:string;contentType?:string|null;size?:number;spoiler?:boolean}
export function mediaKind(a:MediaAttachment):'image'|'video'|'audio'|'file' {
 let url:URL;try{url=new URL(a.url);}catch{return 'file';}
 if(url.protocol!=='https:'||url.username||url.password||!['cdn.discordapp.com','media.discordapp.net','images-ext-1.discordapp.net','images-ext-2.discordapp.net'].includes(url.hostname))return 'file';
 const type=a.contentType?.split(';')[0]?.toLowerCase();
 if(type?.startsWith('image/')&&type!=='image/svg+xml')return 'image';
 if(type?.startsWith('video/'))return 'video';
 if(type?.startsWith('audio/'))return 'audio';
 if(type&&type!=='application/octet-stream')return 'file';
 const ext=a.name.split('.').pop()?.toLowerCase()??'';
 if(['png','jpg','jpeg','gif','webp','avif'].includes(ext))return 'image';
 if(['mp4','webm','mov'].includes(ext))return 'video';
 if(['mp3','wav','ogg','m4a','flac','aac','opus'].includes(ext))return 'audio';
 return 'file';
}
function safeLink(value:string){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:undefined;}catch{return undefined;}}
export function TicketMedia({attachment:a}:{attachment:MediaAttachment}) {
 const [revealed,setRevealed]=useState(false),[failedUrl,setFailedUrl]=useState<string>();
 const url=safeLink(a.url),kind=mediaKind(a),failed=failedUrl===a.url;
 if(a.spoiler&&!revealed)return <button type="button" className="ticket-spoiler" onClick={()=>setRevealed(true)}>Spoiler attachment · Click to reveal</button>;
 return <figure className={'ticket-media ticket-media-'+kind}>
 {!failed&&kind==='image'&&<a href={url} target="_blank" rel="noreferrer"><img src={url} alt={a.name} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailedUrl(a.url)}/></a>}
 {!failed&&kind==='video'&&<video src={url} controls playsInline preload="none" onError={()=>setFailedUrl(a.url)} aria-label={a.name}/>}
 {!failed&&kind==='audio'&&<audio src={url} controls preload="none" onError={()=>setFailedUrl(a.url)} aria-label={a.name}/>}
 <figcaption><a href={url} target="_blank" rel="noreferrer">↗ {a.name}</a>{a.size!==undefined&&<small>{a.size<1048576?(a.size/1024).toFixed(1)+' KB':(a.size/1048576).toFixed(1)+' MB'}</small>}</figcaption>
 {failed&&<p className="muted">Preview unavailable. Open the file above or refresh the conversation.</p>}
 </figure>;
}
