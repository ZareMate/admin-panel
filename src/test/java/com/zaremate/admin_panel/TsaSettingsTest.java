package com.zaremate.admin_panel;
import com.google.gson.*;
final class TsaSettingsTest {
 static int run() throws Exception {
  int checks=0;
  JsonObject snapshot=TsaSettings.access(null);
  if(snapshot.toString().contains("private-secret"))throw new AssertionError("Webhook leaked");checks++;
  for(String input:java.util.List.of("1.5","2147483648","true","\"5\"")) {
   try {TsaSettings.convert(Integer.class,JsonParser.parseString(input));throw new AssertionError("Invalid integer accepted");}
   catch(IllegalArgumentException expected){checks++;}
  }
  if(!TsaSettings.convert(java.util.List.class,JsonParser.parseString("[\"one\",\"two\"]")).equals(java.util.List.of("one","two")))throw new AssertionError("List conversion");checks++;
  JsonObject update=new JsonObject();update.addProperty("setting","LOGIN_CHECK_DELAY_SECONDS");update.addProperty("value",25);
  snapshot=TsaSettings.access(update);
  boolean found=false;
  for(JsonElement row:snapshot.getAsJsonArray("settings"))if(row.getAsJsonObject().get("key").getAsString().equals("LOGIN_CHECK_DELAY_SECONDS"))found=row.getAsJsonObject().get("value").getAsInt()==25;
  if(!found)throw new AssertionError("Update did not use API");checks++;
  update.addProperty("value",301);
  try{TsaSettings.access(update);throw new AssertionError("Out of range accepted");}catch(BridgeFailure expected){if(expected.status!=400)throw expected;checks++;}
  update.addProperty("setting","NOT_A_SETTING");
  try{TsaSettings.access(update);throw new AssertionError("Unknown setting accepted");}catch(IllegalArgumentException expected){checks++;}
  return checks;
 }
}
