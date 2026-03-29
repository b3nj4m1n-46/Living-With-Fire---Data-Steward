# Demo Polish — Seed Data, Narrative, UI Cleanup

> **Status:** COMPLETED
> **Commit:** 7bf69b1
> **Priority:** P2 (normal)
> **Depends on:** 014-specialist-agents, 015-synthesis-agent, 016-dolt-version-control-ui, 017-extract-agent-prompts, 018-production-sync (features to demo must exist)
> **Blocks:** None

## Problem

The system works end-to-end but needs curated demo scenarios and UI polish to tell a compelling story. Raw pipeline output is noisy — a demo needs hand-picked examples that showcase the Claim/Warrant model's strengths: conflicting evidence from multiple sources, specialist resolution, AI synthesis, and version-controlled curation.

## Current Implementation

### What Exists
- Full pipeline: 94,903 bootstrapped warrants + FIRE-01 + WATER-01 external warrants + internal/external conflicts
- Admin portal with dashboard, claim curation, conflict queue, history
- Specialist agents for rating + scope conflicts (from 014)
- Synthesis agent (from 015)
- Dolt version control UI (from 016)
- Real conflict data from internal scan and external analysis

### What Does NOT Exist Yet
- Curated demo scenarios with compelling narratives
- Demo walkthrough script
- UI polish: loading states, error handling, empty states
- Hackathon README

## Proposed Changes

### 1. Seed Demo Scenarios (T53)

Identify and prepare 2-3 compelling conflict examples from the real data:

**Scenario A: Juniper Flammability Conflict (Rating + Scope)**
- Plant: *Juniperus scopulorum* or similar Juniper species
- Conflict: One source rates it fire-resistant (landscape use context), another rates it highly flammable (wildfire research context)
- Demonstrates: rating disagreement + scope difference — same plant, contradictory values, both technically correct in their context
- Specialist resolution: NUANCED — fire-resistant as maintained landscape plant, flammable in wildfire conditions
- Synthesis: produces nuanced claim citing both contexts

**Scenario B: Ceanothus Multi-Warrant Synthesis (4+ warrants → 1 rich claim)**
- Plant: *Ceanothus thyrsiflorus* or similar
- Attribute: Flammability or deer resistance
- Multiple sources with compatible-but-different data
- Demonstrates: warrant selection, AI synthesis merging 4 sources into one rich claim with proper citations
- Shows the value of the Claim/Warrant model over simple majority-vote

**Scenario C: Invasiveness Temporal Conflict (1997 vs 2024)**
- Plant: A species whose invasiveness status has changed over time
- Demonstrates: temporal conflict — old source says "not invasive," new source says "watch list"
- Specialist resolution: prefer more recent data, note the temporal evolution

For each scenario:
- Verify the data exists in DoltgreSQL (query for the specific plant+attribute+sources)
- If needed, ensure the relevant external analysis has been run
- Run specialist agents on the conflicts
- Document the expected demo flow

### 2. Demo Script (T54)

`docs/DEMO-SCRIPT.md`:

A narrative walkthrough document for presenting the system:

1. **Open** — Dashboard showing system overview (X warrants, Y conflicts, Z datasets)
2. **Problem** — Show the conflict queue: "Here are real conflicts detected automatically across 40 datasets"
3. **Investigate** — Click into Scenario A (Juniper) → show conflicting warrant cards → click Research → show methodology context
4. **Resolve** — Show specialist verdict → select warrants → Synthesize → show AI output
5. **Approve** — Edit claim → Approve → show Dolt commit in history
6. **Undo** — Demonstrate revert capability: "Made a mistake? One click to undo"
7. **Scale** — Return to dashboard: "94,903 values from 40 datasets, all tracked"

### 3. UI Cleanup (T55)

Sweep through the portal and add:

- **Loading states** — skeleton loaders for tables and cards while data fetches
- **Error handling** — toast notifications for API errors, friendly error messages
- **Empty states** — meaningful messages when no data matches filters ("No critical conflicts found — nice!")
- **Responsive tweaks** — ensure sidebar collapses on narrow viewports (if not already)

### 4. Hackathon README (T56)

`README-HACKATHON.md` (or update root `README.md`):

- Project title + one-line description
- Screenshot of the dashboard
- Quick start: how to run DoltgreSQL + Genkit + Admin Portal
- Architecture diagram (text-based)
- What it does: 40 datasets → warrants → conflict detection → AI synthesis → version-controlled claims
- Tech stack: Next.js 14, DoltgreSQL, Genkit, Anthropic Claude, shadcn/ui

### What Does NOT Change

- Pipeline logic — all flows and scripts unchanged
- DoltgreSQL schema — no changes
- Existing data — demo scenarios use existing real data

## Migration Strategy

1. Query DoltgreSQL to identify the best real examples for each demo scenario
2. Run specialist agents on chosen conflicts (if not already run)
3. Write demo script document
4. Add loading skeletons to table/card components
5. Add error boundaries and toast notifications
6. Add empty state messages
7. Write hackathon README
8. Do a full dry-run of the demo script end-to-end

## Files Modified

### New Files
- `docs/DEMO-SCRIPT.md` — presentation narrative
- `README-HACKATHON.md` — hackathon-specific quick start (or section in root README)

### Modified Files
- `admin/src/components/batches-table.tsx` — add loading skeleton
- `admin/src/components/summary-cards.tsx` — add loading skeleton
- `admin/src/app/conflicts/conflicts-table.tsx` — add loading/empty states
- `admin/src/app/claims/page.tsx` — add loading/empty states
- `admin/src/app/layout.tsx` — add toast provider (if not already)
- Various API routes — add consistent error responses with toast-friendly messages

## Verification

1. **Demo scenarios work end-to-end:**
   - Walk through each scenario (A, B, C) following the demo script
   - Every click produces the expected result — no errors, no missing data

2. **Loading states visible:** Throttle network → verify skeleton loaders appear before data

3. **Error handling works:** Disconnect DoltgreSQL → verify friendly error message (not raw stack trace)

4. **Empty states show:** Apply a filter that matches nothing → verify meaningful empty message

5. **README is accurate:** Follow the quick start steps on a clean terminal → system starts and runs
