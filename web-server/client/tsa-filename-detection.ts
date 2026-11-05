/**
 * Use TSA filename normalization and exemptions for panel category labels:
 * NFKC, lowercase, strip all characters outside ASCII a-z and 0-9,
 * skip names exempted by either filename allowlist, and return the
 * longest matching normalized keyword (configuration order breaks equal-length ties).
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
 const normalizedKeywords=keywords.map(sanitizeTsaFilename).filter(Boolean).sort((a,b)=>b.length-a.length);
 const names=filenames.map(sanitizeTsaFilename).filter(name=>name&&!allowed.has(name));
 for(const keyword of normalizedKeywords)if(names.some(name=>name.includes(keyword)))return keyword;
 return '';
}

/**
 * Search TSA inventories using the same filename normalization as detection.
 * Keep SHA-256 matches separate so a hash query is never altered.
 */
export function matchesTsaNameOrHash(
 hash:string,
 filenames:readonly string[],
 query:string,
):boolean {
 const needle=query.trim();
 if(!needle)return true;
 if(hash.toLowerCase().includes(needle.toLowerCase()))return true;
 const normalized=sanitizeTsaFilename(needle);
 return normalized.length>0&&filenames.some(filename=>
  sanitizeTsaFilename(filename).includes(normalized));
}

export type TsaFileType='jar'|'zip'|'other';
export const TSA_FILE_TYPES:readonly TsaFileType[]=['jar','zip','other'];

/** File suffix categories are independent of TSA's keyword matching sanitizer. */
export function tsaFileType(filename:string):TsaFileType {
 const clean=filename.replace(/§./gu,'').trim().toLowerCase();
 if(/\.jar(?:\.disabled)?$/.test(clean))return 'jar';
 if(/\.zip(?:\.disabled)?$/.test(clean))return 'zip';
 return 'other';
}

/** A hash can have multiple historical filenames, so match any selected category. */
export function matchesTsaFileType(filenames:readonly string[],selected:ReadonlySet<TsaFileType>):boolean {
 if(!selected.size)return false;
 if(!filenames.length)return selected.has('other');
 return filenames.some(filename=>selected.has(tsaFileType(filename)));
}
