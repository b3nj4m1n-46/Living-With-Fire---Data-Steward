-- =============================================================================
-- Claim/Warrant Tables for DoltgreSQL Staging Database
-- Converted from docs/planning/PROPOSALS-SCHEMA.md (MySQL → PostgreSQL syntax)
-- Run against: postgresql://doltgres@localhost:5433/lwf_staging
-- =============================================================================

-- warrants — source evidence for plant+attribute pairs
CREATE TABLE warrants (
  id                    VARCHAR(36) PRIMARY KEY,
  warrant_type          VARCHAR(20) NOT NULL,         -- valid: 'existing', 'external', 'research'
  status                VARCHAR(20) DEFAULT 'unreviewed', -- valid: 'unreviewed', 'included', 'excluded', 'flagged'

  -- What plant+attribute this warrant is about
  plant_id              VARCHAR(36),                  -- FK to plants.id (NULL for unmatched new plants)
  plant_genus           VARCHAR(255),                 -- denormalized for display
  plant_species         VARCHAR(255),
  attribute_id          VARCHAR(36) NOT NULL,         -- FK to attributes.id
  attribute_name        VARCHAR(255),                 -- denormalized for display

  -- The evidence
  "value"               TEXT NOT NULL,                -- normalized value for comparison
  source_value          TEXT,                         -- original value as it appeared in source
  value_context         TEXT,                         -- additional qualifiers

  -- Source provenance
  source_id             VARCHAR(36),                  -- FK to sources.id (for existing production values)
  source_dataset        VARCHAR(100),                 -- folder name: 'FirePerformancePlants'
  source_id_code        VARCHAR(20),                  -- source ID: 'FIRE-01'
  source_file           VARCHAR(255),                 -- 'plants.csv'
  source_row            INT,                          -- row number in source file
  source_column         VARCHAR(100),                 -- column name in source file

  -- Source metadata (cached from DATA-DICTIONARY.md for display)
  source_methodology    TEXT,
  source_region         VARCHAR(255),
  source_year           VARCHAR(10),
  source_reliability    VARCHAR(50),

  -- Taxonomy match
  match_method          VARCHAR(20) DEFAULT 'exact',  -- valid: 'exact', 'synonym', 'cultivar', 'genus_only', 'fuzzy'
  match_confidence      DECIMAL(3,2),

  -- Agent annotations
  conflict_ids          TEXT,                         -- JSON array of conflict IDs
  specialist_notes      TEXT,
  research_findings     TEXT,
  research_citations    TEXT,

  -- Admin curation
  admin_notes           TEXT,
  curated_by            VARCHAR(100),
  curated_at            TIMESTAMP,

  -- Tracking
  batch_id              VARCHAR(36),
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- conflicts — detected disagreements between warrants
CREATE TABLE conflicts (
  id                    VARCHAR(36) PRIMARY KEY,
  conflict_type         VARCHAR(50) NOT NULL,         -- from CONFLICT-TAXONOMY.md
  conflict_mode         VARCHAR(20) NOT NULL,         -- valid: 'internal', 'external', 'cross_source'
  severity              VARCHAR(20) DEFAULT 'moderate', -- valid: 'critical', 'moderate', 'minor'
  status                VARCHAR(20) DEFAULT 'pending', -- valid: 'pending', 'annotated', 'resolved', 'dismissed'

  -- The disagreeing warrants
  warrant_a_id          VARCHAR(36) NOT NULL,         -- FK to warrants.id
  warrant_b_id          VARCHAR(36) NOT NULL,         -- FK to warrants.id

  -- Context (denormalized for display)
  plant_id              VARCHAR(36) NOT NULL,
  plant_name            VARCHAR(255),
  attribute_name        VARCHAR(255),
  value_a               TEXT,
  value_b               TEXT,
  source_a              VARCHAR(255),
  source_b              VARCHAR(255),

  -- Classifier output
  classifier_explanation TEXT,

  -- Specialist output
  specialist_agent      VARCHAR(50),
  specialist_verdict    VARCHAR(20),                  -- valid: 'REAL', 'APPARENT', 'NUANCED'
  specialist_analysis   TEXT,
  specialist_recommendation VARCHAR(30),              -- valid: 'PREFER_A', 'PREFER_B', 'KEEP_BOTH', 'KEEP_BOTH_WITH_CONTEXT', 'NEEDS_RESEARCH', 'HUMAN_DECIDE'

  -- Tracking
  batch_id              VARCHAR(36),
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  annotated_at          TIMESTAMP
);

-- claims — finalized synthesized production values
CREATE TABLE claims (
  id                    VARCHAR(36) PRIMARY KEY,
  status                VARCHAR(20) DEFAULT 'draft',  -- valid: 'draft', 'approved', 'pushed', 'reverted'

  -- What this claim is about
  plant_id              VARCHAR(36) NOT NULL,
  attribute_id          VARCHAR(36) NOT NULL,
  plant_name            VARCHAR(255),
  attribute_name        VARCHAR(255),

  -- The synthesized value
  categorical_value     TEXT,
  synthesized_text      TEXT NOT NULL,
  suggested_notes       TEXT,
  confidence            VARCHAR(10) NOT NULL,         -- valid: 'HIGH', 'MODERATE', 'LOW'
  confidence_reasoning  TEXT,

  -- What it replaces
  previous_value        TEXT,
  previous_source       VARCHAR(255),
  changes_description   TEXT,

  -- Synthesis provenance
  synthesis_prompt      TEXT,
  synthesis_model       VARCHAR(50),
  warrant_count         INT,

  -- Admin review
  approved_by           VARCHAR(100),
  approved_at           TIMESTAMP,
  approval_notes        TEXT,
  edited_value          TEXT,

  -- Dolt tracking
  dolt_commit_hash      VARCHAR(64),
  pushed_to_production  BOOLEAN DEFAULT FALSE,
  pushed_at             TIMESTAMP,

  -- Tracking
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- claim_warrants — junction linking claims to supporting warrants
CREATE TABLE claim_warrants (
  id                    VARCHAR(36) PRIMARY KEY,
  claim_id              VARCHAR(36) NOT NULL,         -- FK to claims.id
  warrant_id            VARCHAR(36) NOT NULL,         -- FK to warrants.id
  inclusion_reason      TEXT,
  UNIQUE (claim_id, warrant_id)
);

-- analysis_batches — tracking analysis runs
CREATE TABLE analysis_batches (
  id                    VARCHAR(36) PRIMARY KEY,
  source_dataset        VARCHAR(100) NOT NULL,
  source_id_code        VARCHAR(20) NOT NULL,
  batch_type            VARCHAR(30) NOT NULL,         -- valid: 'internal_scan', 'external_analysis', 'cross_source', 'bulk_enhance'

  -- Progress
  started_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at          TIMESTAMP,
  status                VARCHAR(20) DEFAULT 'running', -- valid: 'running', 'completed', 'failed'

  -- Results
  total_source_records  INT,
  plants_matched        INT,
  plants_unmatched      INT,
  warrants_created      INT,
  conflicts_detected    INT,
  claims_generated      INT,

  -- Agent metadata
  agent_model           VARCHAR(50),
  agent_flows_used      TEXT,                         -- JSON array of Genkit flows
  taxonomy_stats        TEXT,                         -- JSON: match method distribution
  notes                 TEXT,
  dolt_commit_hash      VARCHAR(64)
);

-- =============================================================================
-- Indexes
-- =============================================================================

-- warrants
CREATE INDEX idx_warrants_status ON warrants(status);
CREATE INDEX idx_warrants_plant ON warrants(plant_id);
CREATE INDEX idx_warrants_attribute ON warrants(attribute_id);
CREATE INDEX idx_warrants_dataset ON warrants(source_dataset);
CREATE INDEX idx_warrants_plant_attr ON warrants(plant_id, attribute_id);

-- conflicts
CREATE INDEX idx_conflicts_status ON conflicts(status);
CREATE INDEX idx_conflicts_plant ON conflicts(plant_id);
CREATE INDEX idx_conflicts_severity ON conflicts(severity);
CREATE INDEX idx_conflicts_type ON conflicts(conflict_type);
CREATE INDEX idx_conflicts_warrant_a ON conflicts(warrant_a_id);
CREATE INDEX idx_conflicts_warrant_b ON conflicts(warrant_b_id);

-- claims
CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_claims_plant ON claims(plant_id);
CREATE INDEX idx_claims_attribute ON claims(attribute_id);
CREATE INDEX idx_claims_plant_attr ON claims(plant_id, attribute_id);

-- claim_warrants
CREATE INDEX idx_cw_claim ON claim_warrants(claim_id);
CREATE INDEX idx_cw_warrant ON claim_warrants(warrant_id);

-- analysis_batches
CREATE INDEX idx_batches_dataset ON analysis_batches(source_dataset);
CREATE INDEX idx_batches_status ON analysis_batches(status);
