package com.zaremate.admin_panel;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Static cuboid preview using model geometry, UVs and GUI transforms. No desktop/native renderer needed. */
final class ModelPreview {
    record Face(double[][] points, double[][] uv, String texture, double depth) {}
    static String render(JsonArray elements, JsonObject gui, Map<String,String> textures, ItemIcons.Assets assets) throws Exception {
        if(elements.size()>256)return "";
        List<Face> faces=new ArrayList<>();Map<String,String> images=new LinkedHashMap<>();
        double[] rotation=vector(gui,"rotation",new double[]{0,0,0}),scale=vector(gui,"scale",new double[]{1,1,1}),translation=vector(gui,"translation",new double[]{0,0,0});
        for(JsonElement raw:elements) {
            JsonObject element=raw.getAsJsonObject();double[] from=vector(element,"from",null),to=vector(element,"to",null);
            if(from==null||to==null||!element.has("faces"))return "";
            double x=from[0],y=from[1],z=from[2],X=to[0],Y=to[1],Z=to[2];
            for(var entry:element.getAsJsonObject("faces").entrySet()) {
                String side=entry.getKey();JsonObject face=entry.getValue().getAsJsonObject();
                // A tint index needs client/world-dependent colors; do not silently display untinted art.
                if(face.has("tintindex")&&face.get("tintindex").getAsInt()>=0)return "";
                String texture=face.get("texture").getAsString();Set<String> seen=new HashSet<>();
                while(texture.startsWith("#")){if(!seen.add(texture))return "";texture=textures.get(texture.substring(1));if(texture==null)return "";}
                if(!texture.contains(":"))texture="minecraft:"+texture;
                if(!images.containsKey(texture)) {
                    byte[] png=assets.read(ItemIcons.path(texture,"textures",".png"));if(!ItemIcons.png(png))return "";
                    images.put(texture,Base64.getEncoder().encodeToString(png));
                }
                double[][] p=switch(side) {
                    case "south" -> new double[][]{{x,Y,Z},{X,Y,Z},{X,y,Z},{x,y,Z}};
                    case "north" -> new double[][]{{X,Y,z},{x,Y,z},{x,y,z},{X,y,z}};
                    case "east" -> new double[][]{{X,Y,Z},{X,Y,z},{X,y,z},{X,y,Z}};
                    case "west" -> new double[][]{{x,Y,z},{x,Y,Z},{x,y,Z},{x,y,z}};
                    case "up" -> new double[][]{{x,Y,z},{X,Y,z},{X,Y,Z},{x,Y,Z}};
                    case "down" -> new double[][]{{x,y,Z},{X,y,Z},{X,y,z},{x,y,z}};
                    default -> throw new IllegalArgumentException("Unsupported model face");
                };
                double[] uvDefault=switch(side){
                    case "north" -> new double[]{16-X,16-Y,16-x,16-y};
                    case "south" -> new double[]{x,16-Y,X,16-y};
                    case "east" -> new double[]{16-Z,16-Y,16-z,16-y};
                    case "west" -> new double[]{z,16-Y,Z,16-y};
                    case "up" -> new double[]{x,z,X,Z};
                    default -> new double[]{x,16-Z,X,16-z};
                };
                double[] uv=face.has("uv")?numbers(face.getAsJsonArray("uv"),4):uvDefault;
                double[][] corners={{uv[0],uv[1]},{uv[2],uv[1]},{uv[2],uv[3]},{uv[0],uv[3]}};
                int turn=face.has("rotation")?face.get("rotation").getAsInt():0;
                if(turn%90!=0)return "";
                double[][] mapped=new double[4][];for(int i=0;i<4;i++)mapped[i]=corners[Math.floorMod(i+turn/90,4)];
                double depth=0;
                for(double[] v:p) {
                    if(element.has("rotation")) {
                        JsonObject r=element.getAsJsonObject("rotation");double[] origin=vector(r,"origin",new double[]{8,8,8});
                        String axis=r.get("axis").getAsString();int index=switch(axis){case "x"->0;case "y"->1;case "z"->2;default->throw new IllegalArgumentException("Invalid axis");};
                        double angle=r.get("angle").getAsDouble();
                        for(int i=0;i<3;i++)v[i]-=origin[i];rotate(v,index,angle);
                        if(r.has("rescale")&&r.get("rescale").getAsBoolean())for(int i=0;i<3;i++)if(i!=index)v[i]/=Math.cos(Math.toRadians(angle));
                        for(int i=0;i<3;i++)v[i]+=origin[i];
                    }
                    for(int i=0;i<3;i++)v[i]=(v[i]-8)*scale[i];
                    rotate(v,0,rotation[0]);rotate(v,1,rotation[1]);rotate(v,2,rotation[2]);
                    depth+=v[2];v[0]=32+4*(v[0]+translation[0]);v[1]=32-4*(v[1]+translation[1]);
                }
                double area=(p[1][0]-p[0][0])*(p[3][1]-p[0][1])-(p[1][1]-p[0][1])*(p[3][0]-p[0][0]);
                if(area>0.0001)faces.add(new Face(p,mapped,texture,depth/4));
            }
        }
        if(faces.isEmpty())return "";
        faces.sort(Comparator.comparingDouble(Face::depth));
        StringBuilder svg=new StringBuilder("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" viewBox=\"0 0 64 64\"><defs>");
        Map<String,String> ids=new HashMap<>();int index=0;
        for(var image:images.entrySet()){String id="t"+index++;ids.put(image.getKey(),id);svg.append("<image id=\"").append(id).append("\" width=\"16\" height=\"16\" preserveAspectRatio=\"none\" style=\"image-rendering:pixelated\" href=\"data:image/png;base64,").append(image.getValue()).append("\"/>");}
        svg.append("</defs>");index=0;
        for(Face face:faces) {
            double[][] p=face.points(),uv=face.uv();
            double u1=uv[1][0]-uv[0][0],v1=uv[1][1]-uv[0][1],u2=uv[3][0]-uv[0][0],v2=uv[3][1]-uv[0][1],det=u1*v2-u2*v1;
            if(Math.abs(det)<1e-8)continue;
            double dx1=p[1][0]-p[0][0],dy1=p[1][1]-p[0][1],dx2=p[3][0]-p[0][0],dy2=p[3][1]-p[0][1];
            double a=(dx1*v2-dx2*v1)/det,c=(dx2*u1-dx1*u2)/det,b=(dy1*v2-dy2*v1)/det,d=(dy2*u1-dy1*u2)/det;
            double e=p[0][0]-a*uv[0][0]-c*uv[0][1],f=p[0][1]-b*uv[0][0]-d*uv[0][1];
            String clip="f"+index++;
            svg.append("<clipPath id=\"").append(clip).append("\"><polygon points=\"");for(double[] v:p)svg.append(n(v[0])).append(',').append(n(v[1])).append(' ');
            svg.append("\"/></clipPath><g clip-path=\"url(#").append(clip).append(")\"><use href=\"#").append(ids.get(face.texture())).append("\" transform=\"matrix(").append(n(a)).append(' ').append(n(b)).append(' ').append(n(c)).append(' ').append(n(d)).append(' ').append(n(e)).append(' ').append(n(f)).append(")\"/></g>");
        }
        svg.append("</svg>");
        if(index==0||svg.length()>4*1024*1024)return "";
        return "data:image/svg+xml;base64,"+Base64.getEncoder().encodeToString(svg.toString().getBytes(StandardCharsets.UTF_8));
    }
    private static String n(double number){if(!Double.isFinite(number)||Math.abs(number)>100000)throw new IllegalArgumentException("Invalid model coordinate");return String.format(Locale.ROOT,"%.5f",number);}
    private static double[] vector(JsonObject object,String key,double[] fallback){return object!=null&&object.has(key)?numbers(object.getAsJsonArray(key),3):fallback;}
    private static double[] numbers(JsonArray array,int size){if(array.size()!=size)throw new IllegalArgumentException("Invalid vector");double[] values=new double[size];for(int i=0;i<size;i++){values[i]=array.get(i).getAsDouble();if(!Double.isFinite(values[i])||Math.abs(values[i])>4096)throw new IllegalArgumentException("Invalid vector");}return values;}
    private static void rotate(double[] v,int axis,double degrees){double c=Math.cos(Math.toRadians(degrees)),s=Math.sin(Math.toRadians(degrees));int a=(axis+1)%3,b=(axis+2)%3;double x=v[a],y=v[b];v[a]=x*c-y*s;v[b]=x*s+y*c;}
    static JsonArray cube(String parent){
        JsonObject element=new JsonObject();element.add("from",JsonParser.parseString("[0,0,0]"));element.add("to",JsonParser.parseString("[16,16,16]"));JsonObject faces=new JsonObject();
        for(String side:List.of("north","south","east","west","up","down")){
            String key=switch(parent){case "minecraft:block/cube_all"->"all";case "minecraft:block/cube_column"->Set.of("up","down").contains(side)?"end":"side";case "minecraft:block/cube_bottom_top"->side.equals("up")?"top":side.equals("down")?"bottom":"side";case "minecraft:block/orientable"->side.equals("north")?"front":Set.of("up","down").contains(side)?"top":"side";default->side;};
            JsonObject face=new JsonObject();face.addProperty("texture","#"+key);faces.add(side,face);
        }
        element.add("faces",faces);JsonArray result=new JsonArray();result.add(element);return result;
    }
    static JsonObject blockGui(){return JsonParser.parseString("{\"rotation\":[30,225,0],\"scale\":[0.625,0.625,0.625]}").getAsJsonObject();}
}
