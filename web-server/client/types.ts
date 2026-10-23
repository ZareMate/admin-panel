export interface Session {name:string;role:'viewer'|'moderator'|'admin';rank:string;permissions:string[];csrf:string}
export interface Player {uuid:string;name:string;online:boolean;hasDetections?:boolean}
export interface Note {id:string;text:string;author:string;createdAt:number;canEdit:boolean;system?:boolean}
export interface Case {id:number;caseId:string;type:string;active:boolean;until?:number;removedBy?:string;replaced?:boolean;offense?:string;primary?:boolean;ipBased?:boolean;reason:string;by:string;at:number}
export interface Slot {empty:boolean;label:string;id:string;name:string;count:number;selected?:boolean;damage:number;maxDamage:number;enchantments?:string[];lore?:string[]}
export interface StorageSection {available:boolean;reason?:string;groups:{name:string;slots:Slot[]}[]}
export interface Detail extends Player {
  notesAvailable:boolean;notes:Note[];cases:Case[];
  punish?:{available:boolean;offenses:{id:string;name:string;group?:string;steps:string[]}[]};
  location?:{available:boolean;source:string;dimension:string;x:number;y:number;z:number;savedAt?:number};
  playtime?:{available:boolean;seconds:number};
  discord?:{available:boolean;displayName?:string;discordTag?:string;discordId?:string;linkedAt?:number};
  teams?:{available:boolean;name:string;members:{name:string;rank:string;rankDisplay?:string}[]};
  clockin?:{available:boolean;clockedIn:boolean;totalSeconds:number};
  tsa?:{available:boolean;packetChecks?:number;packetPasses?:number;packetModified?:number;packetTimeout?:number;lastPacketStatus?:string;lastPacketDate?:string;detections?:string[]};
  ass?:{available:boolean;status?:string;totalChecks?:number;cleanChecks?:number;detectedChecks?:number;inconclusiveChecks?:number;clearedDate?:string;detectionCounts?:Record<string,number>;detectionDates?:Record<string,string>};
  storage?:{source:string;savedAt?:number;capturedAt?:number;inventory:StorageSection;enderChest:StorageSection;curios:StorageSection};
}
export interface Players {players:Player[];serverPlayers:number;maxPlayers:number;punishAvailable:boolean}
export interface AuditRow {at:number;actor:string;action:string;target:string;state:string;detail:unknown}
export interface Rank {name:string;discordRoleId:string;access?:string;permissions:string[]}
export type Api = <T>(path:string,body?:unknown,requestId?:string)=>Promise<T>;
