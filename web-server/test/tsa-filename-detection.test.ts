import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTsaFilename, filenameDetectionKeyword } from '../client/tsa-filename-detection.js';

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
