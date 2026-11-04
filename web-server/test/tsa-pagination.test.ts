import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedPageHeight,heightPages,matchingHeights } from '../client/tsa-pagination.js';

test('20 smallest-height reference cards define shared height budget',()=>{
 const height=sharedPageHeight([Array(30).fill(200),Array(20).fill(100),Array(6).fill(50)],20);
 assert.equal(height,20*100+19*12);
 assert.deepEqual(heightPages(Array(30).fill(200),height,20).map(page=>page.end-page.start),[10,10,10]);
 assert.deepEqual(heightPages(Array(20).fill(100),height,20).map(page=>page.end-page.start),[20]);
 assert.deepEqual(heightPages(Array(6).fill(50),height,20).map(page=>page.end-page.start),[6]);
});

test('short lists do not dictate shared height and never drop items',()=>{
 assert.equal(sharedPageHeight([Array(4).fill(70),Array(18).fill(130)],20),18*130+17*12);
 const pages=heightPages([500,20,300,60,40],115,20);
 assert.deepEqual(pages,[{start:0,end:1},{start:1,end:2},{start:2,end:3},{start:3,end:5}]);
 assert.equal(pages[pages.length-1]?.end,5);
});

test('budget adjusts for page-size selection and page membership remains contiguous',()=>{
 const items=Array.from({length:57},(_,i)=>i%3===0?172:88);
 for(const size of [5,10,20,50]) {
  const budget=sharedPageHeight([items,Array.from({length:57},()=>96)],size);
  const pages=heightPages(items,budget,size);
  assert.equal(pages[0]?.start,0);
  assert.equal(pages[pages.length-1]?.end,items.length);
  for(let i=0;i<pages.length;i++){
   assert(pages[i].end>pages[i].start);
   assert(pages[i].end-pages[i].start<=size);
   if(i>0)assert.equal(pages[i-1].end,pages[i].start);
  }
 }
});

test('layout measurements are ignored when filter or ordering changed',()=>{
 const measured={hashes:['a','b'],heights:[100,120]};
 assert.deepEqual(matchingHeights(['a','b'],measured),[100,120]);
 assert.equal(matchingHeights(['b','a'],measured),null);
 assert.equal(matchingHeights(['a'],measured),null);
 assert.equal(matchingHeights(['a','b']),null);
});
