/**
 * Match TSA's TsaFilenameDetection.findFilenameKeyword rules:
 * NFKC, lowercase, strip all characters outside ASCII a-z and 0-9,
 * skip names exempted by either filename allowlist, and return the
 * first configured keyword found (configuration order).
 * This describes a CURRENT match, not historical blacklist provenance.
 */
export const sanitizeTsaFilename=(name:string):string=>
 name.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');

export function filenameDetectionKeyword(
 filenames:readonly string[],
 keywords:readonly string[],
 allowedNames:readonly string[],
):string {
 const allowed=new Set(allowedNames.map(sanitizeTsaFilename));
 const normalizedKeywords=keywords.map(sanitizeTsaFilename).filter(Boolean);
 for(const filename of filenames) {
  const name=sanitizeTsaFilename(filename);
  if(!name||allowed.has(name))continue;
  for(const keyword of normalizedKeywords)if(name.includes(keyword))return keyword;
 }
 return '';
}
