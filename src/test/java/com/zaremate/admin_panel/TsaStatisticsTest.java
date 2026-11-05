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
  JsonObject stats=TsaStatistics.summarize(known,rows,List.of("ray","esp"));
  if(stats.get("totalPlayers").getAsInt()!=10)throw new AssertionError("Must count known players");
  if(stats.getAsJsonArray("players").size()!=3)throw new AssertionError("Must count 3 detected players");
  Map<String,Integer> counts=new HashMap<>();
  for(JsonElement player:stats.getAsJsonArray("players"))
   for(JsonElement type:player.getAsJsonObject().getAsJsonArray("types"))
    counts.merge(type.getAsString(),1,Integer::sum);
  if(!counts.equals(Map.of("Xray",2,"ESP",1)))throw new AssertionError("Unexpected type counts "+counts);
  checks+=3;
  JsonObject overlap=record("2026-11-04 | DETECTED | MOD xray.jar ["+"a".repeat(64)+"]",
      "2026-11-04 | DETECTED | MOD esp.jar ["+"b".repeat(64)+"]");
  if(TsaStatistics.categories(overlap,List.of("esp","ray")).size()!=2)throw new AssertionError("Overlapping types");
  checks++;
  overlap.addProperty("packetModified",3);
  if(!TsaStatistics.categories(overlap,List.of("esp","ray")).contains("Modified packets"))
   throw new AssertionError("Modified packet category missing");
  checks++;
  if(!TsaStatistics.categories(record("2026-11-04 | DETECTED | MOD unknown.jar ["+"e".repeat(64)+"]"),List.of("esp","ray"))
      .contains("Other detected files"))throw new AssertionError("Unrecognized detections must stay visible");
  checks++;
  return checks;
 }
 private static JsonObject record(String...entries){
  JsonObject row=new JsonObject();row.addProperty("packetModified",0);
  JsonArray detections=new JsonArray();for(String item:entries)detections.add(item);row.add("detections",detections);return row;
 }
}
