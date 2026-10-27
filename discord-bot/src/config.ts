export interface BotConfig { token:string; guildId:string }
export function loadConfig(env:NodeJS.ProcessEnv=process.env):BotConfig {
  const token=env.DISCORD_BOT_TOKEN?.trim();
  if(!token||/\s/.test(token))throw new Error('Set DISCORD_BOT_TOKEN to the bot token from the Discord Developer Portal.');
  const id=(key:string)=>{
    const value=env[key]?.trim();
    if(!value||!/^[1-9][0-9]{16,19}$/.test(value))throw new Error('Set '+key+' to a Discord ID.');
    return value;
  };
  return {token,guildId:id('DISCORD_GUILD_ID')};
}
