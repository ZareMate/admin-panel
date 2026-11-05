import {zipSync} from 'fflate';
import {writePng,writeChunksDat} from '../src/ftb/codec.js';
import palette from '../src/ftb/palette.js';

export function regionZip(timestamp=100,chunkX=0,version=2,blockKey?:string) {
 const block=blockKey??Object.entries(palette.blockByIndex).find(([,name])=>name==='minecraft:stone')![0];
 const blocks=Buffer.alloc(512*512*4),data=Buffer.alloc(blocks.length),biome=Buffer.alloc(blocks.length);
 for(let offset=0;offset<blocks.length;offset+=4){
  blocks[offset]=parseInt(block.slice(0,2),16);blocks[offset+1]=parseInt(block.slice(2,4),16);blocks[offset+2]=parseInt(block.slice(4,6),16);blocks[offset+3]=255;
  data[offset+1]=100;biome[offset]=90;biome[offset+1]=160;biome[offset+2]=70;biome[offset+3]=255;
 }
 const png=(rgba:Buffer)=>writePng({width:512,height:512,rgba});
 return Buffer.from(zipSync({'blocks.png':png(blocks),'data.png':png(data),'grass.png':png(biome),'foliage.png':png(biome),'water.png':png(biome),
  'chunks.dat':writeChunksDat(version,[{x:chunkX,z:0,version:version>=3?4:0,lastModified:timestamp}])}));
}


export function cacheZip(regions:Record<string,Uint8Array>={'0EA60-0EA60.zip':regionZip(100,0,3,'ABCDEF')}) {
 return Buffer.from(zipSync({
  'block_map.txt':Buffer.from('#ABCDEF minecraft:stone\n'),
  'biome_map.txt':Buffer.from('#001 minecraft:plains\n'),
  'dimensions.txt':Buffer.from('minecraft:overworld\nminecraft:the_nether\n'),
  'minecraft_overworld/':new Uint8Array(),
  'minecraft_overworld/dimension.regions':new Uint8Array(),
  'minecraft_overworld/waypoints.json':Buffer.from('[]'),
  ...Object.fromEntries(Object.entries(regions).map(([name,data])=>['minecraft_overworld/'+name,data])),
  ...Object.fromEntries(Array.from({length:15},(_,i)=>['minecraft_the_nether/'+(60000+i).toString(16).padStart(5,'0')+'-0EA60.zip',regionZip()]))
 }));
}
