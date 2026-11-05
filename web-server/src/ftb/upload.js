import {zipEntries,readZipEntry,inspectRegionBuffer,readPng,SUPPORTED_LAYERS,parseRegionName} from './codec.js';

/** Preflight a flat region or a single-level FTB cache export without extracting paths to disk. */
export function extractUpload(buffer,filename,dimension) {
 const entries=zipEntries(buffer,{cache:true});
 const regions=[];
 const palette={};
 if(entries.has('chunks.dat')) {
  const region=parseRegionName(filename);
  if(!region)throw new Error('Individual region ZIPs must be named XXXXX-XXXXX.zip');
  regions.push({name:region.name,archive:buffer});
 } else {
  if(!entries.has('dimensions.txt'))throw new Error('Cache export is missing dimensions.txt');
  const dimensions=readZipEntry(buffer,entries,'dimensions.txt').toString('utf8').split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
  if(!dimensions.includes(dimension))throw new Error('Cache export has no data for the selected dimension');
  const folder=dimension.replace(/[:/]/g,'_')+'/';
  const seen=new Set();
  for(const name of entries.keys())if(name.startsWith(folder)&&/\.zip$/i.test(name)) {
   const region=parseRegionName(name.slice(folder.length));
   if(!region||seen.has(region.name))throw new Error('Invalid or duplicate cache region');
   seen.add(region.name);
   if(regions.length>=512)throw new Error('Cache export exceeds 512 regions for this dimension');
   regions.push({name:region.name,archive:readZipEntry(buffer,entries,name)});
  }
  if(!regions.length)throw new Error('No region ZIPs found for the selected dimension');
  if(entries.has('block_map.txt')) {
   for(const line of readZipEntry(buffer,entries,'block_map.txt').toString('utf8').split(/\r?\n/)) {
    if(!line.trim())continue;
    const match=/^#([0-9a-f]{6})\s+([-a-z0-9_.]+:[-a-z0-9_./]+)\s*$/i.exec(line);
    if(!match||Object.hasOwn(palette,match[1].toUpperCase()))throw new Error('Invalid cache block_map.txt');
    palette[match[1].toUpperCase()]=match[2];
   }
  }
 }
 // Validate every nested region before any existing terrain is replaced.
 for(const region of regions) {
  inspectRegionBuffer(region.archive,region.name);
  const inner=zipEntries(region.archive);
  for(const name of SUPPORTED_LAYERS)readPng(readZipEntry(region.archive,inner,name));
 }
 return {regions,palette};
}
