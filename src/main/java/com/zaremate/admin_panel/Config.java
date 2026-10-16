package com.zaremate.admin_panel;

import java.nio.file.*;
import java.net.URI;
import java.util.*;

record Config(String bind, int port, String origin, Map<String, Auth.User> users, DiscordSettings discord) {
    Config(String bind, int port, String origin, Map<String, Auth.User> users) { this(bind, port, origin, users, null); }
    static Config load(Path file) throws Exception {
        if (!Files.exists(file)) throw new IllegalStateException("Missing panel configuration; use first-run setup");
        Properties p = new Properties();
        try (var in = Files.newInputStream(file)) { p.load(in); }
        if (!Boolean.parseBoolean(p.getProperty("enabled", "false"))) return null;
        String origin = p.getProperty("origin", "http://localhost:8080");
        URI uri = URI.create(origin);
        if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null
                || uri.getQuery() != null || uri.getFragment() != null || (uri.getPath() != null && !uri.getPath().isEmpty()))
            throw new IllegalArgumentException("origin must be scheme://host[:port], without a trailing slash");
        if (uri.getScheme().equals("http") && !Set.of("localhost", "127.0.0.1", "[::1]").contains(uri.getHost())
                && !Boolean.parseBoolean(p.getProperty("allow-insecure-http", "false")))
            throw new IllegalArgumentException("Non-local origins require HTTPS through a reverse proxy, or explicit allow-insecure-http=true for trusted-network HTTP access");
        String mode = p.getProperty("auth.mode", "local");
        if (!Set.of("local", "discord").contains(mode)) throw new IllegalArgumentException("auth.mode must be local or discord");
        if (mode.equals("discord")) return new Config(p.getProperty("bind", "127.0.0.1"), Integer.parseInt(p.getProperty("port", "8080")), origin, Map.of(), DiscordSettings.load(p));
        Map<String, Auth.User> users = new HashMap<>();
        for (String key : p.stringPropertyNames()) if (key.startsWith("user.")) {
            String name = key.substring(5);
            String[] fields = p.getProperty(key).split(",", -1);
            if (!name.matches("[a-zA-Z0-9_-]{3,32}") || fields.length != 3 || !Set.of("viewer", "moderator", "admin").contains(fields[0])
                    || !fields[2].matches("[0-9a-f]{32}:[0-9a-f]{64}")) throw new IllegalArgumentException("Invalid staff account: " + name);
            users.put(name, new Auth.User(name, fields[0], UUID.fromString(fields[1]), fields[2]));
        }
        if (users.isEmpty()) throw new IllegalArgumentException("At least one staff account is required");
        return new Config(p.getProperty("bind", "127.0.0.1"), Integer.parseInt(p.getProperty("port", "8080")), origin, users);
    }
    boolean secure() { return origin.startsWith("https:"); }
}
