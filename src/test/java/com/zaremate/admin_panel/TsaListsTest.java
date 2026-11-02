package com.zaremate.admin_panel;
import com.google.gson.*;
final class TsaListsTest {
 static int run() throws Exception {
  int checks=0;String hash="a".repeat(64);
  for(String list:java.util.List.of("ALLOWED","BLACKLISTED","ENFORCEMENT","FILENAMES")) {
   JsonObject update=new JsonObject();update.addProperty("list",list);update.addProperty("action","add");update.addProperty("hash",hash);update.addProperty("name","example.jar");update.addProperty("type","MOD");
   var result=TsaLists.access(update);
   if(!result.get("changed").getAsBoolean()||result.getAsJsonObject("lists").getAsJsonArray(list).size()!=1)throw new AssertionError("List add "+list);checks++;
   if(TsaLists.access(update).get("changed").getAsBoolean())throw new AssertionError("Duplicate add");checks++;
   update.addProperty("action","remove");
   if(!TsaLists.access(update).get("changed").getAsBoolean())throw new AssertionError("Remove "+list);checks++;
   if(TsaLists.access(update).get("changed").getAsBoolean())throw new AssertionError("Duplicate remove");checks++;
  }
  JsonObject update=new JsonObject();update.addProperty("list","BLACKLISTED");update.addProperty("action","add");update.addProperty("hash",hash);
  var lists=TsaLists.access(update).getAsJsonObject("lists");
  if(lists.getAsJsonArray("ALLOWED").size()!=0||lists.getAsJsonArray("BLACKLISTED").size()!=1||lists.getAsJsonArray("ENFORCEMENT").size()!=0)throw new AssertionError("Lists not independent");checks++;
  update.addProperty("hash","invalid");
  try{TsaLists.access(update);throw new AssertionError("Invalid hash accepted");}catch(BridgeFailure expected){if(expected.status!=400)throw expected;checks++;}
  update.addProperty("list","INVALID");
  try{TsaLists.access(update);throw new AssertionError("Invalid list accepted");}catch(IllegalArgumentException expected){checks++;}
  if(TsaLists.access(null).getAsJsonObject("lists").has("GENERATED"))throw new AssertionError("Generated history exposed");checks++;
  var batch=new JsonArray();batch.add(hash);batch.add(hash.toUpperCase());
  if(TsaLists.names(batch).getAsJsonObject("names").size()!=1)throw new AssertionError("Batch lookup deduplication");checks++;
  batch.add("invalid");try{TsaLists.names(batch);throw new AssertionError("Invalid batch hash accepted");}catch(IllegalArgumentException expected){checks++;}
  var inventory=TsaLists.unlisted();
  if(inventory.get("playersScanned").getAsInt()!=1||!inventory.getAsJsonArray("entries").get(0).getAsJsonObject().get("filename").getAsString().equals("unlisted.jar"))throw new AssertionError("Unlisted API adapter");checks++;
  return checks;
 }
}
