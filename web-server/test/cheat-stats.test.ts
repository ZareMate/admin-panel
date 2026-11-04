import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCheatStats } from '../client/cheat-stats.js';

test('three detected players among ten gives 30% and 2/3 xray distribution',()=>{
 const data={totalPlayers:10,types:['Xray','ESP'],players:[{types:['Xray']},{types:['Xray']},{types:['ESP']}]};
 const stats=calculateCheatStats(data,['Xray','ESP']);
 assert.equal(stats.detectedPlayers,3);
 assert.equal(stats.prevalence,30);
 assert.equal(stats.totalOccurrences,3);
 assert.equal(stats.distribution[0]?.type,'Xray');
 assert(Math.abs(stats.distribution[0]!.percentage-66.6666666667)<.00001);
 assert(Math.abs(stats.distribution[1]!.percentage-33.3333333333)<.00001);
 assert.equal(calculateCheatStats(data,['ESP']).prevalence,10);
 assert.equal(calculateCheatStats(data,['Xray']).prevalence,20);
});

test('repeated types and overlap do not double-count a player in prevalence',()=>{
 const data={totalPlayers:10,types:['Xray','ESP'],players:[{types:['Xray','Xray','ESP']},{types:['ESP']}]};
 const all=calculateCheatStats(data,['Xray','ESP']);
 assert.equal(all.detectedPlayers,2);
 assert.equal(all.prevalence,20);
 assert.equal(all.totalOccurrences,3);
 assert.equal(all.distribution.find(x=>x.type==='ESP')?.count,2);
 assert.equal(calculateCheatStats(data,[]).prevalence,0);
});

test('empty data produces zero without NaN',()=>{
 assert.deepEqual(calculateCheatStats({totalPlayers:0,types:[],players:[]},[]),{detectedPlayers:0,prevalence:0,totalOccurrences:0,distribution:[]});
});
