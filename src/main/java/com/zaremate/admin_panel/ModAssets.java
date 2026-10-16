package com.zaremate.admin_panel;

import java.nio.file.*;
import net.neoforged.fml.ModList;

final class ModAssets {
    private ModAssets() {}
    static byte[] read(String path) throws Exception {
        // Paths originate only from validated resource IDs, never arbitrary user paths.
        var files=ModList.get().getModFiles();
        for(int i=files.size()-1;i>=0;i--) {
            Path asset=files.get(i).getFile().findResource(path.split("/"));
            if(Files.isRegularFile(asset)) {
                if(Files.size(asset)>2*1024*1024)return null;
                try(var stream=Files.newInputStream(asset)) {return stream.readNBytes(2*1024*1024+1);}
            }
        }
        return null;
    }
}
