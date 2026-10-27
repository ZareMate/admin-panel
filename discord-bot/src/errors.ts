// Only fixed diagnostics are returned: Discord errors can contain tokens/request metadata.
export function errorDetail(error:unknown):string {
 const e=error&&typeof error==='object'?error as {code?:unknown;message?:unknown;cause?:{code?:unknown}}:{};
 const code=e.code??e.cause?.code;
 if(code===4014||e.message==='Used disallowed intents')return 'Discord rejected Message Content Intent. Open Discord Developer Portal → your application → Bot → Privileged Gateway Intents, enable Message Content Intent, save, and restart the bot. If approval is required, request it from Discord.';
 if(code===4013||e.message==='Used invalid intents')return 'Discord rejected the configured gateway intents. Check the bot version and intent configuration.';
 if(code==='TokenInvalid'||code===4004||code===401||e.message==='Authentication failed')return 'Invalid bot token. Set DISCORD_BOT_TOKEN to the token from the application’s Bot page.';
 if(code===10004)return 'Guild not found. Check DISCORD_GUILD_ID and invite the bot.';
 if(code===50001||code===50013)return 'Bot lacks access. Check its guild membership and channel permissions.';
 if(['ENOTFOUND','EAI_AGAIN'].includes(String(code)))return 'Discord hostname lookup failed. Check DNS and network access.';
 if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(String(code)))return 'Connection to Discord failed. Check outbound network access and retry.';
 if(['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(String(code)))return 'TLS certificate verification failed. Check the system clock, CA certificates and proxy configuration.';
 return 'Check configuration, bot permissions and network access. No recognized safe error detail was available.';
}
