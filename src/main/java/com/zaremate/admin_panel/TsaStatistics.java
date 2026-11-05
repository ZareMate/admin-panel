package com.zaremate.admin_panel;

import com.google.gson.*;
import java.util.*;
import java.util.regex.*;

/** Per-player TSA cheat categories, deduplicated across repeated detections.
 *  Computed on the bridge worker; callers receive category sets without identities.
 */
final class TsaStatistics {
    private static final Pattern FILE = Pattern.compile("\\| DETECTED \\| (?:MOD|RESOURCE_PACK) (.+?) \\[([0-9a-fA-F]{64})\\]$");
    private TsaStatistics() {}

    static JsonObject summarize(Set<UUID> knownPlayers, Map<UUID,JsonObject> reports, List<String> keywords, List<String> allowedNames) {
        JsonObject result=new JsonObject();
        result.addProperty("totalPlayers",knownPlayers.size());
        JsonArray players=new JsonArray();
        long timeouts=0,modified=0,other=0;
        Map<String,Map<String,JsonObject>> breakdown=new TreeMap<>();
        for(UUID uuid:knownPlayers) {
            JsonObject report=reports.get(uuid);
            if(report==null)continue;
            long checks=count(report,"packetChecks"),passes=count(report,"packetPasses");
            long reportTimeouts=count(report,"packetTimeout"),reportModified=count(report,"packetModified");
            timeouts+=reportTimeouts>0?1:0;modified+=reportModified>0?1:0;
            other+=checks-passes-reportTimeouts-reportModified>0?1:0;
            Map<String,DetectedFile> files=files(report,keywords,allowedNames);
            Map<String,Integer> categoryCounts=new TreeMap<>();
            for(var file:files.entrySet()) {
                DetectedFile detected=file.getValue();
                categoryCounts.merge(detected.category(),1,Integer::sum);
                JsonObject row=breakdown.computeIfAbsent(detected.category(),key->new TreeMap<>())
                        .computeIfAbsent(file.getKey(),hash->{
                            JsonObject value=new JsonObject();value.addProperty("hash",hash);
                            value.add("names",new JsonArray());value.addProperty("players",0);return value;
                        });
                row.addProperty("players",row.get("players").getAsInt()+1);
                JsonArray names=row.getAsJsonArray("names");
                for(String name:detected.names())if(!names.contains(new JsonPrimitive(name)))names.add(name);
            }
            Set<String> types=categoryCounts.keySet();
            if(types.isEmpty())continue;
            JsonArray labels=new JsonArray();
            for(String type:types){labels.add(type);}
            JsonObject entry=new JsonObject();entry.add("types",labels);
            JsonObject counts=new JsonObject();categoryCounts.forEach(counts::addProperty);
            entry.add("fileCounts",counts);players.add(entry);
        }
        result.add("players",players);
        JsonObject fileBreakdown=new JsonObject();
        breakdown.forEach((category,files)->{
            JsonArray entries=new JsonArray();
            files.values().stream().sorted(Comparator.<JsonObject>comparingInt(row->row.get("players").getAsInt())
                    .reversed().thenComparing(row->row.get("hash").getAsString())).forEach(entries::add);
            fileBreakdown.add(category,entries);
        });
        result.add("fileBreakdown",fileBreakdown);
        JsonObject errors=new JsonObject();
        errors.addProperty("timeouts",timeouts);errors.addProperty("modified",modified);errors.addProperty("other",other);
        result.add("packetErrors",errors);
        JsonArray available=new JsonArray();
        Set<String> availableTypes=new LinkedHashSet<>();
        keywords.stream().map(TsaStatistics::normalize).filter(key->!key.isEmpty()).forEach(availableTypes::add);
        availableTypes.add("Other detected files");
        availableTypes.forEach(available::add);
        result.add("types",available);
        return result;
    }

    private static long count(JsonObject report,String key) {
        return report.has(key)&&!report.get(key).isJsonNull()?Math.max(0,report.get(key).getAsLong()):0;
    }

    private static String normalize(String name) {
        return java.text.Normalizer.normalize(name,java.text.Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]","");
    }

    static JsonObject build(Set<UUID> knownPlayers,Map<UUID,JsonObject> reports) throws Exception {
        List<String> keywords=new ArrayList<>(),allowed=new ArrayList<>();
        try {
            for(JsonElement entry:TsaSettings.access(null).getAsJsonArray("settings")) {
                JsonObject row=entry.getAsJsonObject();
                String key=row.get("key").getAsString();
                if(key.equals("FILENAME_DETECTION_KEYWORDS")||key.equals("RAY_FILENAME_ALLOWLIST"))
                    for(JsonElement value:row.getAsJsonArray("value"))
                        (key.equals("FILENAME_DETECTION_KEYWORDS")?keywords:allowed).add(value.getAsString());
            }
            for(JsonElement name:TsaLists.access(null).getAsJsonObject("lists").getAsJsonArray("FILENAMES"))
                allowed.add(name.getAsString());
        } catch(BridgeFailure error) {
            if(error.status!=409)throw error;
        }
        return summarize(knownPlayers,reports,keywords,allowed);
    }

    static Set<String> categories(JsonObject report,List<String> keywords,List<String> allowedNames) {
        return fileCounts(report,keywords,allowedNames).keySet();
    }

    private static Map<String,Integer> fileCounts(JsonObject report,List<String> keywords,List<String> allowedNames) {
        Map<String,Integer> counts=new TreeMap<>();
        files(report,keywords,allowedNames).values().forEach(file->counts.merge(file.category(),1,Integer::sum));
        return counts;
    }

    private record DetectedFile(String category,Set<String> names) {}

    private static Map<String,DetectedFile> files(JsonObject report,List<String> keywords,List<String> allowedNames) {
        Map<String,DetectedFile> hashes=new LinkedHashMap<>();
        List<String> orderedKeywords=keywords.stream().map(TsaStatistics::normalize).filter(key->!key.isEmpty())
                .sorted(Comparator.comparingInt(String::length).reversed()).toList();
        JsonArray detections=report.getAsJsonArray("detections");
        if(detections==null)return hashes;
        for(JsonElement item:detections) {
            if(!item.isJsonPrimitive()||!item.getAsJsonPrimitive().isString())continue;
            Matcher matcher=FILE.matcher(item.getAsString());
            if(!matcher.find())continue;
            String filename=normalize(matcher.group(1));
            String label="Other detected files";
            if(allowedNames.stream().map(TsaStatistics::normalize).noneMatch(filename::equals)) {
                for(String key:orderedKeywords) {
                    if(!key.isEmpty()&&filename.contains(key)){label=key;break;}
                }
            }
            String hash=matcher.group(2).toLowerCase(Locale.ROOT);
            DetectedFile detected=hashes.get(hash);
            if(detected==null){detected=new DetectedFile(label,new TreeSet<>());hashes.put(hash,detected);}
            int rank=orderedKeywords.indexOf(label),previousRank=orderedKeywords.indexOf(detected.category());
            if(rank>=0&&(previousRank<0||rank<previousRank)) {
                detected=new DetectedFile(label,detected.names());hashes.put(hash,detected);
            }
            detected.names().add(matcher.group(1));
        }
        return hashes;
    }

}
