/**
 * Static crosswalk from source database column names to production attribute UUIDs.
 *
 * Derived from: LivingWithFire-DB/api-reference/ATTRIBUTE-REGISTRY.md
 * and each dataset's DATA-DICTIONARY.md.
 *
 * Multiple source columns can map to the same production attribute
 * (e.g., deer_rating, deer_resistant, deer_browse → Deer Resistance).
 */

export interface AttributeMapping {
  attributeId: string;
  attributeName: string;
  category: string;
  calculated?: boolean;
}

/**
 * Map from lowercase source column name → production attribute.
 * Lookup is case-insensitive: callers should lowercase the column name before checking.
 */
export const COLUMN_TO_ATTRIBUTE: Record<string, AttributeMapping> = {
  // --- Fire / Flammability ---
  firewise_rating: {
    attributeId: "d996587c-383b-4dc6-a23c-239b7de7e47b",
    attributeName: "List Choice",
    category: "Flammability",
  },
  firewise_rating_code: {
    attributeId: "d996587c-383b-4dc6-a23c-239b7de7e47b",
    attributeName: "List Choice",
    category: "Flammability",
  },
  firewise_rating_label: {
    attributeId: "d996587c-383b-4dc6-a23c-239b7de7e47b",
    attributeName: "List Choice",
    category: "Flammability",
  },
  fire_rating: {
    attributeId: "d996587c-383b-4dc6-a23c-239b7de7e47b",
    attributeName: "List Choice",
    category: "Flammability",
  },
  flammability_rank: {
    attributeId: "d996587c-383b-4dc6-a23c-239b7de7e47b",
    attributeName: "List Choice",
    category: "Flammability",
  },
  landscape_zone: {
    attributeId: "b908b170-70c9-454d-a2ed-d86f98cb3de1",
    attributeName: "Home Ignition Zone (HIZ)",
    category: "Flammability",
  },
  pyrophytic: {
    attributeId: "34b147da-613b-4df7-8eb9-76fd10e1d7ae",
    attributeName: "Flammability Notes",
    category: "Flammability",
  },

  // --- Deer / Wildlife ---
  deer_rating: {
    attributeId: "ff4c4d0e-35d5-4804-aea3-2a6334ef8cb5",
    attributeName: "Deer Resistance",
    category: "Wildlife Values",
  },
  deer_rating_code: {
    attributeId: "ff4c4d0e-35d5-4804-aea3-2a6334ef8cb5",
    attributeName: "Deer Resistance",
    category: "Wildlife Values",
  },
  deer_resistant: {
    attributeId: "ff4c4d0e-35d5-4804-aea3-2a6334ef8cb5",
    attributeName: "Deer Resistance",
    category: "Wildlife Values",
  },
  deer_browse: {
    attributeId: "ff4c4d0e-35d5-4804-aea3-2a6334ef8cb5",
    attributeName: "Deer Resistance",
    category: "Wildlife Values",
  },
  deer_resistance: {
    attributeId: "ff4c4d0e-35d5-4804-aea3-2a6334ef8cb5",
    attributeName: "Deer Resistance",
    category: "Wildlife Values",
  },
  lepidoptera_species: {
    attributeId: "ff75e529-5b5c-4461-8191-0382e33a4bd5",
    attributeName: "Benefits",
    category: "Wildlife Values",
  },
  bird_value: {
    attributeId: "ff75e529-5b5c-4461-8191-0382e33a4bd5",
    attributeName: "Benefits",
    category: "Wildlife Values",
  },
  wildlife_value: {
    attributeId: "ff75e529-5b5c-4461-8191-0382e33a4bd5",
    attributeName: "Benefits",
    category: "Wildlife Values",
  },

  // --- Water ---
  water_use: {
    attributeId: "d9174148-6563-4f92-9673-01feb6a529ce",
    attributeName: "Water Amount",
    category: "Water Requirements",
  },
  region_1_water_use: {
    attributeId: "d9174148-6563-4f92-9673-01feb6a529ce",
    attributeName: "Water Amount",
    category: "Water Requirements",
  },
  region_2_water_use: {
    attributeId: "d9174148-6563-4f92-9673-01feb6a529ce",
    attributeName: "Water Amount",
    category: "Water Requirements",
  },
  region_3_water_use: {
    attributeId: "d9174148-6563-4f92-9673-01feb6a529ce",
    attributeName: "Water Amount",
    category: "Water Requirements",
  },
  drought_tolerance: {
    attributeId: "af3e70d2-dc9c-4027-a09f-15d7d8b0dd10",
    attributeName: "Drought Tolerant",
    category: "Water Requirements",
  },

  // --- Nativeness ---
  origin: {
    attributeId: "716f3d8f-195f-4d16-824b-6dd1e88767a6",
    attributeName: "Native Status",
    category: "Nativeness",
  },
  ca_native: {
    attributeId: "716f3d8f-195f-4d16-824b-6dd1e88767a6",
    attributeName: "Native Status",
    category: "Nativeness",
  },

  // --- Invasiveness ---
  invasive_status: {
    attributeId: "284b2037-fef8-4b88-abd4-5387a4901109",
    attributeName: "Invasive",
    category: "Invasiveness",
  },
  invasive_warning: {
    attributeId: "284b2037-fef8-4b88-abd4-5387a4901109",
    attributeName: "Invasive",
    category: "Invasiveness",
  },
  rating: {
    attributeId: "a0900c7f-3bb3-4757-9dec-075f718c8f3e",
    attributeName: "Invasive Qualities",
    category: "Invasiveness",
  },
  impact_score: {
    attributeId: "a0900c7f-3bb3-4757-9dec-075f718c8f3e",
    attributeName: "Invasive Qualities",
    category: "Invasiveness",
  },
  invasiveness_score: {
    attributeId: "a0900c7f-3bb3-4757-9dec-075f718c8f3e",
    attributeName: "Invasive Qualities",
    category: "Invasiveness",
  },
  degree_of_establishment: {
    attributeId: "a0900c7f-3bb3-4757-9dec-075f718c8f3e",
    attributeName: "Invasive Qualities",
    category: "Invasiveness",
  },

  // --- Growth: Bloom & Flower ---
  bloom: {
    attributeId: "ca684872-8841-420e-a85b-b6d247b5b96e",
    attributeName: "Bloom Time",
    category: "Growth",
  },
  bloom_time: {
    attributeId: "ca684872-8841-420e-a85b-b6d247b5b96e",
    attributeName: "Bloom Time",
    category: "Growth",
  },
  flower_bloom_time: {
    attributeId: "ca684872-8841-420e-a85b-b6d247b5b96e",
    attributeName: "Bloom Time",
    category: "Growth",
  },
  flower_color: {
    attributeId: "86a95833-886a-42bf-b149-c3754e9d913a",
    attributeName: "Flower Color",
    category: "Growth",
  },

  // --- Growth: Plant Size ---
  height: {
    attributeId: "c0f9bad4-f164-4e72-ac47-a1abcfc57d33",
    attributeName: "Plant Height",
    category: "Growth",
  },
  height_ft: {
    attributeId: "c0f9bad4-f164-4e72-ac47-a1abcfc57d33",
    attributeName: "Plant Height",
    category: "Growth",
  },
  spread: {
    attributeId: "df410a6a-8827-4908-9083-70e93f4f79bd",
    attributeName: "Plant Width",
    category: "Growth",
  },
  width: {
    attributeId: "df410a6a-8827-4908-9083-70e93f4f79bd",
    attributeName: "Plant Width",
    category: "Growth",
  },
  growth_rate: {
    attributeId: "18efd95f-eeb5-418d-be0e-3f855943d200",
    attributeName: "Growth List Choice",
    category: "Growth",
  },

  // --- Environmental Requirements ---
  sun: {
    attributeId: "7096a9cc-3435-4e14-a1c4-eb9e95f0850f",
    attributeName: "Light Needs",
    category: "Environmental Requirements to Thrive",
  },
  light: {
    attributeId: "7096a9cc-3435-4e14-a1c4-eb9e95f0850f",
    attributeName: "Light Needs",
    category: "Environmental Requirements to Thrive",
  },
  usda_zones: {
    attributeId: "f0b45dc9-ee00-479a-8181-b4fda01f5233",
    attributeName: "Hardiness Zone",
    category: "Environmental Requirements to Thrive",
  },
  soil_texture: {
    attributeId: "1b3ac1d2-3de1-479d-a472-1db3572971e7",
    attributeName: "Soils List Choice",
    category: "Soils",
  },

  // --- Pollinators → Wildlife Benefits ---
  pollinators: {
    attributeId: "ff75e529-5b5c-4461-8191-0382e33a4bd5",
    attributeName: "Benefits",
    category: "Wildlife Values",
  },
  host_plant: {
    attributeId: "ff75e529-5b5c-4461-8191-0382e33a4bd5",
    attributeName: "Benefits",
    category: "Wildlife Values",
  },
  attracts: {
    attributeId: "ff75e529-5b5c-4461-8191-0382e33a4bd5",
    attributeName: "Benefits",
    category: "Wildlife Values",
  },
  pollen_nectar: {
    attributeId: "ff75e529-5b5c-4461-8191-0382e33a4bd5",
    attributeName: "Benefits",
    category: "Wildlife Values",
  },

  // --- Plant Structure ---
  plant_type: {
    attributeId: "ce4ce677-b02f-4d7d-b7f3-10052b65c03a",
    attributeName: "Habit/Form",
    category: "Growth",
  },
  plant_form: {
    attributeId: "ce4ce677-b02f-4d7d-b7f3-10052b65c03a",
    attributeName: "Habit/Form",
    category: "Growth",
  },
  life_cycle: {
    attributeId: "ce4ce677-b02f-4d7d-b7f3-10052b65c03a",
    attributeName: "Habit/Form",
    category: "Growth",
  },
  resistance: {
    attributeId: "292e690a-a647-4a4d-b7c3-3839891036c0",
    attributeName: "Ease of Growth",
    category: "Plant Materials",
  },

  // --- FLAMITS-specific ---
  growth_form: {
    attributeId: "ce4ce677-b02f-4d7d-b7f3-10052b65c03a",
    attributeName: "Habit/Form",
    category: "Growth",
  },
  woodiness: {
    attributeId: "b2150aec-75ac-4b4b-aeb1-c339c5da563c",
    attributeName: "Plant Structure",
    category: "Growth",
  },
  leaf_phenology: {
    attributeId: "eebb5a89-20be-4338-adfb-91c829201909",
    attributeName: "Leaf Structure",
    category: "Growth",
  },
};

/**
 * Production attribute UUIDs that are auto-calculated and should not be
 * manually edited. Derived from ATTRIBUTE-REGISTRY.md "Calculated: Yes" entries.
 */
export const CALCULATED_ATTRIBUTE_IDS = new Set([
  "f47ac10b-58cc-4372-a567-0e02b2c3d479", // Idaho Zone Tier (Calculated)
  "bacadba3-a4f8-4550-9906-6b5535a619b6", // Invasive (Calculated)
  "e8686d2e-fe16-440e-bc70-af4a0328cd05", // Wildlife Sum (Calculated)
  // Relative Value Matrix — all calculated
  "b1000001-0001-4000-8000-000000000001", // Has Flammability Rating
  "b1000001-0001-4000-8000-000000000002", // Has Water Amount
  "b1000001-0001-4000-8000-000000000003", // Has Drought Tolerant
  "b1000001-0001-4000-8000-000000000004", // Has Native Status
  "b1000001-0001-4000-8000-000000000005", // Has Deer Resistance
  "b1000001-0001-4000-8000-000000000006", // Wildlife Sum Component
  "b1000001-0001-4000-8000-000000000007", // Has Landscape Use
  "b1000001-0001-4000-8000-000000000008", // Has Erosion Control
  "b1000001-0001-4000-8000-000000000009", // Invasive Component
  "b1000001-0001-4000-8000-000000000010", // Has Soils Rating
  "b1000001-0001-4000-8000-000000000011", // Has Availability
  "b1000001-0001-4000-8000-000000000012", // Has Easy to Grow
  "b1000001-0001-4000-8000-000000000013", // Has Edible Plant
  "b1000001-0001-4000-8000-000000000014", // Has Climate Rating
  "b1000001-0001-4000-8000-000000000015", // Value Sum Total
]);

/**
 * Resolve a source column name to its production attribute mapping.
 * Returns undefined if no mapping exists (unmapped raw source column).
 */
export function resolveAttribute(
  sourceColumn: string
): AttributeMapping | undefined {
  return COLUMN_TO_ATTRIBUTE[sourceColumn.toLowerCase()];
}

/**
 * Check if an attribute UUID is calculated (should be read-only).
 */
export function isCalculatedAttribute(attributeId: string): boolean {
  return CALCULATED_ATTRIBUTE_IDS.has(attributeId);
}
