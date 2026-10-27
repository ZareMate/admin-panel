import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DiscordText } from '../client/DiscordText.js';
const render=(text:string,mentions:Record<string,string>={})=>renderToStaticMarkup(createElement(DiscordText,{text,mentions}));
test('Discord formatting supports emphasis, blocks, spoilers, links and literal code',()=>{
 const html=render('**bold** *italic* __underline__ ~~strike~~ ***both***\n# Title\n> quote\n- item\n-# small\n||secret||\n`**literal**`\n```js\n<@12345678901234567>\n```');
 for(const expected of ['<strong>bold</strong>','<em>italic</em>','<u>underline</u>','<s>strike</s>','<strong><em>both</em></strong>','role="heading"','<blockquote>quote</blockquote>','discord-list-item','discord-subtext','Reveal spoiler','<code>**literal**</code>'])assert(html.includes(expected),expected);
 assert(render('**bold *nested***').includes('<strong>bold <em>nested</em></strong>'));
 assert(!html.includes('secret'));assert(!html.includes('discord-mention'));
 assert(render('[help](https://example.com)').includes('rel="noreferrer"'));assert(render('\\*literal\\*').includes('*literal*'));
});
test('mentions are badges with literal names; HTML and unsafe links are inert',()=>{
 const raw='<@12345678901234567>',html=render('**'+raw+'** <@&12345678901234568>',{[raw]:'@Pilot **name** <img>'});
 assert(html.includes('discord-mention'));assert(html.includes('@Pilot **name** &lt;img&gt;'));assert(!html.includes('<img>'));
 assert(!render('[bad](javascript:alert(1))').includes('href='));assert(!render('<script>alert(1)</script>').includes('<script>'));
});
