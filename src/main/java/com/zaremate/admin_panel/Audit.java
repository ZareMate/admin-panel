package com.zaremate.admin_panel;

import com.google.gson.*;
import java.nio.file.*;
import java.nio.channels.FileChannel;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;

final class Audit {
    private final Path file;
    private final ArrayDeque<JsonObject> recent = new ArrayDeque<>();
    Audit(Path file) throws Exception {
        this.file = file;
        Files.createDirectories(file.getParent());
        if (Files.exists(file)) try (var lines = Files.lines(file)) {
            lines.forEach(line -> { try { remember(JsonParser.parseString(line).getAsJsonObject()); } catch (RuntimeException ignored) {} });
        }
    }
    private void remember(JsonObject row) { recent.addFirst(row); while (recent.size() > 500) recent.removeLast(); }
    synchronized void write(String actor, String action, String target, String state, JsonElement detail) throws Exception {
        JsonObject row = new JsonObject();
        row.addProperty("at", System.currentTimeMillis()); row.addProperty("actor", actor);
        row.addProperty("action", action); row.addProperty("target", target); row.addProperty("state", state); row.add("detail", detail);
        try (var out = FileChannel.open(file, StandardOpenOption.CREATE, StandardOpenOption.WRITE, StandardOpenOption.APPEND)) {
            ByteBuffer buffer = StandardCharsets.UTF_8.encode(row + "\n");
            while (buffer.hasRemaining()) out.write(buffer);
            out.force(true);
        }
        remember(row);
    }
    synchronized JsonArray recent() { JsonArray a = new JsonArray(); recent.forEach(r -> a.add(r.deepCopy())); return a; }
}
