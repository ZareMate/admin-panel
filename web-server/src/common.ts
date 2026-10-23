import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
export class Failure extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
export type Role = 'viewer' | 'moderator' | 'admin';
export interface User { name: string; role: Role; rank: string; uuid: string; hash?: string; permissions?: string[] }
export const token = () => randomBytes(32).toString('base64url');
export function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Failure(400, 'JSON object required');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number, label = 'Value'): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x09\x0b-\x1f]/.test(value)) throw new Failure(400, `${label} is invalid`);
  return value;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)) throw new Failure(400, 'Invalid UUID');
  return value.toLowerCase();
}
export function discordUuid(id: string) {
  // UUID.nameUUIDFromBytes compatibility preserves existing note ownership.
  const bytes = createHash('md5').update('admin-panel:discord:' + id).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x30; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = bytes.toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
