package com.zaremate.admin_panel;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.awt.Graphics2D;
import java.io.*;
import java.util.*;

/** Optional desktop-module normalization; callers can serve the original PNG when unavailable. */
final class PngPreview {
    static String render(List<byte[]> layers) throws Exception {
        BufferedImage output=new BufferedImage(64,64,BufferedImage.TYPE_INT_ARGB);
        Graphics2D draw=output.createGraphics();
        try {
            for(byte[] png:layers) {
                try(var stream=ImageIO.createImageInputStream(new ByteArrayInputStream(png))) {
                    var readers=ImageIO.getImageReaders(stream);if(!readers.hasNext())return "";
                    var reader=readers.next();try {
                        reader.setInput(stream);int w=reader.getWidth(0),h=reader.getHeight(0);
                        if(w<1||h<1||w>2048||h>16384||(long)w*h>4194304)return "";
                        BufferedImage image=reader.read(0);
                        int frameHeight=h>w&&h%w==0?w:h;
                        draw.drawImage(image,0,0,64,64,0,0,w,frameHeight,null);
                    }finally{reader.dispose();}
                }
            }
        }finally{draw.dispose();}
        var bytes=new ByteArrayOutputStream();ImageIO.write(output,"PNG",bytes);
        return "data:image/png;base64,"+Base64.getEncoder().encodeToString(bytes.toByteArray());
    }
}
