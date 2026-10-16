package com.zaremate.admin_panel;

import com.google.gson.*;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermission;
import java.util.*;

/** Validates and atomically persists rank changes without touching unrelated settings. */
final class RankConfigEditor {
    private RankConfigEditor() {}
    static synchronized void save(Path path, JsonArray rows) throws Exception {
        if (rows == null || rows.isEmpty() || rows.size() > 30) throw new IllegalArgumentException("Provide 1–30 ranks");
        Properties props = new Properties();
        try (var in = Files.newInputStream(path)) { props.load(in); }
        if (!"discord".equals(props.getProperty("auth.mode", "local"))) throw new IllegalArgumentException("Discord authentication required");
        Set<String> names = new HashSet<>(), ids = new HashSet<>();
        List<String> order = new ArrayList<>();
        for (JsonElement element : rows) {
            if (!element.isJsonObject()) throw new IllegalArgumentException("Invalid rank");
            JsonObject row = element.getAsJsonObject();
            String name = PanelServer.string(row, "name", 32);
            String id = PanelServer.string(row, "discordRoleId", 20);
            String access = PanelServer.string(row, "access", 16);
            if (!name.matches("[a-z][a-z0-9-]{0,31}") || !names.add(name))
                throw new IllegalArgumentException("Invalid or duplicate rank name");
            DiscordSettings.snowflake(id, "Discord role ID");
            if (!ids.add(id)) throw new IllegalArgumentException("Duplicate Discord role ID");
            if (!Set.of("admin", "moderator", "viewer", "deny").contains(access))
                throw new IllegalArgumentException("Invalid access level");
            order.add(name);
        }
        // Preserve at least one authorized owner/developer to manage access.
        boolean manager = false;
        for (JsonElement element : rows) {
            JsonObject row = element.getAsJsonObject();
            if (Set.of("dev", "owner").contains(row.get("name").getAsString())
                    && "admin".equals(row.get("access").getAsString())) manager = true;
        }
        if (!manager) throw new IllegalArgumentException("Keep an owner or dev rank with admin access");
        for (String key : new ArrayList<>(props.stringPropertyNames()))
            if (key.startsWith("discord.rank.")) props.remove(key);
        props.setProperty("discord.rank-order", String.join(",", order));
        for (JsonElement element : rows) {
            JsonObject row = element.getAsJsonObject();
            String prefix = "discord.rank." + row.get("name").getAsString();
            props.setProperty(prefix + ".role-id", row.get("discordRoleId").getAsString());
            props.setProperty(prefix + ".access", row.get("access").getAsString());
        }
        DiscordSettings.load(props);
        Path tmp = Files.createTempFile(path.getParent(), ".admin-panel-ranks-", ".tmp");
        try {
            try { Files.setPosixFilePermissions(tmp, EnumSet.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE)); }
            catch (UnsupportedOperationException ignored) {}
            try (var out = Files.newOutputStream(tmp)) { props.store(out, "Admin Panel configuration"); }
            Files.move(tmp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(tmp); }
    }
}
