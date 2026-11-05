export const nbtFixture={type:'compound',value:{components:{type:'compound',value:{'minecraft:custom_name':{type:'string',value:'<img src=x onerror=window.nbtXss=true>'},precise:{type:'long',value:'9223372036854775807L'}}},id:{type:'string',value:'minecraft:bow'}}};
import {randomUUID} from 'node:crypto';
export function deathFixture(){
 return {id:randomUUID(),at:Date.now(),victim:{uuid:randomUUID(),name:'Victim',type:'minecraft:player',player:true},killer:{uuid:randomUUID(),name:'Killer',type:'minecraft:player',player:true},
  attribution:'damage-source',cause:'minecraft:arrow',message:'Victim was shot by Killer using Custom Blade',dimension:'minecraft:overworld',x:10,y:64,z:-20,keepInventory:false,experienceLevel:12,totalExperience:100,
  directEntity:{uuid:randomUUID(),name:'Arrow',type:'minecraft:arrow',player:false},
  weapon:{empty:false,id:'minecraft:bow',name:'Custom Blade',customName:'Custom Blade',nbt:nbtFixture,count:1,damage:12,maxDamage:384,enchantments:['Power V'],lore:['Precious bow']},
  inventory:{inventory:{available:true,groups:[{name:'Armor',slots:[{empty:false,id:'minecraft:diamond_chestplate',name:'Victim armor',nbt:nbtFixture,count:1,slot:0,label:'Chestplate',damage:3,maxDamage:528,enchantments:['Protection IV'],lore:['<img src=x onerror=window.killXss=true>']}]}]},curios:{available:false,reason:'Curios is not installed'}}};
}
