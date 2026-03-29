import path from "path";

export interface SourceEntry {
  sourceId: string;
  folder: string;
  category: string;
  dbFile?: string;        // defaults to "plants.db"
  tableName: string;
  nameColumn: string;
  displayName: string;
  keyColumns: string[];
}

export interface TaxonomyBackbone extends SourceEntry {
  extraColumns: string[];
}

export const DATABASE_SOURCES_ROOT = path.resolve(
  process.cwd(),
  "..",
  "database-sources"
);

// --- Taxonomy Backbones ---

export const TAXONOMY_BACKBONES: TaxonomyBackbone[] = [
  {
    sourceId: "TAXON-03",
    folder: "taxonomy/USDA_PLANTS",
    category: "taxonomy",
    tableName: "plants",
    nameColumn: "scientific_name_full",
    displayName: "USDA PLANTS",
    keyColumns: ["symbol", "common_name", "family", "is_synonym"],
    extraColumns: ["synonym_symbol"],
  },
  {
    sourceId: "TAXON-01",
    folder: "taxonomy/POWO_WCVP",
    category: "taxonomy",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "POWO / WCVP",
    keyColumns: [
      "family",
      "lifeform",
      "climate",
      "native_to",
      "introduced_to",
    ],
    extraColumns: ["taxon_name", "authors", "powo_id"],
  },
  {
    sourceId: "TAXON-02",
    folder: "taxonomy/WorldFloraOnline",
    category: "taxonomy",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "World Flora Online",
    keyColumns: ["family", "major_group", "major_group_name"],
    extraColumns: ["wfo_id", "authors"],
  },
];

// --- Source Databases (non-taxonomy) ---

export const SOURCE_DATABASES: SourceEntry[] = [
  // Fire
  {
    sourceId: "FIRE-01",
    folder: "fire/FirePerformancePlants",
    category: "fire",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "Fire Performance Plants (SREF)",
    keyColumns: [
      "firewise_rating",
      "firewise_rating_code",
      "firewise_rating_label",
      "landscape_zone",
    ],
  },
  {
    sourceId: "FIRE-02",
    folder: "fire/IdahoFirewise",
    category: "fire",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "Idaho Firewise",
    keyColumns: ["plant_type", "cultivar"],
  },
  {
    sourceId: "FIRE-04",
    folder: "fire/NIST_USDA_Flammability",
    category: "fire",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "NIST/USDA Flammability",
    keyColumns: ["flammability_rank"],
  },
  {
    sourceId: "FIRE-05",
    folder: "fire/UCForestProductsLab",
    category: "fire",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "UC Forest Products Lab",
    keyColumns: ["plant_type", "plant_form", "fire_rating"],
  },
  {
    sourceId: "FIRE-07",
    folder: "fire/DiabloFiresafe",
    category: "fire",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "Diablo Firesafe",
    keyColumns: ["plant_type", "plant_form", "fire_rating"],
  },
  {
    sourceId: "FIRE-08",
    folder: "fire/OaklandFireSafe",
    category: "fire",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "Oakland FireSafe",
    keyColumns: [
      "lifeform",
      "category",
      "fire_rating",
      "ca_native",
      "pyrophytic",
    ],
  },
  {
    sourceId: "FIRE-11",
    folder: "fire/OSU_PNW590",
    category: "fire",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "OSU PNW590",
    keyColumns: [
      "category",
      "height",
      "spread",
      "water_use",
      "bloom_time",
      "flower_color",
    ],
  },

  {
    sourceId: "FIRE-03",
    folder: "fire/FLAMITS",
    category: "fire",
    dbFile: "flamits.db",
    tableName: "taxon",
    nameColumn: "taxon_name",
    displayName: "FLAMITS Flammability DB",
    keyColumns: [
      "growth_form",
      "woodiness",
      "leaf_phenology",
      "lifespan",
      "native_distrib",
    ],
  },
  {
    sourceId: "FIRE-10",
    folder: "fire/FirescapingBook",
    category: "fire",
    dbFile: "plant_swaps.db",
    tableName: "plant_swaps",
    nameColumn: "replacement_scientific",
    displayName: "Firescaping Book",
    keyColumns: ["category", "swap_type"],
  },

  // Deer
  {
    sourceId: "DEER-01",
    folder: "deer/RutgersDeerResistance",
    category: "deer",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "Rutgers Deer Resistance",
    keyColumns: ["deer_rating", "deer_rating_code"],
  },
  {
    sourceId: "DEER-02",
    folder: "deer/NCSU_DeerResistant",
    category: "deer",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "NCSU Deer Resistant",
    keyColumns: ["deer_resistant"],
  },
  {
    sourceId: "DEER-03",
    folder: "deer/MissouriBotanicalDeer",
    category: "deer",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "Missouri Botanical Deer",
    keyColumns: ["deer_browse"],
  },
  {
    sourceId: "DEER-04",
    folder: "deer/WSU_DeerResistant",
    category: "deer",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "WSU Deer Resistant",
    keyColumns: ["plant_type", "deer_resistant"],
  },
  {
    sourceId: "DEER-05",
    folder: "deer/CSU_DeerDamage",
    category: "deer",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "CSU Deer Damage",
    keyColumns: ["plant_type", "deer_resistance"],
  },
  // DEER-06 CornellDeerResistance uses common_name only — skip for scientific name search

  // Water
  {
    sourceId: "WATER-01",
    folder: "water/WUCOLS",
    category: "water",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "WUCOLS (UC Davis)",
    keyColumns: [
      "plant_type",
      "region_1_water_use",
      "region_2_water_use",
      "region_3_water_use",
    ],
  },
  {
    sourceId: "WATER-02",
    folder: "water/UtahCWEL",
    category: "water",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "Utah CWEL",
    keyColumns: [],
  },
  {
    sourceId: "DROUGHT-01",
    folder: "water/OSU_DroughtTolerant",
    category: "water",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "OSU Drought Tolerant",
    keyColumns: [
      "group",
      "height",
      "spread",
      "drought_tolerance",
      "bloom",
      "flower_color",
    ],
  },

  // Pollinators
  {
    sourceId: "POLL-01",
    folder: "pollinators/XercesPollinator",
    category: "pollinators",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "Xerces Pollinator",
    keyColumns: ["flower_color", "height", "bloom", "sun", "pollinators"],
  },
  {
    sourceId: "POLL-02",
    folder: "pollinators/PollinatorPartnership",
    category: "pollinators",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "Pollinator Partnership",
    keyColumns: [
      "plant_type",
      "flower_color",
      "bloom",
      "sun",
      "pollinators",
      "host_plant",
    ],
  },
  {
    sourceId: "POLL-03",
    folder: "pollinators/NRCS_Pollinator",
    category: "pollinators",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "NRCS Pollinator",
    keyColumns: ["pollen_nectar", "attracts", "insect_count"],
  },

  // Birds (genus-level match only)
  {
    sourceId: "BIRD-01",
    folder: "birds/TallamyBirdPlants",
    category: "birds",
    tableName: "plants",
    nameColumn: "genus",
    displayName: "Tallamy Bird Plants",
    keyColumns: ["type", "lepidoptera_species", "bird_value", "region"],
  },

  // Native
  {
    sourceId: "NATIVE-01",
    folder: "native/LBJ_Wildflower",
    category: "native",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "LBJ Wildflower Center",
    keyColumns: [],
  },
  {
    sourceId: "NATIVE-03",
    folder: "native/OregonFlora",
    category: "native",
    tableName: "accepted_taxa",
    nameColumn: "scientific_name",
    displayName: "Oregon Flora",
    keyColumns: ["family", "group", "origin"],
  },
  {
    sourceId: "NATIVE-02",
    folder: "native/PlantNativeORWA",
    category: "native",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "Plant Native OR/WA",
    keyColumns: ["plant_type", "sun", "moisture", "height"],
  },

  // Invasive
  {
    sourceId: "INVAS-01",
    folder: "invasive/FederalNoxiousWeeds",
    category: "invasive",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "Federal Noxious Weeds",
    keyColumns: ["category"],
  },
  {
    sourceId: "INVAS-02",
    folder: "invasive/USDA_InvasiveSpecies",
    category: "invasive",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "USDA Invasive Species",
    keyColumns: ["invasive_status"],
  },
  {
    sourceId: "INVAS-03",
    folder: "invasive/WGA_InvasiveSpecies",
    category: "invasive",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "WGA Invasive Species",
    keyColumns: ["rank", "category"],
  },
  {
    sourceId: "INVAS-04",
    folder: "invasive/USGS_RIIS",
    category: "invasive",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "USGS RIIS",
    keyColumns: [
      "family",
      "degree_of_establishment",
      "establishment_means",
      "habitat",
    ],
  },
  {
    sourceId: "INVAS-05",
    folder: "invasive/CalIPC_Invasive",
    category: "invasive",
    tableName: "plants",
    nameColumn: "Latin_binomial",
    displayName: "Cal-IPC Invasive",
    keyColumns: ["Rating", "Impact_Score", "Invasiveness_Score"],
  },

  // Traits
  {
    sourceId: "TRAIT-01",
    folder: "traits/MBG_PlantFinder",
    category: "traits",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "MBG Plant Finder",
    keyColumns: [],
  },
  {
    sourceId: "TRAIT-02",
    folder: "traits/NCSU database",
    category: "traits",
    tableName: "plants",
    nameColumn: "scientific_name",
    displayName: "NCSU Plant Database",
    keyColumns: [
      "family",
      "plant_type",
      "life_cycle",
      "growth_rate",
      "height",
      "width",
      "light",
      "soil_texture",
      "usda_zones",
      "flower_color",
      "flower_bloom_time",
      "wildlife_value",
      "resistance",
    ],
  },
];
