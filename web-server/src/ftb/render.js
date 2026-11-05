// Terrain shading adapted from stasis-control/public/radar.js.
import defaultPalette from './palette.js';
import {readPng,writePng,readZipEntry,zipEntries,SUPPORTED_LAYERS} from './codec.js';
function clampChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseHexColor(value) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return null;
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16)
  ];
}

function fallbackFtbBlockColor(blockId) {
  const id = String(blockId || "").toLowerCase();
  const path = id.includes(":") ? id.split(":")[1] : id;

  const colors = {
    water: [63, 118, 228],
    flowing_water: [63, 118, 228],
    lava: [207, 96, 46],
    stone: [140, 140, 140],
    cobblestone: [122, 122, 122],
    deepslate: [78, 78, 78],
    tuff: [108, 112, 102],
    calcite: [224, 224, 219],
    diorite: [194, 194, 194],
    granite: [149, 103, 90],
    dirt: [128, 92, 60],
    coarse_dirt: [112, 78, 51],
    rooted_dirt: [125, 89, 64],
    clay: [159, 164, 177],
    gravel: [119, 112, 109],
    sand: [245, 231, 164],
    red_sand: [187, 95, 45],
    sandstone: [223, 215, 173],
    snow: [239, 239, 239],
    snow_block: [239, 239, 239],
    powder_snow: [232, 241, 249],
    ice: [145, 182, 247],
    packed_ice: [145, 182, 247],
    blue_ice: [145, 182, 247],
    grass_block: [100, 150, 75],
    podzol: [110, 87, 54],
    mycelium: [104, 82, 96],
    moss_block: [104, 130, 79],
    bedrock: [55, 55, 55],
    obsidian: [21, 0, 71],
    netherrack: [122, 53, 53],
    end_stone: [177, 173, 113],
    bricks: [174, 96, 75],
    nether_bricks: [46, 23, 27],
    quartz_block: [235, 229, 220],
    blackstone: [56, 50, 59],
    basalt: [80, 80, 84],
    polished_basalt: [90, 90, 94],
    prismarine: [82, 142, 135],
    sea_lantern: [170, 220, 210]
  };

  if (colors[path]) return colors[path];

  if (/\b(log|wood|planks|stem|hyphae)\b/.test(path)) {
    if (path.includes("dark_oak")) return [81, 45, 20];
    if (path.includes("spruce")) return [124, 94, 46];
    if (path.includes("birch")) return [242, 224, 147];
    if (path.includes("jungle")) return [198, 118, 83];
    if (path.includes("acacia")) return [224, 127, 62];
    if (path.includes("cherry")) return [190, 127, 117];
    return [150, 107, 62];
  }

  if (/leaves|leaf|vine/.test(path)) return [70, 100, 55];
  if (/sand/.test(path)) return [220, 190, 130];
  if (/stone|rock/.test(path)) return [128, 128, 128];
  if (/brick/.test(path)) return [155, 90, 75];
  if (/concrete|wool|terracotta/.test(path)) return [130, 130, 130];

  return [128, 128, 128];
}

function ftbTint(base, tint, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  return [
    base[0] + (tint[0] - base[0]) * a,
    base[1] + (tint[1] - base[1]) * a,
    base[2] + (tint[2] - base[2]) * a
  ];
}

export function renderRegion(buffer,region,blockByIndex={}) {
 const ftbPalette={...defaultPalette,blockByIndex:{...defaultPalette.blockByIndex,...blockByIndex}};
 const entries=zipEntries(buffer);
 const layers={};
 for (const name of SUPPORTED_LAYERS) layers[name]=readPng(readZipEntry(buffer,entries,name));
 const grassPixels=layers['grass.png'].rgba,foliagePixels=layers['foliage.png'].rgba;
 const waterPixels=layers['water.png'].rgba,dataPixels=layers['data.png'].rgba,blockPixels=layers['blocks.png'].rgba;
 const output={data:Buffer.alloc(512*512*4)};
    for (let offset = 0; offset < output.data.length; offset += 4) {
      const packedWaterLightBiome = (dataPixels[offset + 2] << 8) | dataPixels[offset + 3];
      const hasWater = (packedWaterLightBiome & 0x8000) !== 0;


      const blockIndexHex =
        blockPixels[offset].toString(16).padStart(2, "0") +
        blockPixels[offset + 1].toString(16).padStart(2, "0") +
        blockPixels[offset + 2].toString(16).padStart(2, "0");

      const blockId = ftbPalette.blockByIndex[blockIndexHex.toUpperCase()];
      const customType = blockId ? ftbPalette.types[blockId] : null;
      let base;

      if (!blockId || customType === "ignored" || blockId === "minecraft:air" || blockId === "minecraft:void_air") {
        output.data[offset] = 0;
        output.data[offset + 1] = 0;
        output.data[offset + 2] = 0;
        output.data[offset + 3] = 0;
        continue;
      }

      // ColorMapLoader applies explicit ftbchunks_block_colors entries first.
      // Its built-in defaults then classify grass blocks as biome grass, leaves
      // and vines as biome foliage, rails as gray, and flower pots as brown.
      if (customType === "grass" || (/_grass_block$/.test(blockId) && !ftbPalette.colors[blockId])) {
        base = [
          grassPixels[offset],
          grassPixels[offset + 1],
          grassPixels[offset + 2]
        ];
        const darkness = 50 / 255;
        base = base.map(channel => channel * (1 - darkness));
      } else if (customType === "foliage" || (/(^|:)((.+_)?leaves|vine)$/.test(blockId) && !ftbPalette.colors[blockId])) {
        base = [
          foliagePixels[offset],
          foliagePixels[offset + 1],
          foliagePixels[offset + 2]
        ];
        const darkness = 50 / 255;
        base = base.map(channel => channel * (1 - darkness));
      } else if (blockId.endsWith("_rail") || /:(powered_rail|detector_rail|activator_rail)$/.test(blockId)) {
        base = [136, 136, 136];
      } else if (blockId.endsWith("flower_pot")) {
        base = [104, 58, 45];
      } else {
        base =
          parseHexColor(ftbPalette.colors[blockId]) ||
          fallbackFtbBlockColor(blockId);
      }

      if (hasWater) {
        const waterColor = [
          waterPixels[offset],
          waterPixels[offset + 1],
          waterPixels[offset + 2]
        ];
        base = ftbTint(base, waterColor, 220 / 255);
      }

      // In FTB's normal map mode, light level is not used to brighten terrain.
      // Instead it adds a small deterministic noise and height-based shadow.
      const pixelIndex = offset / 4;
      const px = pixelIndex % 512;
      const py = Math.floor(pixelIndex / 512);
      const west = py >= 0 && px > 0 ? offset - 4 : offset;
      const north = py > 0 ? offset - 512 * 4 : offset;

      const height = (dataPixels[offset] << 8) | dataPixels[offset + 1];
      const westHeight = (dataPixels[west] << 8) | dataPixels[west + 1];
      const northHeight = (dataPixels[north] << 8) | dataPixels[north + 1];

      let addedBrightness = 0;
      const shadow = 0.1 * (hasWater ? 0.6 : 1);
      if (height > northHeight || height > westHeight) addedBrightness += shadow;
      if (height < northHeight || height < westHeight) addedBrightness -= shadow;

      // Match FTB's default noise range of ±0.025.
      const hash = Math.sin((px + region.x * 512) * 12.9898 + (py + region.z * 512) * 78.233) * 43758.5453;
      const noise = (hash - Math.floor(hash)) * 0.05 - 0.025;
      addedBrightness += noise;

      output.data[offset] = clampChannel(base[0] + addedBrightness * 255);
      output.data[offset + 1] = clampChannel(base[1] + addedBrightness * 255);
      output.data[offset + 2] = clampChannel(base[2] + addedBrightness * 255);
      output.data[offset + 3] = 255;
    }

 return writePng({width:512,height:512,rgba:output.data});
}
