import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mediaKind,TicketMedia } from '../client/TicketMedia.js';
const base={name:'photo.jpg',url:'https://cdn.discordapp.com/attachments/123/456/photo.jpg?ex=signed'};
test('ticket media classifies Discord attachments and keeps arbitrary URLs and active content out of previews',()=>{
 assert.equal(mediaKind(base),'image');
 for(const [contentType,kind] of [['video/mp4','video'],['audio/ogg','audio'],['image/gif','image'],['application/pdf','file'],['image/svg+xml','file']] as const)assert.equal(mediaKind({...base,contentType}),kind);
 for(const url of ['javascript:alert(1)','https://cdn.discordapp.com.evil.test/file','http://cdn.discordapp.com/file','https://example.com/file'])assert.equal(mediaKind({...base,url}),'file');
 assert.equal(mediaKind({...base,name:'voice.ogg',contentType:null}),'audio');
 assert.equal(mediaKind({...base,name:'clip.mp4',contentType:'application/octet-stream'}),'video');
});
test('ticket previews have native playback controls, signed URLs, safe captions and spoiler protection',()=>{
 const render=(attachment:Parameters<typeof TicketMedia>[0]['attachment'])=>renderToStaticMarkup(createElement(TicketMedia,{attachment}));
 const image=render(base);assert(image.includes('<img'));assert(image.includes('?ex=signed'));assert(image.includes('loading="lazy"'));
 for(const kind of ['video','audio']){const markup=render({...base,contentType:kind+'/mp4'});assert(markup.includes('<'+kind));assert(markup.includes('controls=""'));assert(markup.includes('preload="none"'));assert(!markup.includes('autoplay'));}
 const spoiler=render({...base,spoiler:true});assert(!spoiler.includes('<img'));assert(spoiler.includes('Click to reveal'));
 assert(!render({...base,url:'javascript:alert(1)',name:'<script>'}).includes('href="javascript:'));assert(render({...base,name:'<script>'}).includes('&lt;script&gt;'));
});

import { TicketAvatar } from '../client/TicketConversation.js';
test('ticket avatars display Discord CDN images with safe initials fallback',()=>{
 const render=(url?:string)=>renderToStaticMarkup(createElement(TicketAvatar,{name:'Server Pilot',url}));
 assert(render('https://cdn.discordapp.com/guilds/avatar.png').includes('<img'));
 for(const url of [undefined,'javascript:alert(1)','https://example.com/avatar.png']){const html=render(url);assert(!html.includes('<img'));assert(html.includes('SE'));}
});
