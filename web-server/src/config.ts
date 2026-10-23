import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Failure, type User, type Role, text, uuid, token } from './common.js';
import { PERMISSIONS, legacyPermissions } from './permissions.js';
export function permissions(value:unknown):string[] {
 if(!Array.isArray(value)||!value.every(p=>typeof p==='string'&&(PERMISSIONS as readonly string[]).includes(p)))throw new Failure(400,'Unknown permission');
 return [...new Set(value)] as string[];
}
export interface Rank { name: string; discordRoleId: string; access: Role | 'deny'; permissions:string[] }
export interface Config {
  origin: string; bind: string; port: number; secure: boolean; bridgeToken: string;
  mode: 'local' | 'discord'; users: Map<string, User>; ranks: Rank[];
  clientId: string; clientSecret: string; guildId: string; mappings: Map<string, string>;
  path: string; dataDir: string; trustedProxies: string[]; props: Map<string, string>;
}
// Java Properties compatibility: continuations, escaped separators and Unicode from Properties.store.
export function parseProperties(source: string): Map<string, string> {
  const result = new Map<string, string>(); let joined = '';
  const decode = (s: string) => s.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (_, hex, ch) => hex ? String.fromCharCode(parseInt(hex,16)) : ({t:'\t', n:'\n', r:'\r', f:'\f'}[ch as string] ?? ch));
  for (let line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (joined) line = joined + line.trimStart();
    const backslashes = /\\+$/.exec(line)?.[0].length ?? 0;
    if (backslashes % 2) { joined = line.slice(0,-1); continue; }
    joined = ''; line = line.trimStart(); if (!line || /^[#!]/.test(line)) continue;
    let end = 0;
    while (end < line.length) { if (line[end] === '\\') { end += 2; continue; } if (/[\s=:]/.test(line[end]!)) break; end++; }
    const key = line.slice(0,end); let rest = line.slice(end).trimStart();
    if (/^[=:]/.test(rest)) rest = rest.slice(1).trimStart();
    result.set(decode(key), decode(rest));
  }
  return result;
}
export const snowflake = (value: unknown) => {
  if (typeof value !== 'string' || !/^[1-9][0-9]{16,19}$/.test(value)) throw new Failure(400, 'Invalid Discord ID');
  return value;
};
export function validateRanks(value: unknown, requireManager = true): Rank[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) throw new Failure(400, 'Provide 1–30 ranks');
  const names = new Set<string>(), ids = new Set<string>();
  const ranks = value.map(row => {
    if (!row || typeof row !== 'object') throw new Failure(400, 'Invalid rank');
    const name = text(row.name,32), id = snowflake(row.discordRoleId), access = row.access;
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(name) || names.has(name) || ids.has(id)) throw new Failure(400, 'Invalid or duplicate rank');
    names.add(name); ids.add(id); if(row.permissions===undefined&&!['admin','moderator','viewer','deny'].includes(access))throw new Failure(400,'Permissions required');
    return {name, discordRoleId:id, access:['admin','moderator','viewer','deny'].includes(access)?access:'viewer', permissions:permissions(row.permissions===undefined?legacyPermissions(access,name):row.permissions)} as Rank;
  });
  if (requireManager && !ranks.some(r => r.permissions.includes('panel.access') && r.permissions.includes('access.manage'))) throw new Failure(400, 'Keep a rank with panel.access and access.manage');
  return ranks;
}
export async function loadConfig(env = process.env): Promise<Config> {
  const dataDir = resolve(env.DATA_DIR || 'data'), path = resolve(env.PANEL_CONFIG || `${dataDir}/config/admin-panel.properties`);
  const props = parseProperties(await readFile(path, 'utf8'));
  if (props.get('enabled') !== 'true') throw new Error('Set enabled=true in ' + path);
  const origin = env.PUBLIC_ORIGIN || props.get('origin') || 'http://localhost:3000';
  const url = new URL(origin);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || origin !== url.origin) throw new Error('PUBLIC_ORIGIN must be scheme://host[:port], with no path or trailing slash');
  if (url.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname) && props.get('allow-insecure-http') !== 'true') throw new Error('Public origin requires HTTPS, or explicit allow-insecure-http=true for a trusted private network');
  const bridgeToken = env.ADMIN_PANEL_BRIDGE_TOKEN || '';
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(bridgeToken)) throw new Error('Set ADMIN_PANEL_BRIDGE_TOKEN to a random 43–128 character URL-safe secret');
  const mode = props.get('auth.mode') || 'local';
  if (mode !== 'local' && mode !== 'discord') throw new Error('auth.mode must be local or discord');
  const port = Number(env.PORT || props.get('port') || '3000');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  const users = new Map<string,User>(), mappings = new Map<string,string>();
  for (const [key,value] of props) {
    if (key.startsWith('user.') && mode === 'local') {
      const name = key.slice(5), [role,id,hash,...extra] = value.split(',');
      if (!/^[a-zA-Z0-9_-]{3,32}$/.test(name) || (!/^[a-z][a-z0-9-]{0,31}$/.test(role!) || (!['viewer','moderator','admin'].includes(role!)&&!props.has('permissions.'+name))) || !/^[0-9a-f]{32}:[0-9a-f]{64}$/.test(hash!) || extra.length) throw new Error('Invalid staff account: ' + name);
      users.set(name,{name,role:(['viewer','moderator','admin'].includes(role!)?role:'viewer') as Role,rank:role!,uuid:uuid(id),hash,permissions:props.has('permissions.'+name)?permissions(props.get('permissions.'+name)!.split(',').map(s=>s.trim()).filter(Boolean)):legacyPermissions(role!)});
    }
    if (key.startsWith('discord.minecraft.')) mappings.set(snowflake(key.slice(18)),uuid(value.trim()));
  }
  const clientId = props.get('discord.client-id') || '', clientSecret = env.ADMIN_PANEL_DISCORD_CLIENT_SECRET || props.get('discord.client-secret') || '', guildId = props.get('discord.guild-id') || '';
  let ranks: Rank[] = [];
  if (mode === 'discord') {
    snowflake(clientId); snowflake(guildId); if (!clientSecret) throw new Error('Discord client secret required');
    ranks = validateRanks((props.get('discord.rank-order') || '').split(',').map(name => ({name:name.trim(),discordRoleId:props.get(`discord.rank.${name.trim()}.role-id`),access:props.get(`discord.rank.${name.trim()}.access`),permissions:props.has(`discord.rank.${name.trim()}.permissions`)?props.get(`discord.rank.${name.trim()}.permissions`)!.split(',').map(s=>s.trim()).filter(Boolean):undefined})),false);
  } else if (!users.size) throw new Error('At least one local staff account is required');
  return {origin,bind:env.HOST || props.get('bind') || '0.0.0.0',port,secure:url.protocol==='https:',bridgeToken,mode,users,ranks,clientId,clientSecret,guildId,mappings,path,dataDir,props,
    trustedProxies:(env.TRUSTED_PROXIES || '').split(',').map(s=>s.trim()).filter(Boolean)};
}
export async function saveRanks(config: Config, value: unknown) {
  const ranks = validateRanks(value), props = parseProperties(await readFile(config.path,'utf8'));
  if (props.get('auth.mode') !== 'discord') throw new Failure(400,'Discord authentication required');
  for (const key of props.keys()) if (key.startsWith('discord.rank.')) props.delete(key);
  props.set('discord.rank-order',ranks.map(r=>r.name).join(','));
  for (const rank of ranks) { props.set(`discord.rank.${rank.name}.role-id`,rank.discordRoleId); props.set(`discord.rank.${rank.name}.permissions`,rank.permissions.join(',')); }
  const escape = (s:string) => s.replace(/[\\\n\r\t=:#! ]/g,ch=>({'\n':'\\n','\r':'\\r','\t':'\\t'}[ch] ?? '\\'+ch));
  await mkdir(dirname(config.path),{recursive:true}); const temporary = `${config.path}.${token()}.tmp`;
  try { await writeFile(temporary,[...props].map(([k,v])=>`${escape(k)}=${escape(v)}`).join('\n')+'\n',{mode:0o600}); await rename(temporary,config.path); }
  finally { await unlink(temporary).catch(()=>{}); }
}
