package com.zaremate.admin_panel;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.*;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

final class Auth {
    record User(String name, String role, UUID uuid, String hash, String rank, Set<String> permissions) {
        User { permissions = Set.copyOf(permissions); }
        User(String name, String role, UUID uuid, String hash, String rank) { this(name, role, uuid, hash, rank, Permissions.legacy(role, rank)); }
        boolean has(String permission) { return permissions.contains(permission); }
        void require(String permission) { if (!has(permission)) throw new PanelServer.Failure(403, "Permission required: " + permission); }
        User(String name, String role, UUID uuid, String hash) { this(name, role, uuid, hash, role); }
        boolean canModerate() { return role.equals("admin") || role.equals("moderator"); }
        boolean isAdmin() { return role.equals("admin"); }
    }
    record Session(User user, String csrf, long expires, DiscordAuth.Grant discord) {}
    private final Map<String, User> users;
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    private final Map<String, long[]> attempts = new HashMap<>();
    private static final SecureRandom RANDOM = new SecureRandom();
    Auth(Map<String, User> users) { this.users = Map.copyOf(users); }
    static String token() { byte[] b = new byte[32]; RANDOM.nextBytes(b); return Base64.getUrlEncoder().withoutPadding().encodeToString(b); }
    static String hash(char[] password, byte[] salt) throws Exception {
        var spec = new PBEKeySpec(password, salt, 600_000, 256);
        try { return HexFormat.of().formatHex(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded()); }
        finally { spec.clearPassword(); }
    }
    static boolean verify(String password, String encoded) {
        try {
            String[] parts = encoded.split(":");
            return parts.length == 2 && MessageDigest.isEqual(HexFormat.of().parseHex(parts[1]),
                    HexFormat.of().parseHex(hash(password.toCharArray(), HexFormat.of().parseHex(parts[0]))));
        } catch (Exception e) { return false; }
    }
    synchronized boolean allowLogin(String address) {
        long now = System.currentTimeMillis();
        attempts.entrySet().removeIf(e -> e.getValue()[1] < now);
        if (attempts.size() >= 4096 && !attempts.containsKey(address)) return false;
        long[] a = attempts.computeIfAbsent(address, k -> new long[]{0, now + 300_000});
        return ++a[0] <= 10;
    }
    User authenticate(String name, String password) {
        User user = users.get(name);
        // The same expensive hash is performed for unknown usernames.
        String dummy = "00000000000000000000000000000000:" + "0".repeat(64);
        boolean valid = verify(password, user == null ? dummy : user.hash());
        return valid ? user : null;
    }
    String create(User user) { return create(user, null); }
    String create(User user, DiscordAuth.Grant discord) {
        sessions.entrySet().removeIf(e -> e.getValue().expires() < System.currentTimeMillis());
        if (sessions.size() >= 1024) throw new IllegalStateException("Session capacity reached");
        String id = token();
        sessions.put(id, new Session(user, token(), Math.min(System.currentTimeMillis() + 8 * 3600_000L, discord == null ? Long.MAX_VALUE : discord.expires()), discord));
        return id;
    }
    Session get(String token) {
        Session session = sessions.get(token);
        if (session != null && session.expires() <= System.currentTimeMillis()) { sessions.remove(token); return null; }
        return session;
    }
    void refresh(String token, User user) {
        sessions.computeIfPresent(token, (key, old) ->
            new Session(user, old.csrf(), old.expires(), old.discord()));
    }
    void logout(String token) { sessions.remove(token); }
}
