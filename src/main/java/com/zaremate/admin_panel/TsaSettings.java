package com.zaremate.admin_panel;

import com.google.gson.*;
import java.util.*;
import java.util.concurrent.*;

/** Optional TSA management API adapter. Invoked exclusively by the bridge worker. */
final class TsaSettings {
    private static final Gson GSON = new Gson();
    private TsaSettings() {}

    static JsonObject access(JsonObject update) throws Exception {
        final Class<?> api, setting;
        try {
            api = Class.forName("com.zaremate.tsa_anticheat.api.TsaAnticheatAPI");
            setting = Class.forName("com.zaremate.tsa_anticheat.api.TsaSetting");
        } catch (ClassNotFoundException error) {
            throw new BridgeFailure(409, "Install TSA with the settings management API to configure it here");
        }
        try {
            if (update != null) {
                String key = RequestFields.string(update, "setting", 80);
                Object selected = Arrays.stream(setting.getEnumConstants())
                        .filter(value -> ((Enum<?>) value).name().equals(key)).findFirst()
                        .orElseThrow(() -> new IllegalArgumentException("Unknown TSA setting"));
                Class<?> type = (Class<?>) setting.getMethod("valueType").invoke(selected);
                JsonElement value = update.get("value");
                Object converted = convert(type, value);
                setting.getMethod("validate", Object.class).invoke(selected, converted);
                await(api.getMethod("setSettingAsync", setting, Object.class).invoke(null, selected, converted));
            }
            Map<?, ?> values = (Map<?, ?>) await(api.getMethod("getSettingsAsync").invoke(null));
            JsonArray rows = new JsonArray();
            for (var entry : values.entrySet()) {
                String key = ((Enum<?>) entry.getKey()).name();
                Class<?> type = (Class<?>) setting.getMethod("valueType").invoke(entry.getKey());
                JsonObject row = new JsonObject();
                row.addProperty("key", key);
                row.addProperty("type", type == Boolean.class ? "boolean" : type == Integer.class ? "integer" : type == List.class ? "list" : "string");
                boolean secret = key.equals("WEBHOOK_URL");
                row.addProperty("secret", secret);
                if (secret) row.addProperty("configured", !String.valueOf(entry.getValue()).isBlank());
                else row.add("value", GSON.toJsonTree(entry.getValue()));
                rows.add(row);
            }
            JsonObject result = new JsonObject(); result.add("settings", rows); return result;
        } catch (NoSuchMethodException error) {
            throw new BridgeFailure(409, "Update TSA to a version with the settings management API");
        } catch (java.lang.reflect.InvocationTargetException | ExecutionException error) {
            Throwable cause = error.getCause();
            while (cause instanceof CompletionException && cause.getCause() != null) cause = cause.getCause();
            if (cause instanceof IllegalArgumentException) throw new BridgeFailure(400, "Invalid TSA setting value");
            throw new BridgeFailure(503, "TSA settings could not be applied or read; refresh to check the current value");
        } catch (TimeoutException error) {
            throw new BridgeFailure(504, "TSA settings request timed out; refresh before retrying");
        }
    }

    private static Object await(Object result) throws Exception {
        return ((CompletableFuture<?>) result).get(15, TimeUnit.SECONDS);
    }

    static Object convert(Class<?> type, JsonElement value) {
        if (value != null && !value.isJsonNull()) {
            if (type == List.class && value.isJsonArray()) {
                List<String> entries = new ArrayList<>();
                for (JsonElement item : value.getAsJsonArray()) {
                    if (!item.isJsonPrimitive() || !item.getAsJsonPrimitive().isString()) throw new IllegalArgumentException("Expected strings");
                    entries.add(item.getAsString());
                }
                return entries;
            }
            if (value.isJsonPrimitive()) {
                JsonPrimitive primitive = value.getAsJsonPrimitive();
                if (type == Boolean.class && primitive.isBoolean()) return primitive.getAsBoolean();
                if (type == String.class && primitive.isString()) return primitive.getAsString();
                if (type == Integer.class && primitive.isNumber()) {
                    try { return primitive.getAsBigDecimal().intValueExact(); }
                    catch (ArithmeticException error) { throw new IllegalArgumentException("Expected a whole number"); }
                }
            }
        }
        throw new IllegalArgumentException("Invalid TSA setting type");
    }
}
