package com.zaremate.admin_panel;

import java.nio.file.*;
import java.util.*;

final class SavedPlayerIdsTest {
    static int run() throws Exception {
        Path dir = Files.createTempDirectory("panel-saved-identities-");
        try {
            UUID known = UUID.randomUUID();
            UUID missing = UUID.fromString("adf0474e-34e7-4459-b53e-4cf63f7ecf16");
            Map<UUID, String> players = new HashMap<>();
            players.put(known, "KnownName");
            Files.writeString(dir.resolve(known + ".dat"), "No NBT reads should be needed");
            Files.writeString(dir.resolve(missing + ".dat"), "saved player");
            Files.writeString(dir.resolve(UUID.randomUUID() + ".dat_old"), "backup");
            Files.writeString(dir.resolve("invalid.dat"), "invalid");
            Files.writeString(dir.resolve("1-1-1-1-1.dat"), "noncanonical");
            Files.createDirectory(dir.resolve(UUID.randomUUID() + ".dat"));
            SavedPlayerIds.addTo(players, dir);
            if (players.size() != 2 || !players.get(known).equals("KnownName") || !players.get(missing).equals(missing.toString())) throw new AssertionError("Saved players must be included without replacing local names");
            SavedPlayerIds.addTo(players, dir.resolve("absent"));
            if (players.size() != 2) throw new AssertionError("Missing player directory");
            SavedPlayerIds.addTo(players, dir);
            if (players.size() != 2) throw new AssertionError("Duplicate identities");
            return 3;
        } finally {
            try (var files = Files.walk(dir)) {
                for (Path file : files.sorted(Comparator.reverseOrder()).toList()) Files.delete(file);
            }
        }
    }
}
