import test from 'node:test';
import assert from 'node:assert/strict';
import { sortHashesByFilename } from '../client/tsa-sort.js';

test('TSA sorts visible filenames instead of hashes',()=>{
 const pure='0'.repeat(64),xray='1'.repeat(64),unknown='2'.repeat(64),e='f'.repeat(64);
 const names={
  [pure]:[{filename:'Pure_Xray_v2.zip'}],
  [xray]:[{filename:'Xray_Ultimate.zip'}],
  [unknown]:[],
  [e]:[{filename:'e.jar'},{filename:'other.jar'}],
 };
 assert.deepEqual(sortHashesByFilename([pure,xray,unknown,e],names),[e,pure,xray,unknown]);
 assert.deepEqual(sortHashesByFilename([xray,e],names),[e,xray]);
});

test('TSA filename sorting is case insensitive with stable hash fallback',()=>{
 const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),d='d'.repeat(64);
 assert.deepEqual(sortHashesByFilename([d,c,b,a],{
  [a]:[{filename:'xray.zip'}],[b]:[{filename:'Alpha.jar'}],[c]:[{filename:'alpha.zip'}],[d]:[],
 }),[b,c,a,d]);
});

test('TSA prioritizes enforcement before filename, then unknown filenames last',()=>{
 const e='e'.repeat(64),a='a'.repeat(64),z='f'.repeat(64),unknown='0'.repeat(64);
 const names={
  [e]:[{filename:'e.jar'}],
  [a]:[{filename:'alpha.jar'}],
  [z]:[{filename:'Zulu.jar'}],
  [unknown]:[],
 };
 assert.deepEqual(sortHashesByFilename([unknown,e,z,a],names,new Set([z,a])),[a,z,e,unknown]);
 assert.deepEqual(sortHashesByFilename([unknown,e,z,a],names,new Set([unknown])),[unknown,a,e,z]);
});

test('TSA ignores Minecraft section-sign formatting codes for filename sorting',()=>{
 const a='a'.repeat(64),b='b'.repeat(64),c='c'.repeat(64),d='d'.repeat(64),unknown='e'.repeat(64);
 const names={
  [a]:[{filename:'§b§lSpectator Xray §7v1.2.1.zip'}],
  [b]:[{filename:'rainbow.zip'}],
  [c]:[{filename:'§aTnt Xray.zip'}],
  [d]:[{filename:'Spectator Xray v1.2.0.zip'}],
  [unknown]:[{filename:'§b§l'}],
 };
 assert.deepEqual(sortHashesByFilename([a,b,c,d,unknown],names),[b,d,a,c,unknown]);
 assert.deepEqual(sortHashesByFilename([a,b,c,d,unknown],names,new Set([c,a])),[a,c,b,d,unknown]);
});
