package com.zaremate.admin_panel;

import com.google.gson.*;
import java.text.Normalizer;
import java.util.*;
import java.util.regex.*;

/** Per-player TSA cheat categories, deduplicated across repeated detections.
 *  Computed on the bridge worker; callers receive category sets without identities.
 */
final class TsaStatistics {
    private static final Pattern FILE = Pattern.compile("\\| DETECTED \\| (?:MOD|RESOURCE_PACK) (.+?) \\[([0-9a-fA-F]{64})\\]$");
    private TsaStatistics() {}

    static JsonObject summarize(Set<UUID> knownPlayers, Map<UUID,JsonObject> reports, List<String> keywords) {
        JsonObject result=new JsonObject();
        result.addProperty("totalPlayers",knownPlayers.size());
        JsonArray players=new JsonArray();
        Set<String> uniqueTypes=new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        for(UUID uuid:knownPlayers) {
            JsonObject report=reports.get(uuid);
            if(report==null)continue;
            Set<String> types=categories(report,keywords);
            if(types.isEmpty())continue;
            JsonArray labels=new JsonArray();
            for(String type:types){labels.add(type);uniqueTypes.add(type);}
            JsonObject entry=new JsonObject();entry.add("types",labels);players.add(entry);
        }
        result.add("players",players);
        JsonArray available=new JsonArray();
        uniqueTypes.forEach(available::add);
        result.add("types",available);
        return result;
    }

    static Set<String> categories(JsonObject report,List<String> keywords) {
        Set<String> types=new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        if(report.has("packetModified")&&!report.get("packetModified").isJsonNull()
                && report.get("packetModified").getAsLong()>0)types.add("Modified packets");
        JsonArray detections=report.getAsJsonArray("detections");
        if(detections==null)return types;
        for(JsonElement item:detections) {
            if(!item.isJsonPrimitive()||!item.getAsJsonPrimitive().isString())continue;
            Matcher matcher=FILE.matcher(item.getAsString());
            if(!matcher.find())continue;
            String filename=normalize(matcher.group(1));
            String label="Other detected files";
            for(String keyword:keywords) {
                String key=normalize(keyword);
                if(key.isEmpty()||!filename.contains(key))continue;
                label=labelFor(key);
                break; // TSA uses first configured filename keyword.
            }
            types.add(label);
        }
        return types;
    }

    private static String normalize(String value) {
        return Normalizer.normalize(value,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]","");
    }
    private static String labelFor(String keyword) {
        if(keyword.equals("ray")||keyword.equals("xray"))return "Xray";
        if(keyword.equals("esp"))return "ESP";
        return keyword.substring(0,1).toUpperCase(Locale.ROOT)+keyword.substring(1);
    }

    /** Read TSA's live keyword order; if TSA is unavailable, file detections remain Other. */
    @SuppressWarnings("unchecked")
    static List<String> configuredKeywords() {
        try {
            Class<?> config=Class.forName("com.zaremate.tsa_anticheat.TsaAnticheatConfig");
            Object value=config.getMethod("filenameDetectionKeywords").invoke(null);
            if(value instanceof List<?> list)return list.stream().filter(String.class::isInstance)
                    .map(String.class::cast).toList();
        }catch(ReflectiveOperationException | LinkageError ignored){}
        return List.of();
    }
}
