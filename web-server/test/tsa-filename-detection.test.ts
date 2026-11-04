import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTsaFilename, filenameDetectionKeyword, matchesTsaNameOrHash } from '../client/tsa-filename-detection.js';

test('matches TSA filename sanitization, including Minecraft formatting codes and Unicode',()=>{
 assert.equal(sanitizeTsaFilename('§b§lSpectator Xray §7v1.2.1.zip'),'blspectatorxray7v121zip');
 assert.equal(sanitizeTsaFilename('Ｆｒｅｅ ESP!.jar'),'freeespjar');
 assert.equal(filenameDetectionKeyword(['§b§lSpectator Xray §7v1.2.1.zip'],['esp','xray'],[]),'xray');
 assert.equal(filenameDetectionKeyword(['Free_ESP.jar'],['esp'],[]),'esp');
});
test('uses TSA keyword order and ignores explicitly allowed filenames',()=>{
 assert.equal(filenameDetectionKeyword(['SuperXray.zip'],['ray','xray'],[]),'ray');
 assert.equal(filenameDetectionKeyword(['SuperXray.zip'],['xray','ray'],[]),'xray');
 assert.equal(filenameDetectionKeyword(['SuperXray.zip'],['ray'],['super-xray.zip']),'');
 assert.equal(filenameDetectionKeyword(['Other.jar','Esp.jar'],['esp'],[]),'esp');
 assert.equal(filenameDetectionKeyword(['Other.jar'],['esp'],[]),'');
 assert.equal(filenameDetectionKeyword([],['esp'],[]),'');
});

test('list filters use the same TSA normalization for filenames',()=>{
 const filename='§b§lSpectator Xray §7v1.2.1.zip';
 const hash='ABCDEF0123456789'.repeat(4);
 assert.equal(matchesTsaNameOrHash(hash,[filename],'spectatorxray'),true);
 assert.equal(matchesTsaNameOrHash(hash,[filename],'§b§lSpectator Xray'),true);
 assert.equal(matchesTsaNameOrHash(hash,['Ｆｒｅｅ ESP!.jar'],'freeesp'),true);
 assert.equal(matchesTsaNameOrHash(hash,['My-ESP Pack.zip'],'my esp pack'),true);
 assert.equal(matchesTsaNameOrHash(hash,['Other.jar',filename],'xray'),true);
 assert.equal(matchesTsaNameOrHash(hash,[filename],'anticheat'),false);
});

test('hash searches stay case-insensitive and support prefixes',()=>{
 const hash='ABCDEF0123456789'.repeat(4);
 assert.equal(matchesTsaNameOrHash(hash,[],'abcdef0123'),true);
 assert.equal(matchesTsaNameOrHash(hash,[],'ABCDEF0123'),true);
 assert.equal(matchesTsaNameOrHash(hash,[],'  abcdef0123  '),true);
 assert.equal(matchesTsaNameOrHash(hash,[],'deadbeef'),false);
 assert.equal(matchesTsaNameOrHash(hash,['file.jar'],'-----'),false);
 assert.equal(matchesTsaNameOrHash(hash,[],'   '),true);
});
