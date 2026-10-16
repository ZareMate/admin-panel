package com.zaremate.admin_panel;
import java.nio.file.*;
import java.util.*;
import java.util.zip.ZipFile;

/** Explicit integration check against supplied installed mod jars, never packaged in the release. */
public final class InstalledIconTest {
    public static void main(String[] args)throws Exception {
        List<ZipFile> jars=new ArrayList<>();
        try {
            try(var paths=Files.list(Path.of(args[0]))){for(Path p:paths.filter(p->p.getFileName().toString().matches("(create-1\\.21\\.1-|createaddition-|powergrid-|tfmg-|create_better_motors-).*\\.jar")).toList())jars.add(new ZipFile(p.toFile()));}
            ItemIcons icons=new ItemIcons(path->{for(ZipFile jar:jars){var entry=jar.getEntry(path);if(entry!=null)try(var in=jar.getInputStream(entry)){return in.readNBytes(2097153);}}return null;});
            StringBuilder gallery=new StringBuilder("<html><body style='background:#172329;color:white;font:14px sans-serif;display:flex;flex-wrap:wrap'>");
            for(String id:List.of("create:clipboard","create:wrench","powergrid:voltage_gauge","create:brass_casing","create:andesite_casing","createaddition:copper_wire","tfmg:copper_wire","tfmg:multimeter","powergrid:multimeter","create_better_motors:multimeter")){
                String result=icons.icon(id);if(!(result.startsWith("data:image/png;base64,")||result.startsWith("data:image/svg+xml;base64,")))throw new AssertionError("No preview for "+id);
                gallery.append("<div style='width:170px;text-align:center;padding:15px'><img width='96' height='96' src='").append(result).append("'><p>").append(id).append("</p></div>");
                System.out.println("PASS: installed asset "+id);
            }
            Files.createDirectories(Path.of("build/reports/icons"));Files.writeString(Path.of("build/reports/icons/installed.html"),gallery.append("</body></html>").toString());
        }finally{for(ZipFile jar:jars)jar.close();}
    }
}
