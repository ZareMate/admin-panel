package com.zaremate.admin_panel;

import com.google.gson.*;
import java.util.*;

final class TsaStatisticsTest {
 static int run() {
  int checks=0;
  UUID a=UUID.randomUUID(),b=UUID.randomUUID(),c=UUID.randomUUID();
  Set<UUID> known=new LinkedHashSet<>(List.of(a,b,c,UUID.randomUUID(),UUID.randomUUID(),
      UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID()));
  Map<UUID,JsonObject> rows=new HashMap<>();
  rows.put(a,record("2026-11-04 | DETECTED | MOD xray-client.jar ["+"a".repeat(64)+"]",
          "2026-11-04 | DETECTED | MOD xray-client.jar ["+"a".repeat(64)+"]"));
  rows.put(b,record("2026-11-04 | DETECTED | RESOURCE_PACK xray.zip ["+"b".repeat(64)+"]"));
  rows.put(c,record("2026-11-04 | DETECTED | MOD combatESP.jar ["+"c".repeat(64)+"]"));
  JsonObject stats=summarize(known,rows);
  if(stats.get("totalPlayers").getAsInt()!=10)throw new AssertionError("Must count known players");
  if(stats.getAsJsonArray("players").size()!=3)throw new AssertionError("Must count 3 detected players");
  Map<String,Integer> counts=new HashMap<>();
  for(JsonElement player:stats.getAsJsonArray("players"))
   for(JsonElement type:player.getAsJsonObject().getAsJsonArray("types"))
    counts.merge(type.getAsString(),1,Integer::sum);
  if(!counts.equals(Map.of("ray",2,"esp",1)))throw new AssertionError("Unexpected type counts "+counts);
  checks+=3;
  JsonObject overlap=record("2026-11-04 | DETECTED | MOD xray.jar ["+"a".repeat(64)+"]",
      "2026-11-04 | DETECTED | MOD esp.zip ["+"b".repeat(64)+"]");
  if(categories(overlap).size()!=2)throw new AssertionError("Overlapping types");
  checks++;
  overlap.addProperty("packetModified",3);
  if(categories(overlap).contains("Other detected files"))
   throw new AssertionError("Packet errors must not enter file categories");
  checks++;
  if(!categories(record("2026-11-04 | DETECTED | MOD unknown.dat ["+"e".repeat(64)+"]"))
      .contains("Other detected files"))throw new AssertionError("Unrecognized detections must stay visible");
  checks++;
  JsonObject disabled=record("2026-11-04 | DETECTED | MOD §aCLIENT.JAR.DISABLED ["+"a".repeat(64)+"]",
      "2026-11-04 | DETECTED | RESOURCE_PACK PACK.ZIP.disabled ["+"b".repeat(64)+"]");
  if(!categories(disabled).equals(Set.of("Other detected files")))throw new AssertionError("Unmatched names stay visible");
  checks++;
  JsonObject packetOnly=record();packetOnly.addProperty("packetChecks",12);packetOnly.addProperty("packetPasses",5);
  packetOnly.addProperty("packetTimeout",3);packetOnly.addProperty("packetModified",2);
  JsonObject packetStats=summarize(Set.of(a),Map.of(a,packetOnly));
  if(!packetStats.getAsJsonArray("players").isEmpty())throw new AssertionError("Packet-only reports are not file detections");
  JsonObject errors=packetStats.getAsJsonObject("packetErrors");
  if(errors.get("timeouts").getAsLong()!=1||errors.get("modified").getAsLong()!=1||errors.get("other").getAsLong()!=1)
   throw new AssertionError("Packet issues count once per player");
  checks+=2;
  JsonObject repeated=record();
  for(int i=0;i<100;i++)repeated.getAsJsonArray("detections").add("2026-11-04 | DETECTED | MOD repeated.jar ["+"a".repeat(64)+"]");
  repeated.getAsJsonArray("detections").add("2026-11-04 | DETECTED | MOD renamed.zip ["+"A".repeat(64)+"]");
  repeated.getAsJsonArray("detections").add("2026-11-04 | DETECTED | MOD distinct.jar ["+"b".repeat(64)+"]");
  repeated.addProperty("packetChecks",300);repeated.addProperty("packetTimeout",100);repeated.addProperty("packetModified",100);
  JsonObject dedup=summarize(Set.of(a,b),Map.of(a,repeated,b,repeated));
  for(JsonElement player:dedup.getAsJsonArray("players")) {
   JsonObject fileCounts=player.getAsJsonObject().getAsJsonObject("fileCounts");
   if(fileCounts.size()!=1||fileCounts.get("Other detected files").getAsInt()!=2)throw new AssertionError("Deduplicate hashes, including renamed and uppercase hashes");
  }
  JsonObject packetCounts=dedup.getAsJsonObject("packetErrors");
  for(String key:List.of("timeouts","modified","other"))
   if(packetCounts.get(key).getAsInt()!=2)throw new AssertionError("Repeated issues count once for each player");
  checks+=2;
  JsonObject named=record("2026-11-04 | DETECTED | MOD ＥＳＰ-x_ray.jar ["+"c".repeat(64)+"]");
  if(!TsaStatistics.categories(named,List.of("ray","esp"),List.of()).equals(Set.of("ray")))
   throw new AssertionError("Use configured keyword order and TSA normalization");
  if(!TsaStatistics.categories(named,List.of("esp","ray"),List.of()).equals(Set.of("esp")))
   throw new AssertionError("First configured keyword wins");
  if(!TsaStatistics.categories(named,List.of("esp"),List.of("esp x-ray.jar")).equals(Set.of("Other detected files")))
   throw new AssertionError("Allowed filenames must not receive a keyword category");
  checks+=3;
  JsonArray breakdown=dedup.getAsJsonObject("fileBreakdown").getAsJsonArray("Other detected files");
  if(breakdown.size()!=2)throw new AssertionError("One breakdown row per category/hash");
  JsonObject first=breakdown.get(0).getAsJsonObject();
  if(first.get("players").getAsInt()!=2||first.getAsJsonArray("names").size()!=2)
   throw new AssertionError("Breakdown must retain aliases and count each player once");
  if(!first.get("hash").getAsString().equals("a".repeat(64))||first.has("uuid"))
   throw new AssertionError("Breakdown exposes hashes without player identities");
  checks+=3;
  JsonObject ores=record("2026-11-04 | DETECTED | RESOURCE_PACK Glowing Ores Plus v19.0.0.zip ["+"d".repeat(64)+"]");
  if(!TsaStatistics.categories(ores,List.of("ore","ores"),List.of()).equals(Set.of("ores")))
   throw new AssertionError("Longer keyword must win regardless of configured order");
  if(!TsaStatistics.categories(ores,List.of("ores","ore"),List.of()).equals(Set.of("ores")))
   throw new AssertionError("Longest keyword selection must be stable");
  if(!TsaStatistics.categories(ores,List.of("ore","o-r-e-s"),List.of()).equals(Set.of("ores")))
   throw new AssertionError("Compare normalized keyword lengths");
  JsonObject aliases=record("2026-11-04 | DETECTED | MOD ore.jar ["+"d".repeat(64)+"]",
      "2026-11-04 | DETECTED | RESOURCE_PACK ores.zip ["+"d".repeat(64)+"]");
  if(!TsaStatistics.categories(aliases,List.of("ore","ores"),List.of()).equals(Set.of("ores")))
   throw new AssertionError("Use longest match across hash aliases without duplicating hash");
  checks+=4;
  return checks;
 }
 private static JsonObject summarize(Set<UUID> players,Map<UUID,JsonObject> reports) {
  return TsaStatistics.summarize(players,reports,List.of("ray","esp"),List.of());
 }
 private static Set<String> categories(JsonObject report) {
  return TsaStatistics.categories(report,List.of("ray","esp"),List.of());
 }
 private static JsonObject record(String...entries){
  JsonObject row=new JsonObject();row.addProperty("packetModified",0);
  JsonArray detections=new JsonArray();for(String item:entries)detections.add(item);row.add("detections",detections);return row;
 }
}
