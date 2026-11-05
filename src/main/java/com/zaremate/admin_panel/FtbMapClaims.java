package com.zaremate.admin_panel;

import com.google.gson.*;
import java.util.*;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceKey;

/** Optional FTB Chunks API adapter. Capture on the server thread; serialize on the worker. */
final class FtbMapClaims {
    record Claim(int x,int z,String teamId,String name,int color,boolean forceLoaded) {}
    record Snapshot(boolean available,String reason,List<Claim> claims,boolean truncated) {
        Snapshot { claims=List.copyOf(claims); }
    }
    private record TeamInfo(String id,String name,int color) {}
    static Snapshot capture(String dimension) {
        try {
            Class<?> api=Class.forName("dev.ftb.mods.ftbchunks.api.FTBChunksAPI");
            Object instance=api.getMethod("api").invoke(null);
            Class<?> apiType=Class.forName("dev.ftb.mods.ftbchunks.api.FTBChunksAPI$API");
            if(!Boolean.TRUE.equals(apiType.getMethod("isManagerLoaded").invoke(instance)))
                return new Snapshot(false,"FTB Chunks claims are not loaded yet",List.of(),false);
            Object manager=apiType.getMethod("getManager").invoke(instance);
            Class<?> managerType=Class.forName("dev.ftb.mods.ftbchunks.api.ClaimedChunkManager");
            Class<?> claimType=Class.forName("dev.ftb.mods.ftbchunks.api.ClaimedChunk");
            Class<?> dataType=Class.forName("dev.ftb.mods.ftbchunks.api.ChunkTeamData");
            Class<?> posType=Class.forName("dev.ftb.mods.ftblibrary.math.ChunkDimPos");
            Class<?> teamType=Class.forName("dev.ftb.mods.ftbteams.api.Team");
            Class<?> propertyType=Class.forName("dev.ftb.mods.ftbteams.api.property.TeamProperty");
            Object colorProperty=Class.forName("dev.ftb.mods.ftbteams.api.property.TeamProperties").getField("COLOR").get(null);
            Class<?> colorType=Class.forName("dev.ftb.mods.ftblibrary.icon.Color4I");
            var getPos=claimType.getMethod("getPos");var getData=claimType.getMethod("getTeamData");
            var getTeam=dataType.getMethod("getTeam");var getId=teamType.getMethod("getId");
            var getName=teamType.getMethod("getName");var getProperty=teamType.getMethod("getProperty",propertyType);
            var rgb=colorType.getMethod("rgb");var getX=posType.getMethod("x");var getZ=posType.getMethod("z");
            var getDimension=posType.getMethod("dimension");var isForceLoaded=claimType.getMethod("isForceLoaded");
            Map<String,TeamInfo> teams=new HashMap<>();List<Claim> claims=new ArrayList<>();
            for(Object claim:(Collection<?>)managerType.getMethod("getAllClaimedChunks").invoke(manager)) {
                Object pos=getPos.invoke(claim);
                ResourceKey<?> key=(ResourceKey<?>)getDimension.invoke(pos);
                if(!key.location().toString().equals(dimension))continue;
                if(claims.size()>=100000)return new Snapshot(true,"",claims,true);
                Object data=getData.invoke(claim);
                Object team=getTeam.invoke(data);
                String id=getId.invoke(team).toString();
                TeamInfo info=teams.get(id);
                if(info==null) {
                    String name=((Component)getName.invoke(team)).getString();
                    Object color=getProperty.invoke(team,colorProperty);
                    info=new TeamInfo(id,name,((Number)rgb.invoke(color)).intValue()&0xFFFFFF);teams.put(id,info);
                }
                claims.add(new Claim(((Number)getX.invoke(pos)).intValue(),
                        ((Number)getZ.invoke(pos)).intValue(),info.id(),info.name(),info.color(),
                        Boolean.TRUE.equals(isForceLoaded.invoke(claim))));
            }
            return new Snapshot(true,"",claims,false);
        }catch(ClassNotFoundException error) {return new Snapshot(false,"FTB Chunks and FTB Teams are required to show claims",List.of(),false);}
        catch(ReflectiveOperationException|LinkageError|RuntimeException error) {
            return new Snapshot(false,"FTB Chunks claims could not be read; check the installed FTB Chunks and Teams versions",List.of(),false);
        }
    }
    static JsonObject json(Snapshot snapshot) {
        JsonObject result=new JsonObject();result.addProperty("available",snapshot.available());
        result.addProperty("reason",snapshot.reason());result.addProperty("truncated",snapshot.truncated());
        Map<String,JsonObject> grouped=new TreeMap<>();
        for(Claim claim:snapshot.claims()) {
            JsonObject team=grouped.computeIfAbsent(claim.teamId(),id->{
                JsonObject value=new JsonObject();value.addProperty("id",id);value.addProperty("name",claim.name());
                value.addProperty("color",String.format(Locale.ROOT,"#%06x",claim.color()&0xFFFFFF));
                value.add("chunks",new JsonArray());return value;
            });
            JsonObject chunk=new JsonObject();chunk.addProperty("x",claim.x());chunk.addProperty("z",claim.z());
            chunk.addProperty("forceLoaded",claim.forceLoaded());team.getAsJsonArray("chunks").add(chunk);
        }
        JsonArray teams=new JsonArray();grouped.values().forEach(teams::add);result.add("teams",teams);return result;
    }
}
