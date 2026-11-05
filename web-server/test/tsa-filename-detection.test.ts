import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTsaFilename, filenameDetectionKeyword, matchesTsaNameOrHash, tsaFileType, matchesTsaFileType } from '../client/tsa-filename-detection.js';

test('matches TSA filename sanitization, including Minecraft formatting codes and Unicode',()=>{
 assert.equal(sanitizeTsaFilename('§b§lSpectator Xray §7v1.2.1.zip'),'blspectatorxray7v121zip');
 assert.equal(sanitizeTsaFilename('Ｆｒｅｅ ESP!.jar'),'freeespjar');
 assert.equal(filenameDetectionKeyword(['§b§lSpectator Xray §7v1.2.1.zip'],['esp','xray'],[]),'xray');
 assert.equal(filenameDetectionKeyword(['Free_ESP.jar'],['esp'],[]),'esp');
});
test('prefers longest keywords and ignores explicitly allowed filenames',()=>{
 assert.equal(filenameDetectionKeyword(['SuperXray.zip'],['ray','xray'],[]),'xray');
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

test('TSA file types include case-insensitive disabled jar and zip suffixes',()=>{
 for(const name of ['foo.jar','foo.JAR','foo.jar.disabled','foo.JAR.DISABLED','§bfoo.jar.disabled'])
  assert.equal(tsaFileType(name),'jar',name);
 for(const name of ['pack.zip','pack.ZIP','pack.zip.disabled','pack.ZIP.DISABLED','§aPack.zip.disabled'])
  assert.equal(tsaFileType(name),'zip',name);
 for(const name of ['file.txt','file.jar.backup','file.zip.disabled.bak','file','file.disabled',''])
  assert.equal(tsaFileType(name),'other',name);
});

test('type filtering supports multiple selections, associated filenames and unknown hashes',()=>{
 const jar=new Set(['jar'] as const),zip=new Set(['zip'] as const),other=new Set(['other'] as const);
 assert.equal(matchesTsaFileType(['foo.jar.DISABLED'],jar),true);
 assert.equal(matchesTsaFileType(['foo.jar.DISABLED'],zip),false);
 assert.equal(matchesTsaFileType(['foo.zip.DISABLED'],zip),true);
 assert.equal(matchesTsaFileType(['foo.txt'],other),true);
 assert.equal(matchesTsaFileType(['foo.jar','foo.zip'],new Set(['jar','zip'] as const)),true);
 assert.equal(matchesTsaFileType(['foo.jar','foo.zip'],other),false);
 assert.equal(matchesTsaFileType(['foo.jar','foo.txt'],other),true);
 assert.equal(matchesTsaFileType([],other),true);
 assert.equal(matchesTsaFileType([],jar),false);
 assert.equal(matchesTsaFileType(['foo.jar'],new Set()),false);
});


test('longest normalized keyword wins across aliases, with stable equal-length ties',()=>{
 assert.equal(filenameDetectionKeyword(['Glowing Ores Plus v19.0.0.zip'],['ore','ores'],[]),'ores');
 assert.equal(filenameDetectionKeyword(['Glowing Ores Plus v19.0.0.zip'],['ores','ore'],[]),'ores');
 assert.equal(filenameDetectionKeyword(['ore.zip','ores.zip'],['ore','ores'],[]),'ores');
 assert.equal(filenameDetectionKeyword(['Glowing Ｏｒｅｓ Plus.zip'],['ore','o-r-e-s'],[]),'ores');
 assert.equal(filenameDetectionKeyword(['ores.zip'],['ore','ores'],['ores.zip']),'');
 assert.equal(filenameDetectionKeyword(['ray-esp.jar'],['esp','ray'],[]),'esp');
});
