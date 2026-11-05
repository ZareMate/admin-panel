package com.zaremate.admin_panel;

import java.io.IOException;
import java.nio.file.*;
import java.util.Map;
import java.util.UUID;

/** Directory-only discovery on the bridge worker; no NBT or live state is needed. */
final class SavedPlayerIds {
    static void addTo(Map<UUID, String> players, Path directory) throws IOException {
        if (!Files.isDirectory(directory)) return;
        try (var files = Files.list(directory)) {
            for (Path file : files.toList()) {
                if (Thread.currentThread().isInterrupted()) throw new java.util.concurrent.CancellationException("Player discovery stopped");
                String name = file.getFileName().toString();
                if (!name.endsWith(".dat") || !Files.isRegularFile(file)) continue;
                String raw = name.substring(0, name.length() - 4);
                try {
                    UUID id = UUID.fromString(raw);
                    if (id.toString().equalsIgnoreCase(raw)) players.putIfAbsent(id, id.toString());
                } catch (IllegalArgumentException ignored) {}
            }
        }
    }
}
