package com.zaremate.admin_panel;

import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Each chunk is a complete WS message, rather than fragments of a huge WS message. */
final class BridgeBatches {
    static final int CHUNK_CHARS = 8192;
    static final int MAX_BYTES = 32 * 1024 * 1024;
    static List<String> frames(String text) {
        if (text.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IllegalArgumentException("Message exceeds 32 MiB transfer limit");
        if (text.length() <= CHUNK_CHARS) return List.of(text);
        List<String> chunks = new ArrayList<>();
        for (int start=0; start<text.length();) {
            int end=Math.min(start+CHUNK_CHARS,text.length());
            if(end<text.length() && Character.isHighSurrogate(text.charAt(end-1)))end--;
            chunks.add(text.substring(start,end));start=end;
        }
        String id=UUID.randomUUID().toString();
        List<String> frames=new ArrayList<>(chunks.size());
        for(int index=0;index<chunks.size();index++){
            JsonObject frame=new JsonObject();frame.addProperty("batch",1);frame.addProperty("id",id);
            frame.addProperty("index",index);frame.addProperty("total",chunks.size());frame.addProperty("data",chunks.get(index));
            frames.add(frame.toString());
        }
        return frames;
    }
}
