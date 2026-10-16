package com.zaremate.admin_panel;

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;

/** Small bounded memory cache for MineSkin PNGs, shared by all logged-in panel users. */
final class SkinCache {
    private static final long TTL = Duration.ofHours(6).toMillis();
    private static final int MAX_ENTRIES = 512;
    private static final int MAX_IMAGE_BYTES = 1024 * 1024;
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(4)).followRedirects(HttpClient.Redirect.NEVER).build();
    private record Entry(byte[] png, long expiry) {}
    private final Map<String, Entry> images = new LinkedHashMap<>(64, .75f, true) {
        protected boolean removeEldestEntry(Map.Entry<String,Entry> eldest) { return size() > MAX_ENTRIES; }
    };
    synchronized byte[] load(String kind, String username) throws Exception {
        if (!Set.of("head", "body").contains(kind) || !username.matches("[A-Za-z0-9_]{3,16}"))
            throw new PanelServer.Failure(400, "Invalid skin request");
        String key = kind + ":" + username.toLowerCase(Locale.ROOT);
        long now = System.currentTimeMillis();
        Entry cached = images.get(key);
        if (cached != null && cached.expiry() > now) return cached.png();
        String url = kind.equals("head") ? "https://mineskin.eu/helm/" + username + "/100.png"
                : "https://mineskin.eu/skin/" + username;
        var request = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(8))
                .header("Accept", "image/png").GET().build();
        var response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
        if (response.statusCode() != 200) {
            response.body().close();
            throw new PanelServer.Failure(502, "Skin image provider unavailable");
        }
        byte[] data;
        try (var stream = response.body()) { data = stream.readNBytes(MAX_IMAGE_BYTES + 1); }
        if (data.length > MAX_IMAGE_BYTES || !ItemIcons.png(data))
            throw new PanelServer.Failure(502, "Skin provider returned an invalid PNG");
        images.put(key, new Entry(data, now + TTL));
        return data;
    }
}
