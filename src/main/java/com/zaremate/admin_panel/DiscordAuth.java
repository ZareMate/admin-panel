package com.zaremate.admin_panel;

import com.google.gson.*;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.LongSupplier;

final class DiscordAuth {
    record Start(String location, String browserToken) {}
    record Grant(String accessToken, String discordId, String username, long expires) {
        @Override public String toString() { return "DiscordGrant[credentials=REDACTED]"; }
    }
    record Login(Auth.User user, Grant grant) {}
    private record Pending(String browserToken, long expires) {}
    private final Map<String, Pending> pending = new HashMap<>();
    private final DiscordSettings settings;
    private final DiscordApi api;
    private final String callback;
    private final LongSupplier clock;
    DiscordAuth(DiscordSettings settings, DiscordApi api, String origin) { this(settings, api, origin, System::currentTimeMillis); }
    DiscordAuth(DiscordSettings settings, DiscordApi api, String origin, LongSupplier clock) {
        this.settings = settings; this.api = api; this.callback = origin + "/api/auth/discord/callback"; this.clock = clock;
    }
    synchronized Start start() {
        pending.entrySet().removeIf(e -> e.getValue().expires() <= clock.getAsLong());
        if (pending.size() >= 1024) throw new PanelServer.Failure(429, "Too many pending Discord logins");
        String state = Auth.token(), browser = Auth.token();
        pending.put(state, new Pending(browser, clock.getAsLong() + 300_000));
        String location = "https://discord.com/oauth2/authorize?response_type=code&client_id=" + HttpDiscordApi.encode(settings.clientId())
                + "&scope=identify%20guilds.members.read&state=" + state + "&redirect_uri=" + HttpDiscordApi.encode(callback);
        return new Start(location, browser);
    }
    private synchronized void consume(String state, String browser) {
        Pending request = pending.get(state);
        if (request == null || request.expires() <= clock.getAsLong() || browser == null || !MessageDigest.isEqual(
                request.browserToken().getBytes(StandardCharsets.UTF_8), browser.getBytes(StandardCharsets.UTF_8)))
            throw new PanelServer.Failure(400, "Discord login expired or state did not match this browser. Start sign-in again.");
        pending.remove(state);
    }
    Login finish(String state, String browser, String code, boolean denied) throws Exception {
        consume(state, browser);
        if (denied) throw new PanelServer.Failure(401, "Discord sign-in was cancelled");
        if (code == null || code.isBlank() || code.length() > 2048) throw new PanelServer.Failure(400, "Missing Discord authorization code");
        JsonObject token = api.exchange(code, callback);
        String access = PanelServer.string(token, "access_token", 4096);
        if (!"Bearer".equalsIgnoreCase(PanelServer.string(token, "token_type", 16))) throw new PanelServer.Failure(401, "Unsupported Discord token");
        Set<String> scopes = new HashSet<>(Arrays.asList(PanelServer.string(token, "scope", 1024).split("\\s+")));
        if (!scopes.containsAll(Set.of("identify", "guilds.members.read"))) throw new PanelServer.Failure(403, "Discord consent must include identity and guild membership");
        long seconds = token.get("expires_in").getAsBigDecimal().longValueExact();
        if (seconds <= 0) throw new PanelServer.Failure(401, "Discord token expired");
        JsonObject identity = api.identity(access);
        String id = DiscordSettings.snowflake(PanelServer.string(identity,"id",20), "Discord user ID");
        String username = PanelServer.string(identity, "username", 100);
        Grant grant = new Grant(access, id, username, clock.getAsLong() + Math.min(seconds, 28800) * 1000);
        return new Login(authorize(grant), grant);
    }
    Auth.User authorize(Grant grant) throws Exception {
        if (grant.expires() <= clock.getAsLong()) throw new PanelServer.Failure(401, "Discord session expired. Sign in again.");
        JsonObject member = api.membership(grant.accessToken(), settings.guildId());
        if (member.has("pending") && member.get("pending").getAsBoolean()) throw new PanelServer.Failure(403, "Complete Discord membership screening first");
        if (member.has("user") && !grant.discordId().equals(member.getAsJsonObject("user").get("id").getAsString()))
            throw new PanelServer.Failure(403, "Discord member identity mismatch");
        if (!member.has("roles") || !member.get("roles").isJsonArray()) throw new PanelServer.Failure(403, "Discord roles could not be verified");
        Set<String> roles = new HashSet<>();
        member.getAsJsonArray("roles").forEach(r -> roles.add(r.getAsString()));
        String role = settings.role(roles);
        return new Auth.User(grant.username() + " [" + grant.discordId() + "]", role, settings.uuid(grant.discordId()), "", settings.rank(roles));
    }
}
