import test from 'node:test';
import assert from 'node:assert/strict';
import { sortHashesByFilename } from '../client/tsa-sort.js';

test('TSA sorts visible filenames instead of hashes or enforcement status',()=>{
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
