import {parentPort,workerData} from 'node:worker_threads';
import {inspectRegionBuffer,mergeRegionBuffers} from './codec.js';
import {renderRegion} from './render.js';
import {extractUpload} from './upload.js';
try {
 const incoming=Buffer.from(workerData.incoming);
 if(workerData.mode==='extract') {
  parentPort.postMessage(extractUpload(incoming,workerData.filename,workerData.dimension));
 } else {
  inspectRegionBuffer(incoming,workerData.region);
  const merged=workerData.previous?mergeRegionBuffers(Buffer.from(workerData.previous),incoming,workerData.region):null;
  const archive=merged?merged.buffer:incoming;
  const info=inspectRegionBuffer(archive,workerData.region);
  const png=renderRegion(archive,info,workerData.palette||{});
  parentPort.postMessage({archive,png,merged:!!merged,chunks:info.chunks.length});
 }
} catch(error) { parentPort.postMessage({error:error.message}); }
