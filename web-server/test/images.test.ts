import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import sharp from 'sharp';
import { Images } from '../src/images.js';

test('host-side icons preserve exported PNGs, layered textures, static blocks, and missing-asset fallback',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'node-icons-'));const put=async(path:string,data:string|Buffer)=>{await mkdir(dirname(join(dir,path)),{recursive:true});await writeFile(join(dir,path),data);};
 try {
  const png=await sharp({create:{width:16,height:32,channels:4,background:'#ff3300'}}).png().toBuffer();
  await put('icons/test__export.png',png);await put('assets/test/textures/item/red.png',png);
  await put('assets/test/models/item/flat.json',JSON.stringify({parent:'minecraft:item/generated',textures:{layer0:'test:item/red'}}));
  await put('assets/test/models/item/block.json',JSON.stringify({parent:'minecraft:block/cube_all',textures:{all:'test:item/red'}}));
  await put('assets/test/models/item/tint.json',JSON.stringify({elements:[{from:[0,0,0],to:[16,16,16],faces:{south:{texture:'test:item/red',tintindex:0}}}]}));
  const images=new Images(dir,dir);await images.init();const result=await images.icons(['test:export','test:flat','test:block','test:tint','test:missing']);
  assert.equal(result['test:export'],'data:image/png;base64,'+png.toString('base64'));
  for(const id of ['test:flat','test:block']){assert(result[id]?.startsWith('data:image/png;base64,'),id);const image=sharp(Buffer.from(result[id]!.split(',')[1]!,'base64'));const meta=await image.metadata();assert.equal(meta.width,64);assert.equal(meta.height,64);const stats=await image.stats();assert(stats.channels[3]!.max>0,'render is not transparent');}
  assert.equal(result['test:missing'],'');assert.equal(result['test:tint'],'');
 }finally{await rm(dir,{recursive:true,force:true});}
});
