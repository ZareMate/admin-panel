package com.zaremate.admin_panel;

import java.net.URI;
import java.nio.file.*;
import java.util.*;

record BridgeConfig(URI url, String token) {
    static BridgeConfig load(Path path) throws Exception {
        if (!Files.exists(path)) {
            Files.createDirectories(path.getParent());
            Files.writeString(path, "enabled=false\nurl=ws://localhost:8081/bridge\ntoken=\n");
            return null;
        }
        Properties values = new Properties();
        try (var in = Files.newInputStream(path)) { values.load(in); }
        if (!Boolean.parseBoolean(values.getProperty("enabled", "false"))) return null;
        URI url = URI.create(values.getProperty("url", ""));
        if (!Set.of("ws", "wss").contains(url.getScheme()) || url.getHost() == null
                || url.getUserInfo() != null || url.getQuery() != null || url.getFragment() != null
                || !"/bridge".equals(url.getPath())) throw new IllegalArgumentException("Expected ws(s)://host[:port]/bridge");
        if (url.getScheme().equals("ws") && !Set.of("localhost", "127.0.0.1", "[::1]").contains(url.getHost())
                && !Boolean.parseBoolean(values.getProperty("allow-insecure-ws", "false")))
            throw new IllegalArgumentException("Remote bridge requires wss, or explicit allow-insecure-ws=true on a trusted network");
        return new BridgeConfig(url, requireToken(values.getProperty("token", "")));
    }
    static String requireToken(String token) {
        if (!token.matches("[A-Za-z0-9_-]{43,128}")) throw new IllegalArgumentException("Bridge token must be 43-128 URL-safe random characters");
        return token;
    }
}
