import test from 'node:test';
import assert from 'node:assert/strict';
import type { CheatSnapshot } from '../client/cheat-stats.js';
import { calculateCheatStats, calculateTypeOverlaps, playerCategorySegments, categoryColor } from '../client/cheat-stats.js';

test('three detected players among ten gives 30% and 2/3 ray distribution',()=>{
 const data={totalPlayers:10,types:['ray','esp'],players:[{types:['ray']},{types:['ray']},{types:['esp']}]};
 const stats=calculateCheatStats(data,['ray','esp']);
 assert.equal(stats.detectedPlayers,3);
 assert.equal(stats.prevalence,30);
 assert.equal(stats.totalOccurrences,3);
 assert.equal(stats.distribution[0]?.type,'ray');
 assert(Math.abs(stats.distribution[0]!.percentage-66.6666666667)<.00001);
 assert(Math.abs(stats.distribution[1]!.percentage-33.3333333333)<.00001);
 assert.equal(calculateCheatStats(data,['esp']).prevalence,10);
 assert.equal(calculateCheatStats(data,['ray']).prevalence,20);
});

test('repeated types and overlap do not double-count a player in prevalence',()=>{
 const data={totalPlayers:10,types:['ray','esp'],players:[{types:['ray','ray','esp']},{types:['esp']}]};
 const all=calculateCheatStats(data,['ray','esp']);
 assert.equal(all.detectedPlayers,2);
 assert.equal(all.prevalence,20);
 assert.equal(all.totalOccurrences,3);
 assert.equal(all.distribution.find(x=>x.type==='esp')?.count,2);
 assert.equal(calculateCheatStats(data,[]).prevalence,0);
});

test('empty data produces zero without NaN',()=>{
 assert.deepEqual(calculateCheatStats({totalPlayers:0,types:[],players:[]},[]),{detectedPlayers:0,prevalence:0,totalOccurrences:0,distribution:[]});
});


test('file distribution counts unique hashes per player while prevalence counts players',()=>{
 const data:CheatSnapshot={totalPlayers:10,types:['ray','esp'],players:[
  {types:['ray','esp'],fileCounts:{ray:2,esp:1}},
  {types:['ray'],fileCounts:{ray:1}},
 ]};
 const stats=calculateCheatStats(data,['ray','esp']);
 assert.equal(stats.prevalence,20);
 assert.equal(stats.totalOccurrences,4);
 assert.equal(stats.distribution.find(item=>item.type==='ray')?.percentage,75);
 assert.equal(calculateCheatStats(data,['esp']).prevalence,10);
});


test('wheel shares overlapping players across categories without inflating prevalence',()=>{
 const data={totalPlayers:10,types:['ray','esp'],players:[{types:['ray','ray','esp']},{types:['ray']}]};
 assert.deepEqual(playerCategorySegments(data,['ray','esp']),[{type:'ray',percentage:15},{type:'esp',percentage:5}]);
 assert.deepEqual(playerCategorySegments(data,['esp']),[{type:'esp',percentage:10}]);
 assert.deepEqual(playerCategorySegments(data,[]),[]);
 assert.deepEqual(playerCategorySegments({...data,totalPlayers:0},['ray']),[]);
 assert.equal(new Set(Array.from({length:12},(_,i)=>categoryColor(i))).size,12);
});


test('overlap graph counts distinct types and exact combinations once per player',()=>{
 const data={totalPlayers:10,types:['ray','esp','freecam'],players:[
  {types:['ray','ray','esp']},{types:['esp','ray']},{types:['ray','esp','freecam']},{types:['ray']},{types:[]}
 ]};
 const result=calculateTypeOverlaps(data);
 assert.equal(result.detectedPlayers,4);
 assert.equal(result.multipleTypes,3);
 assert.deepEqual(result.counts,[{types:1,count:1,percentage:25},{types:2,count:2,percentage:50},{types:3,count:1,percentage:25}]);
 assert.deepEqual(result.combinations[0],{types:['esp','ray'],count:2,percentage:50});
 assert.equal(result.combinations.length,2);
 assert.deepEqual(calculateTypeOverlaps({totalPlayers:0,types:[],players:[]}),{detectedPlayers:0,multipleTypes:0,counts:[],combinations:[]});
});
