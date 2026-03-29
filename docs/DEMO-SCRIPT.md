# LWF Admin Portal — Demo Script

A narrative walkthrough for presenting the Living With Fire data fusion platform. This script covers three seed scenarios that showcase the Claim/Warrant model's strengths.

---

## Pre-Demo Checklist

- [ ] DoltgreSQL running on port 5433 with warrants, conflicts, and claims tables populated
- [ ] Admin portal running (`cd admin && npm run dev`)
- [ ] At least 2 external analyses completed (FIRE-01, WATER-01)
- [ ] Browser sized for desktop (sidebar visible)

---

## Act 1: The Scale of the Problem

**Open the Dashboard** (`/`)

> "We're building a plant selection tool for fire-wise, drought-tolerant, wildlife-friendly landscaping in the Pacific West. To do that right, we've collected data from 40 separate databases — federal agencies, universities, extension services, conservation organizations — totaling over 866,000 records."

Point out the summary cards:

- **Total Warrants** — every piece of evidence from every source, tagged with provenance
- **Pending Conflicts** — real disagreements detected automatically across sources
- **Datasets Processed** — how many of the 40 sources have been analyzed
- **Pending Sync** — curated claims ready to push to the production app

> "The problem? These 40 sources don't agree. Same plant, different ratings, different scales, different contexts. A human can't review 94,903 values manually. That's what this system solves."

---

## Act 2: Conflict Discovery

**Navigate to Conflicts** (`/conflicts`)

> "Our pipeline automatically detects conflicts when a plant has contradictory data across sources. Let me show you the most interesting one."

### Scenario A: Juniper Flammability Conflict

**Filter** by plant name or find a Juniperus conflict in the queue.

> "Juniper is a perfect example. One fire-resistance database rates it as 'not firewise' — highly flammable. Another rates it as suitable for fire-safe landscaping. Both are technically correct — it depends on context."

**Expand the conflict row** to show:

1. **Two warrant cards side-by-side** — different sources, different values, both with citations
2. **Classifier explanation** — why the AI flagged this as a rating + scope conflict
3. **Severity badge** — critical, because fire safety is life-safety

> "Every piece of evidence is a 'warrant' — a sourced, cited data point. The system doesn't average them or pick one. It presents both and asks: what's actually going on here?"

**Click "Research"** to show the ResearchPanel:

> "We can pull in the original data dictionaries and research papers for context. This shows us that Source A was testing landscape-maintained plants, while Source B tested wild conditions."

---

## Act 3: AI-Assisted Resolution

**Still on the Juniper conflict:**

> "Now we bring in the AI specialist."

**Click to run Specialist Analysis** (if not already run):

- Show the **verdict**: NUANCED
- Show the **recommendation**: "Fire-resistant as maintained landscape plant; flammable in wildfire/wildland conditions"
- Show the **confidence** and reasoning

> "The specialist doesn't just pick a winner. It says 'both are right, but in different contexts.' That's the kind of nuance you can't get from a simple majority vote."

**Select warrants** to include, then **click Synthesize**:

- Show the AI-generated synthesis merging both perspectives
- Show the **categorical value** it suggests
- Show the **confidence score** and which sources were cited

> "The synthesis produces a single rich claim that cites both sources and captures the nuance. A human curator reviews this and decides whether to approve."

---

## Act 4: Multi-Source Synthesis

### Scenario B: Ceanothus Cross-Domain Evidence

**Navigate to Claims** (`/claims`) and find a Ceanothus entry.

> "Ceanothus — California lilac — appears in over 15 records across 5 different database categories: fire resistance, deer resistance, water use, native status, and pollinator value."

**Click into the claim detail view:**

- Show **warrant cards grouped by source** — fire databases, deer databases, water databases
- Show how each source provides different but complementary information

> "This is the power of the Claim/Warrant model. Instead of one flat row in a spreadsheet, we have structured evidence from every source, each tagged with its provenance, methodology, and reliability."

**Run synthesis** on a multi-warrant attribute:

> "The synthesis agent weighs 4+ warrants and produces one rich claim. It cites all sources and explains how it resolved any differences. The curator can adjust warrant weights or exclude sources before approving."

---

## Act 5: Version Control

### Every Change is Tracked

**Navigate to History** (`/history`)

> "Every action in this system — creating warrants, resolving conflicts, approving claims — is a versioned commit in Dolt, our version-controlled database."

**Click into a commit** to show the diff:

- Show **tables changed** (warrants, conflicts, claims)
- Show **row-level diffs** with before/after values
- Show the commit message and timestamp

> "This is git for your data. You can see exactly what changed, when, and why."

### Scenario: Undo a Mistake

**Click "Undo"** on a recent commit:

> "Made a mistake? One click to revert. The revert itself is a new commit — nothing is ever lost."

---

## Act 6: Production Push

**Navigate to Sync** (`/sync`)

> "Once claims are approved, they're ready to push to the production database — the one the public app reads from."

**Show the sync preview:**

- **Current value** vs **new value** for each claim
- **Confidence score** from the synthesis

> "The curator sees exactly what will change in production before pushing. This is a preview-first workflow — no surprises."

**Push to production** (or describe the flow):

> "One click pushes approved claims to Neon PostgreSQL. The push is recorded as both a Dolt commit and a sync event. Full audit trail."

---

## Act 7: The Big Picture

**Return to Dashboard** (`/`)

> "40 databases. 866,000 source records. 94,903 production values. Every one tracked, every conflict surfaced, every resolution documented. AI does the heavy lifting — humans make the final call. That's the Living With Fire data fusion platform."

---

## Seed Scenarios Reference

### Scenario A: Juniper Flammability (Rating + Scope Conflict)

| Field | Value |
|-------|-------|
| Plant | *Juniperus* spp. (e.g., *J. scopulorum*, *J. chinensis*) |
| Attribute | Fire resistance / Flammability |
| Sources | FirePerformancePlants (FIRE-01), IdahoFirewise (FIRE-06), OSU_PNW590 (FIRE-04), NIST_USDA_Flammability (FIRE-08) |
| Conflict type | Rating disagreement + Scope difference |
| Expected verdict | NUANCED — context-dependent |

### Scenario B: Ceanothus Multi-Warrant Synthesis

| Field | Value |
|-------|-------|
| Plant | *Ceanothus thyrsiflorus* or *C. velutinus* |
| Attribute | Multiple (fire, deer, water) |
| Sources | FIRE-01, DEER-02/03/04/05, WATER-01 |
| Conflict type | Complementary evidence (not contradictory) |
| Expected outcome | Rich synthesized claim citing 4+ sources |

### Scenario C: Invasiveness Temporal/Scope Conflict

| Field | Value |
|-------|-------|
| Plant | Species with changing invasive status |
| Attribute | Invasiveness classification |
| Sources | USGA_RIIS (INVAS-01), Cal-IPC (INVAS-02) |
| Conflict type | Temporal (old vs new assessment) or Scope (federal vs state) |
| Expected verdict | Prefer more recent data, note temporal evolution |

---

## Talking Points

- **Why not just average ratings?** Different scales, different contexts. "Fire-resistant" in a maintained landscape is not the same as "fire-resistant" in a wildfire. The Claim/Warrant model preserves this nuance.
- **Why version control for data?** Same reason as code — you need to know what changed, when, and why. Especially when AI is involved in curation decisions.
- **How does this scale?** The pipeline processes entire datasets at once. 541 plants from FirePerformancePlants took one analysis batch. The remaining 38 datasets follow the same pattern.
- **What's the AI doing vs the human?** AI detects conflicts, classifies them, analyzes context, and drafts syntheses. Humans review, adjust, and approve. The AI accelerates; the human ensures quality.
