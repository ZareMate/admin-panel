package com.zaremate.admin_panel;

import com.google.gson.*;
import java.util.*;
import java.util.concurrent.*;

/** Optional asynchronous TSA list API adapter; invoked only by the bridge worker. */
final class TsaLists {
    private static final Gson GSON = new Gson();
    private TsaLists() {}
    static JsonObject access(JsonObject update) throws Exception {
        try {
            Class<?> api = Class.forName("com.zaremate.tsa_anticheat.api.TsaAnticheatAPI");
            Class<?> hashList = Class.forName("com.zaremate.tsa_anticheat.api.HashList");
            Object selected = null;
            if (update != null) {
                String list = RequestFields.string(update, "list", 32);
                String action = RequestFields.string(update, "action", 8);
                if (!Set.of("add", "remove").contains(action)) throw new IllegalArgumentException("Expected add or remove");
                String prefix = action.equals("add") ? "add" : "remove";
                if (list.equals("FILENAMES")) {
                    selected = api.getMethod(prefix + "AllowedFilenameAsync", String.class)
                            .invoke(null, RequestFields.string(update, "name", 1024));
                } else {
                    Object kind = Arrays.stream(hashList.getEnumConstants()).filter(value -> ((Enum<?>) value).name().equals(list))
                            .findFirst().orElseThrow(() -> new IllegalArgumentException("Unknown TSA list"));
                    selected = api.getMethod(prefix + "HashAsync", hashList, String.class).invoke(null, kind, RequestFields.string(update, "hash", 64));
                }
            }
            Boolean changed = selected == null ? null : (Boolean) await(selected);
            // Queue all reads together so only one worker wait is needed for the snapshot.
            Map<String, CompletableFuture<?>> reads = new LinkedHashMap<>();
            for (Object kind : hashList.getEnumConstants()) reads.put(((Enum<?>) kind).name(),
                    (CompletableFuture<?>) api.getMethod("getHashesAsync", hashList).invoke(null, kind));
            reads.put("FILENAMES", (CompletableFuture<?>) api.getMethod("getAllowedFilenamesAsync").invoke(null));
            await(CompletableFuture.allOf(reads.values().toArray(CompletableFuture[]::new)));
            JsonObject lists = new JsonObject();
            for (var entry : reads.entrySet()) lists.add(entry.getKey(), GSON.toJsonTree(entry.getValue().join()));
            JsonObject result = new JsonObject(); result.add("lists", lists);
            if (changed != null) result.addProperty("changed", changed);
            return result;
        } catch (ClassNotFoundException | NoSuchMethodException error) {
            throw new BridgeFailure(409, "Install TSA with the list management APIs to edit lists here");
        } catch (java.lang.reflect.InvocationTargetException | ExecutionException error) {
            Throwable cause = error.getCause();
            while (cause instanceof CompletionException && cause.getCause() != null) cause = cause.getCause();
            if (cause instanceof IllegalArgumentException) throw new BridgeFailure(400, "Invalid TSA list entry");
            throw new BridgeFailure(503, "TSA list operation could not be confirmed; reload before retrying");
        } catch (TimeoutException error) {
            throw new BridgeFailure(504, "TSA list request timed out; reload before retrying");
        }
    }
    private static String filenameKey(String name) {
        return java.text.Normalizer.normalize(name, java.text.Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }
    static JsonObject names(JsonArray hashes) throws Exception {
        if (hashes == null || hashes.size() > 50) throw new IllegalArgumentException("At most 50 hashes per lookup");
        Set<String> normalized = new LinkedHashSet<>();
        for (JsonElement value : hashes) {
            if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()
                    || !value.getAsString().matches("[a-fA-F0-9]{64}")) throw new IllegalArgumentException("Invalid SHA-256 hash");
            normalized.add(value.getAsString().toLowerCase(Locale.ROOT));
        }
        try {
            Class<?> api = Class.forName("com.zaremate.tsa_anticheat.api.TsaAnticheatAPI");
            var method = api.getMethod("lookupHashAsync", String.class);
            Map<String, CompletableFuture<?>> reads = new LinkedHashMap<>();
            for (String hash : normalized) reads.put(hash, (CompletableFuture<?>) method.invoke(null, hash));
            await(CompletableFuture.allOf(reads.values().toArray(CompletableFuture[]::new)));
            JsonObject names = new JsonObject();
            for (var entry : reads.entrySet()) names.add(entry.getKey(), GSON.toJsonTree(entry.getValue().join()));
            JsonObject result = new JsonObject(); result.add("names", names); return result;
        } catch (ClassNotFoundException | NoSuchMethodException error) {
            throw new BridgeFailure(409, "Update TSA to use persistent hash filename lookup");
        } catch (java.lang.reflect.InvocationTargetException | ExecutionException error) {
            throw new BridgeFailure(503, "TSA filename lookup is unavailable");
        } catch (TimeoutException error) { throw new BridgeFailure(504, "TSA filename lookup timed out"); }
    }

    static JsonObject unlisted() throws Exception {
        try {
            Class<?> api = Class.forName("com.zaremate.tsa_anticheat.api.TsaAnticheatAPI");
            Map<?, ?> inventories = (Map<?, ?>) api.getMethod("getInventories").invoke(null);
            Map<?, ?> settings = (Map<?, ?>) await(api.getMethod("getSettingsAsync").invoke(null));
            Set<String> configAllowed = new HashSet<>();
            for (var setting : settings.entrySet()) {
                if (((Enum<?>) setting.getKey()).name().equals("RAY_FILENAME_ALLOWLIST"))
                    for (Object name : (Collection<?>) setting.getValue()) configAllowed.add(filenameKey(name.toString()));
            }
            Map<String, JsonObject> grouped = new LinkedHashMap<>();
            for (var player : inventories.entrySet()) {
                Set<String> seen = new HashSet<>();
                Object snapshot = player.getValue();
                Collection<?> files = (Collection<?>) snapshot.getClass().getMethod("files").invoke(snapshot);
                for (Object file : files) {
                    Class<?> entryType = file.getClass();
                    String hash = (String) entryType.getMethod("hash").invoke(file);
                    String name = (String) entryType.getMethod("name").invoke(file);
                    String type = (String) entryType.getMethod("type").invoke(file);
                    if (configAllowed.contains(filenameKey(name))) continue;
                    String key = type + "\t" + name + "\t" + hash;
                    if (!seen.add(key)) continue;
                    JsonObject row = grouped.get(key);
                    if (row == null) {
                        row = new JsonObject(); row.addProperty("hash", hash); row.addProperty("filename", name);
                        row.addProperty("type", type); row.addProperty("playerCount", 0); grouped.put(key, row);
                    }
                    row.addProperty("playerCount", row.get("playerCount").getAsInt() + 1);
                }
            }
            JsonObject result = new JsonObject(); result.add("entries", GSON.toJsonTree(grouped.values()));
            result.addProperty("playersScanned", inventories.size()); return result;
        } catch (ClassNotFoundException | NoSuchMethodException error) {
            throw new BridgeFailure(409, "Update TSA to read scanned inventories");
        } catch (java.lang.reflect.InvocationTargetException | ExecutionException error) {
            throw new BridgeFailure(503, "TSA inventories are unavailable");
        } catch (TimeoutException error) {
            throw new BridgeFailure(504, "TSA inventories request timed out");
        }
    }
    private static Object await(Object result) throws Exception {
        return ((CompletableFuture<?>) result).get(15, TimeUnit.SECONDS);
    }
}
