package com.zaremate.admin_panel;
import com.google.gson.*;
import java.util.*;
import java.nio.charset.StandardCharsets;
import java.awt.image.BufferedImage;
import java.io.*;
import javax.imageio.ImageIO;

public final class ItemIconsTest {
    static int checks;
    static void check(boolean ok,String label){checks++;if(!ok)throw new AssertionError(label);}
    static Map<String,byte[]> assets() throws Exception {
        Map<String,byte[]> assets=new HashMap<>();
        model(assets,"test:gem","{\"parent\":\"minecraft:item/generated\",\"textures\":{\"layer0\":\"test:item/gem\"}}");
        BufferedImage png=new BufferedImage(16,32,BufferedImage.TYPE_INT_ARGB);
        for(int y=0;y<32;y++)for(int x=0;x<16;x++)png.setRGB(x,y,y<16?0xffff0000:0xff0000ff);
        var out=new ByteArrayOutputStream();ImageIO.write(png,"PNG",out);assets.put("assets/test/textures/item/gem.png",out.toByteArray());
        return assets;
    }
    static void model(Map<String,byte[]> a,String id,String json){String[] parts=id.split(":");a.put("assets/"+parts[0]+"/models/item/"+parts[1]+".json",json.getBytes(StandardCharsets.UTF_8));}
    public static void main(String[] args)throws Exception {
        var assets=assets();var resolver=new ItemIcons(assets::get);
        String icon=resolver.icon("test:gem");check(icon.startsWith("data:image/png;base64,"),"PNG data URI");
        var decoded=ImageIO.read(new ByteArrayInputStream(Base64.getDecoder().decode(icon.substring(icon.indexOf(',')+1))));
        check(decoded.getWidth()==64 && decoded.getHeight()==64,"normalized size");check(decoded.getRGB(32,63)==0xffff0000,"first animation frame");
        model(assets,"test:child","{\"parent\":\"test:item/gem\",\"textures\":{\"layer0\":\"#alias\",\"alias\":\"test:item/gem\"}}");
        check(!resolver.icon("test:child").isEmpty(),"parent and texture references");
        model(assets,"test:cycle","{\"parent\":\"test:item/cycle\"}");check(resolver.icon("test:cycle").isEmpty(),"model cycle bounded");
        model(assets,"test:refs","{\"parent\":\"minecraft:item/generated\",\"textures\":{\"layer0\":\"#loop\",\"loop\":\"#loop\"}}");check(resolver.icon("test:refs").isEmpty(),"texture cycle bounded");
        model(assets,"test:custom","{\"loader\":\"test:renderer\",\"parent\":\"test:item/gem\"}");check(resolver.icon("test:custom").isEmpty(),"custom renderer fallback");
        model(assets,"test:block","{\"parent\":\"minecraft:block/cube_all\"}");check(resolver.icon("test:block").isEmpty(),"3D fallback");
        model(assets,"test:casing","{\"parent\":\"minecraft:block/cube_all\",\"textures\":{\"all\":\"test:item/gem\"}}");
        check(!resolver.icon("test:casing").isEmpty(),"block model texture preview");
        String casingSvg=new String(Base64.getDecoder().decode(resolver.icon("test:casing").split(",",2)[1]),StandardCharsets.UTF_8);
        check(casingSvg.contains("<svg"),"block preview is SVG");
        check(casingSvg.split("<clipPath ",-1).length-1==3,"cube displays three camera-facing sides");
        model(assets,"test:tool","{\"textures\":{\"0\":\"test:item/gem\"},\"elements\":[{\"from\":[0,0,0],\"to\":[16,16,16],\"faces\":{\"north\":{\"texture\":\"#0\"}}}]}");
        check(!resolver.icon("test:tool").isEmpty(),"static model face texture preview");
        check(!ItemIcons.png(new byte[24]),"invalid PNG rejected");
        check(resolver.icon("test:missing").isEmpty(),"missing asset fallback");
        model(assets,"test:broken","oops");check(resolver.icon("test:broken").isEmpty(),"malformed model fallback");
        for(String id:List.of("../secret","..:item/secret",".:item/secret","test:../secret","test:item/../../secret","test:/etc/passwd","test:item//gem","test:item/./gem","https://example.com/a"))check(!ItemIcons.valid(id),"reject traversal " + id);
        JsonArray tooMany=new JsonArray();for(int i=0;i<129;i++)tooMany.add("test:gem");try{resolver.batch(tooMany);throw new AssertionError("batch limit");}catch(IllegalArgumentException expected){checks++;}
        JsonArray batch=new JsonArray();batch.add("test:gem");batch.add("test:missing");check(resolver.batch(batch).size()==2,"mixed batch fallback");
        System.out.println("PASS: "+checks+" icon resolver checks.");
    }
}
