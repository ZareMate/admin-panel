package com.zaremate.admin_panel;

import java.util.*;
import com.google.gson.*;
import java.nio.charset.StandardCharsets;

record DiscordSettings(String clientId, String clientSecret, String guildId,
                       Map<String, String> roles, Map<String, UUID> minecraft, Map<String, String> rankNames) {
    static final String ORDER = "dev,owner,admin,mod,trial-mod,helper,trial-helper";
    static final Map<String,String> DEFAULT_IDS = Map.of("dev","1512986854532579388", "owner","1512986702161907712", "admin","1534544787066327162", "mod","1512987123672682656", "trial-mod","1518108874513584138", "helper","1512987186893557820", "trial-helper","1521965611121377280");
    static final Map<String,String> DEFAULT_ACCESS = Map.of("dev","admin", "owner","admin", "admin","admin", "mod","moderator", "trial-mod","moderator", "helper","viewer", "trial-helper","viewer");
    static DiscordSettings load(Properties p) {
        String clientId = snowflake(p.getProperty("discord.client-id", ""), "discord.client-id");
        String guildId = snowflake(p.getProperty("discord.guild-id", "1506410587553398854"), "discord.guild-id");
        String secret = System.getenv("ADMIN_PANEL_DISCORD_CLIENT_SECRET");
        if (secret == null || secret.isBlank()) secret = p.getProperty("discord.client-secret", "");
        if (secret.isBlank()) throw new IllegalArgumentException("Set discord.client-secret or ADMIN_PANEL_DISCORD_CLIENT_SECRET");
        Map<String, String> roles = new LinkedHashMap<>(), ranks = new HashMap<>();
        Set<String> names = new HashSet<>();
        for (String entry : p.getProperty("discord.rank-order", ORDER).split(",")) {
            String rank = entry.trim();
            if (!rank.matches("[a-z][a-z0-9-]{0,31}") || !names.add(rank)) throw new IllegalArgumentException("Invalid or duplicate Discord rank: " + rank);
            String roleId = snowflake(p.getProperty("discord.rank." + rank + ".role-id", DEFAULT_IDS.getOrDefault(rank, "")), "role ID for " + rank);
            String access = p.getProperty("discord.rank." + rank + ".access", DEFAULT_ACCESS.getOrDefault(rank, "viewer"));
            if (!Set.of("viewer", "moderator", "admin", "deny").contains(access)) throw new IllegalArgumentException("Invalid access level for " + rank);
            if (roles.putIfAbsent(roleId, access) != null) throw new IllegalArgumentException("Duplicate Discord role ID: " + roleId);
            ranks.put(roleId, rank);
        }
        Map<String, UUID> minecraft = new HashMap<>();
        for (String key : p.stringPropertyNames()) if (key.startsWith("discord.minecraft."))
            minecraft.put(snowflake(key.substring("discord.minecraft.".length()), key), UUID.fromString(p.getProperty(key).trim()));
        return new DiscordSettings(clientId, secret, guildId, Collections.unmodifiableMap(new LinkedHashMap<>(roles)), Map.copyOf(minecraft), Map.copyOf(ranks));
    }
    static String snowflake(String value, String label) {
        if (value == null || !value.matches("[1-9][0-9]{16,19}")) throw new IllegalArgumentException(label + " must be a Discord ID");
        return value;
    }
    private String highest(Set<String> memberRoles) {
        for (String id : roles.keySet()) if (memberRoles.contains(id)) return id;
        throw new PanelServer.Failure(403, "Your Discord roles do not grant panel access");
    }
    String role(Set<String> memberRoles) {
        String access = roles.get(highest(memberRoles));
        if (access.equals("deny")) throw new PanelServer.Failure(403, "Your Discord rank does not grant panel access");
        return access;
    }
    String rank(Set<String> memberRoles) { return rankNames.get(highest(memberRoles)); }
    JsonArray accessRanks() {
        JsonArray result = new JsonArray();
        roles.forEach((id, access) -> {
            JsonObject rank = new JsonObject();
            rank.addProperty("name", rankNames.get(id));
            rank.addProperty("discordRoleId", id);
            rank.addProperty("access", access);
            result.add(rank);
        });
        return result;
    }
    UUID uuid(String discordId) {
        return minecraft.getOrDefault(discordId, UUID.nameUUIDFromBytes(("admin-panel:discord:" + discordId).getBytes(StandardCharsets.UTF_8)));
    }
    @Override public String toString() { return "DiscordSettings[guildId=" + guildId + ", credentials=REDACTED]"; }
}
