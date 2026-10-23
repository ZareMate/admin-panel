package com.zaremate.admin_panel;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;

final class BridgeBatchesTest {
    static int run() {
        JsonObject value=new JsonObject();value.addProperty("text","a".repeat(8182)+"😀漢字\\\"\n".repeat(30000));
        String json=value.toString();var frames=BridgeBatches.frames(json);StringBuilder assembled=new StringBuilder();
        if(frames.size()<2)throw new AssertionError("Must batch large messages");
        String id=null;int index=0;
        for(String text:frames){
            if(text.getBytes(StandardCharsets.UTF_8).length>=65536)throw new AssertionError("Frame exceeds wire bound");
            JsonObject frame=JsonParser.parseString(text).getAsJsonObject();
            if(id==null)id=frame.get("id").getAsString();
            if(!id.equals(frame.get("id").getAsString())||frame.get("index").getAsInt()!=index++||frame.get("total").getAsInt()!=frames.size())throw new AssertionError("Frame sequence");
            String chunk=frame.get("data").getAsString();
            if(Character.isHighSurrogate(chunk.charAt(chunk.length()-1))||Character.isLowSurrogate(chunk.charAt(0)))throw new AssertionError("Split surrogate");
            assembled.append(chunk);
        }
        if(!json.equals(assembled.toString()))throw new AssertionError("Lossless reassembly");
        if(!BridgeBatches.frames("{}").equals(java.util.List.of("{}")))throw new AssertionError("Small message");
        try{BridgeBatches.frames("x".repeat(BridgeBatches.MAX_BYTES+1));throw new AssertionError("Missing aggregate bound");}catch(IllegalArgumentException expected){}
        return 6;
    }
}
