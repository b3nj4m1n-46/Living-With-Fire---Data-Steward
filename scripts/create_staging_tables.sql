-- =============================================================================
-- Production Mirror Tables for DoltgreSQL Staging Database
-- Schemas match actual CSV headers in LivingWithFire-DB/
-- Run against: postgresql://doltgres@localhost:5433/lwf_staging
-- =============================================================================

-- plants (1,361 records)
CREATE TABLE plants (
  id                    VARCHAR(36) PRIMARY KEY,
  genus                 VARCHAR(255) NOT NULL,
  species               VARCHAR(255),
  subspecies_varieties  TEXT,
  common_name           TEXT,
  notes                 TEXT,
  last_updated          TIMESTAMP,
  urls                  TEXT
);

-- attributes (125 records)
CREATE TABLE attributes (
  id                    VARCHAR(36) PRIMARY KEY,
  name                  VARCHAR(255) NOT NULL,
  parent_attribute_id   VARCHAR(36),
  value_type            VARCHAR(50),
  values_allowed        TEXT,
  value_units           VARCHAR(100),
  notes                 TEXT,
  selection_type        VARCHAR(50)
);

-- sources (103 records)
CREATE TABLE sources (
  id                    VARCHAR(36) PRIMARY KEY,
  name                  VARCHAR(255) NOT NULL,
  url                   TEXT,
  address               TEXT,
  phone                 VARCHAR(50),
  notes                 TEXT,
  region                VARCHAR(255),
  target_location       TEXT,
  topics_addressed      TEXT,
  attribution           TEXT,
  ref_code              VARCHAR(50),
  file_link             TEXT
);

-- "values" (94,903 records) — quoted: reserved word in PostgreSQL
CREATE TABLE "values" (
  id                    VARCHAR(36) PRIMARY KEY,
  attribute_id          VARCHAR(36) NOT NULL,
  plant_id              VARCHAR(36) NOT NULL,
  "value"               TEXT,
  source_id             VARCHAR(36),
  notes                 TEXT,
  source_value          TEXT,
  metadata              TEXT,
  urls                  TEXT
);

-- attribute_sources (39 records)
CREATE TABLE attribute_sources (
  id                    VARCHAR(36) PRIMARY KEY,
  attribute_id          VARCHAR(36),
  source_id             VARCHAR(36),
  values_allowed        TEXT,
  value_notes           TEXT,
  notes                 TEXT
);

-- nurseries (13 records)
CREATE TABLE nurseries (
  id                    VARCHAR(36) PRIMARY KEY,
  name                  VARCHAR(255),
  address               TEXT,
  phone                 VARCHAR(50),
  url                   TEXT,
  notes                 TEXT
);

-- plant_nurseries (3 records)
CREATE TABLE plant_nurseries (
  id                    VARCHAR(36) PRIMARY KEY,
  plant_id              VARCHAR(36),
  nursery_id            VARCHAR(36),
  available_since       VARCHAR(50),
  notes                 TEXT
);

-- plant_images (4,709 records)
CREATE TABLE plant_images (
  id                    VARCHAR(36) PRIMARY KEY,
  plant_id              VARCHAR(36),
  source                VARCHAR(50),
  source_id             VARCHAR(100),
  source_slug           VARCHAR(255),
  image_url             TEXT,
  image_type            VARCHAR(50),
  is_primary            VARCHAR(10),
  copyright             TEXT,
  fetched_at            TIMESTAMP,
  verified_at           TIMESTAMP,
  match_score           VARCHAR(20),
  match_field           VARCHAR(50),
  needs_verification    VARCHAR(10),
  verified_by           VARCHAR(100)
);

-- plant_research (91 records)
CREATE TABLE plant_research (
  id                    VARCHAR(36) PRIMARY KEY,
  plant_id              VARCHAR(36),
  oregon_url            TEXT,
  oregon_description    TEXT,
  description_fetched_at TIMESTAMP,
  ai_recommendations    TEXT,
  ai_generated_at       TIMESTAMP,
  review_status         VARCHAR(50),
  reviewed_at           TIMESTAMP,
  reviewed_by           VARCHAR(100),
  review_notes          TEXT,
  created_at            TIMESTAMP,
  updated_at            TIMESTAMP,
  not_found_on_oregon   VARCHAR(10)
);

-- filter_presets (19 records)
CREATE TABLE filter_presets (
  id                    VARCHAR(36) PRIMARY KEY,
  name                  VARCHAR(255),
  description           TEXT,
  filters               TEXT,
  is_default            VARCHAR(10),
  sort_order            INT,
  created_at            TIMESTAMP,
  updated_at            TIMESTAMP,
  created_by            VARCHAR(100),
  columns               TEXT,
  show_on_home_page     VARCHAR(10),
  show_in_generator     VARCHAR(10)
);

-- key_terms (34 records)
CREATE TABLE key_terms (
  id                    VARCHAR(36) PRIMARY KEY,
  term                  VARCHAR(255),
  definition            TEXT,
  sort_order            INT,
  updated_at            TIMESTAMP,
  updated_by            VARCHAR(100)
);

-- resource_sections (16 records)
CREATE TABLE resource_sections (
  id                    VARCHAR(36) PRIMARY KEY,
  title                 VARCHAR(255),
  description           TEXT,
  subsections           TEXT,
  links                 TEXT,
  sort_order            INT,
  created_at            TIMESTAMP,
  updated_at            TIMESTAMP,
  created_by            VARCHAR(100)
);

-- risk_reduction_snippets (14 records)
CREATE TABLE risk_reduction_snippets (
  id                    VARCHAR(36) PRIMARY KEY,
  "key"                 VARCHAR(100),
  "text"                TEXT,
  description           TEXT,
  sort_order            INT,
  updated_at            TIMESTAMP,
  updated_by            VARCHAR(100)
);

-- =============================================================================
-- Indexes
-- =============================================================================

CREATE INDEX idx_values_plant ON "values"(plant_id);
CREATE INDEX idx_values_attribute ON "values"(attribute_id);
CREATE INDEX idx_values_source ON "values"(source_id);
CREATE INDEX idx_values_plant_attr ON "values"(plant_id, attribute_id);
CREATE INDEX idx_plants_genus ON plants(genus);
CREATE INDEX idx_plants_species ON plants(species);
CREATE INDEX idx_attr_name ON attributes(name);
CREATE INDEX idx_attr_parent ON attributes(parent_attribute_id);
CREATE INDEX idx_sources_name ON sources(name);
CREATE INDEX idx_plant_images_plant ON plant_images(plant_id);
CREATE INDEX idx_plant_research_plant ON plant_research(plant_id);
CREATE INDEX idx_attr_sources_attr ON attribute_sources(attribute_id);
CREATE INDEX idx_attr_sources_source ON attribute_sources(source_id);
