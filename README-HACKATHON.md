# LivinWitFire — Plant Data Fusion Platform

**AI-powered curation of 40 plant databases into one authoritative source for fire-wise, drought-tolerant, wildlife-friendly landscaping in the Pacific West.**

---

## The Problem

Building a reliable plant selection tool requires data from dozens of sources: federal fire research, university extension services, conservation organizations, water districts. We collected **40 databases with 866,000+ records** — but they disagree. Same plant, different fire ratings, different scales, different regional contexts. A human cannot manually review 94,903 data values.

## Our Solution

A **Claim/Warrant evidence model** with AI-assisted curation:

1. **Warrants** — every sourced data point, tagged with provenance, methodology, and region
2. **Conflict Detection** — AI automatically identifies contradictions across sources
3. **Specialist Analysis** — AI agents analyze conflicts with access to original research context
4. **Synthesis** — AI drafts rich claims citing multiple sources; humans review and approve
5. **Version Control** — every data change tracked as a Dolt commit (git for databases)

```
40 Source Databases (866K records)
        |
  [Match + Map]  ← Genkit agents
        |
  DoltgreSQL (version-controlled staging)
        |
  [Detect Conflicts]  ← Classifier agent
        |
  Admin Portal (curate + synthesize)
        |
  [Approve + Push]
        |
  Neon PostgreSQL (1,361 plants × 125 attributes)
        |
  Public App (lwf-app.vercel.app)
```

## Key Numbers

| Metric | Value |
|--------|-------|
| Source databases | 40 |
| Source records | 866,000+ |
| Production plants | 1,361 |
| Production attributes | 125 |
| Production values | 94,903 |
| Research documents | 52 |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Admin Portal | Next.js, React, Tailwind CSS, shadcn/ui |
| Staging Database | DoltgreSQL (version-controlled PostgreSQL) |
| Agent Pipeline | Genkit (TypeScript) |
| AI Models | Anthropic Claude (Haiku 4.5 for bulk, Sonnet 4.6 for synthesis) |
| Production Database | Neon PostgreSQL |
| Production App | Next.js on Vercel |

## Quick Start

### Prerequisites

- Node.js 20+
- DoltgreSQL installed and running on port 5433
- Anthropic API key

### 1. Start DoltgreSQL

```bash
# Initialize (first time only)
cd doltgresql && dolt init
# Import production mirror + warrants (see genkit/src/scripts/)
dolt sql-server --port 5433
```

### 2. Start the Admin Portal

```bash
cd admin
cp .env.example .env.local   # Add your DB connection + API keys
npm install
npm run dev                   # http://localhost:3000
```

### 3. Run the Agent Pipeline (optional)

```bash
cd genkit
cp .env.example .env          # Add Anthropic API key
npm install
npx tsx src/scripts/bootstrap-warrants.ts    # Convert production values → warrants
npx tsx src/scripts/internal-conflict-scan.ts # Detect internal conflicts
npx tsx src/scripts/external-analysis.ts     # Process a source dataset
```

## Demo Walkthrough

See [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md) for a guided narrative demo covering:

1. **Dashboard** — system overview with conflict stats
2. **Conflict Discovery** — Juniper flammability: same plant, contradictory fire ratings
3. **AI Resolution** — specialist analysis with NUANCED verdict
4. **Multi-Source Synthesis** — Ceanothus with 4+ warrants merged into one rich claim
5. **Version Control** — every change tracked, one-click revert
6. **Production Push** — preview-first sync to the public app

## Repository Structure

```
LivinWitFire/
├── admin/                  # Next.js admin portal
├── genkit/                 # AI agent pipeline (Genkit + Anthropic)
��── database-sources/       # 40 source datasets by category
│   ├── fire/               # 12 fire resistance datasets
│   ├���─ deer/               # 6 deer resistance datasets
│   ├── water/              # 3 water/drought datasets
│   ├── native/             # 4 native plant datasets
│   ├── invasive/           # 5 invasiveness datasets
│   ├── pollinators/        # 3 pollinator datasets
│   ├── birds/              # 2 bird/wildlife datasets
│   ├── traits/             # 2 plant trait datasets
│   └── taxonomy/           # 3 taxonomy backbones (362K+ records)
├── LivingWithFire-DB/      # Production database exports + API reference
├── knowledge-base/         # 52 research documents (PDFs, HTML)
├── data-sources/           # Provenance registry, crossref, literature triage
└── docs/                   # Planning, task specs, architecture
```

## How It Works

The **Claim/Warrant model** separates evidence from conclusions:

- A **warrant** is a single data point from a single source: "*Juniperus chinensis* is rated NOT Firewise (4) by FirePerformancePlants"
- A **claim** is the curated conclusion: "*Juniperus chinensis* is fire-resistant as a maintained landscape plant but highly flammable in wildfire conditions, based on evidence from FIRE-01, FIRE-06, FIRE-08"

When warrants disagree, the system detects a **conflict** and routes it to an AI specialist for analysis. The specialist considers source methodology, regional scope, temporal context, and the original research. A human curator reviews the AI's recommendation and approves the final claim.

Every step — warrant creation, conflict detection, specialist analysis, claim approval — is recorded as a **Dolt commit**, providing full audit trail and one-click revert.
