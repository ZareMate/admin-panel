export function durationMinutes(input:unknown):number {
  const value=String(input||'').trim().toLowerCase();
  if(['perm','permanent','forever'].includes(value))return 0;
  const match=/^(\d+)\s*(m|min|h|d|w)$/.exec(value);
  if(!match)throw new Error('Invalid duration. Use 30m, 1h, 3d, 1w or perm.');
  const minutes=Number(match[1])*({m:1,min:1,h:60,d:1440,w:10080}[match[2]!]!);
  if(!Number.isSafeInteger(minutes)||minutes<1||minutes>5256000)throw new Error('Duration must be between 1 minute and 10 years, or perm.');
  return minutes;
}
