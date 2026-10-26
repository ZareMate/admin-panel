package com.zaremate.admin_panel;

import java.util.*;

final class PunishmentRemovalTest {
    static int run() {
        UUID player=UUID.randomUUID(), other=UUID.randomUUID();
        var ban=entry(1,player,"ban",false,"ip",true,null,null);
        var another=entry(2,player,"ban",false,"ip",true,"offense",null);
        check(PunishmentRemoval.plan(List.of(ban),1,player).clearBan(),"sole UUID ban lifted");
        check(!PunishmentRemoval.plan(List.of(ban,another),1,player).clearBan(),"unrelated offense ban retained");
        check(PunishmentRemoval.plan(List.of(ban,entry(2,player,"ban",false,"ip",false,null,null)),1,player).clearBan(),"expired ban does not block unban");
        check(PunishmentRemoval.plan(List.of(ban,entry(2,other,"ban",false,"ip",true,null,null)),1,player).clearBan(),"other UUID does not block unban");
        var ipBan=entry(3,player,"ban",true,"shared-ip",true,null,null);
        check(!PunishmentRemoval.plan(List.of(ipBan,entry(4,other,"ban",true,"shared-ip",true,null,null)),3,player).clearBan(),"shared IP ban retained across accounts");
        check(PunishmentRemoval.plan(List.of(ipBan,entry(4,other,"ban",true,"other-ip",true,null,null)),3,player).clearBan(),"different IP not affected");
        check(!PunishmentRemoval.plan(List.of(entry(1,player,"ban",false,"ip",false,null,null)),1,player).clearBan(),"expired record does not touch vanilla bans");
        for(String type:List.of("warn","mute","kick"))check(!PunishmentRemoval.plan(List.of(entry(1,player,type,false,"ip",true,null,null)),1,player).clearBan(),"non-ban does not unban");
        rejected(()->PunishmentRemoval.plan(List.of(ban),1,other));
        rejected(()->PunishmentRemoval.plan(List.of(ban),2,player));
        rejected(()->PunishmentRemoval.plan(List.of(another),2,player));
        rejected(()->PunishmentRemoval.plan(List.of(entry(1,player,"warn",false,null,false,null,"staff")),1,player));
        return 14;
    }
    private static PunishmentRemoval.Entry entry(long id,UUID player,String type,boolean ipBased,String ip,boolean live,String offense,String removedBy) {
        return new PunishmentRemoval.Entry(id,player.toString(),offense,removedBy,type,ipBased,ip,live);
    }
    private static void check(boolean result,String label){if(!result)throw new AssertionError(label);}
    private static void rejected(Runnable work){try{work.run();throw new AssertionError("Removal should be rejected");}catch(BridgeFailure expected){if(expected.status!=409)throw new AssertionError(expected);}}
}
