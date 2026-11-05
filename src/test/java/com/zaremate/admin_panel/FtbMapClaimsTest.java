package com.zaremate.admin_panel;

import com.google.gson.*;
import java.util.*;

final class FtbMapClaimsTest {
 static int run() {
  List<FtbMapClaims.Claim> source=new ArrayList<>();
  source.add(new FtbMapClaims.Claim(-1,2,"team-a","Builders",0x123456,true));
  source.add(new FtbMapClaims.Claim(0,2,"team-a","Builders",0x123456,false));
  source.add(new FtbMapClaims.Claim(3,-4,"team-b","Other",0,false));
  FtbMapClaims.Snapshot snapshot=new FtbMapClaims.Snapshot(true,"",source,false);source.clear();
  JsonObject result=FtbMapClaims.json(snapshot);JsonArray teams=result.getAsJsonArray("teams");
  if(!result.get("available").getAsBoolean()||teams.size()!=2)throw new AssertionError("Claims grouped by team");
  JsonObject first=teams.get(0).getAsJsonObject();
  if(!first.get("color").getAsString().equals("#123456")||first.getAsJsonArray("chunks").size()!=2)
   throw new AssertionError("Team colors and chunks preserved");
  JsonObject chunk=first.getAsJsonArray("chunks").get(0).getAsJsonObject();
  if(chunk.get("x").getAsInt()!=-1||chunk.get("z").getAsInt()!=2||!chunk.get("forceLoaded").getAsBoolean())
   throw new AssertionError("Negative chunk coordinates and force-loading must survive capture");
  if(!teams.get(1).getAsJsonObject().get("color").getAsString().equals("#000000"))throw new AssertionError("Black is a valid team color");
  JsonObject absent=FtbMapClaims.json(new FtbMapClaims.Snapshot(false,"Not installed",List.of(),false));
  if(absent.get("available").getAsBoolean()||!absent.getAsJsonArray("teams").isEmpty())throw new AssertionError("Optional integration unavailable");
  return 5;
 }
}
