"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { WarrantCard } from "@/components/warrant-card";
import { ResearchPanel } from "../research-panel";
import { toast } from "sonner";
import type { ClaimViewData, WarrantDetail, PlantInfo, ConflictSummary } from "@/lib/queries/claims";
import type { PlantConflictAttribute } from "@/lib/queries/conflicts";

interface AttributeData extends ClaimViewData {
  attributeMeta: PlantConflictAttribute;
}

interface PlantConflictsClientProps {
  plantId: string;
  plant: PlantInfo | null;
  totalConflicts: number;
  totalUnresolved: number;
  attributeDataList: AttributeData[];
}

function severityVariant(severity: string) {
  switch (severity) {
    case "critical":
      return "destructive" as const;
    case "moderate":
      return "outline" as const;
    default:
      return "secondary" as const;
  }
}

function severityClassName(severity: string) {
  if (severity === "moderate") {
    return "border-yellow-500 text-yellow-700 dark:text-yellow-400";
  }
  return undefined;
}

function statusVariant(status: string) {
  switch (status) {
    case "resolved":
      return "default" as const;
    case "dismissed":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

function claimStatusVariant(status: string | null) {
  switch (status) {
    case "approved":
      return "default" as const;
    case "pushed":
      return "secondary" as const;
    case "draft":
      return "outline" as const;
    case "reverted":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

function groupWarrants(warrants: WarrantDetail[]) {
  const existing: WarrantDetail[] = [];
  const bySource: Record<string, WarrantDetail[]> = {};

  for (const w of warrants) {
    if (w.warrant_type === "existing") {
      existing.push(w);
    } else {
      const key = w.source_id_code ?? w.source_dataset ?? "Other";
      if (!bySource[key]) bySource[key] = [];
      bySource[key].push(w);
    }
  }

  return { existing, bySource };
}

export function PlantConflictsClient({
  plantId,
  plant,
  totalConflicts,
  totalUnresolved,
  attributeDataList,
}: PlantConflictsClientProps) {
  const plantName = plant
    ? `${plant.genus} ${plant.species ?? ""}`.trim()
    : plantId;
  const commonName = plant?.common_name;

  // Default: expand first section with unresolved conflicts
  const firstUnresolved = attributeDataList.findIndex(
    (a) => a.attributeMeta.unresolved_count > 0
  );
  const [expandedSections, setExpandedSections] = useState<Set<number>>(
    new Set(firstUnresolved >= 0 ? [firstUnresolved] : [0])
  );

  function toggleSection(index: number) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/conflicts"
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to Conflict Queue
        </Link>
        <h2 className="mt-2 text-2xl font-bold italic">{plantName}</h2>
        {commonName && (
          <p className="text-muted-foreground">{commonName}</p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          {totalConflicts} conflict{totalConflicts !== 1 ? "s" : ""} across{" "}
          {attributeDataList.length} attribute
          {attributeDataList.length !== 1 ? "s" : ""} &middot;{" "}
          {totalUnresolved} unresolved
        </p>
      </div>

      {/* Per-attribute sections */}
      {attributeDataList.map((attrData, index) => (
        <AttributeConflictSection
          key={attrData.attributeMeta.attribute_name}
          plantId={plantId}
          plantName={plantName}
          data={attrData}
          isExpanded={expandedSections.has(index)}
          onToggle={() => toggleSection(index)}
        />
      ))}

      {attributeDataList.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No conflicting attributes found for this plant.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Per-Attribute Section ────────────────────────────────────────────────

interface AttributeConflictSectionProps {
  plantId: string;
  plantName: string;
  data: AttributeData;
  isExpanded: boolean;
  onToggle: () => void;
}

function AttributeConflictSection({
  plantId,
  plantName,
  data,
  isExpanded,
  onToggle,
}: AttributeConflictSectionProps) {
  const router = useRouter();
  const { attributeMeta } = data;
  const attributeName = data.attribute?.name ?? attributeMeta.attribute_name;
  const attributeId = attributeMeta.attribute_id ?? "";

  const [warrants, setWarrants] = useState(data.warrants);
  const [approvalNotes, setApprovalNotes] = useState("");
  const [synthesisResult, setSynthesisResult] = useState<{
    synthesized_text: string;
    categorical_value: string | null;
    confidence: string;
    confidence_reasoning: string;
  } | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const [approving, setApproving] = useState(false);

  const includedWarrants = warrants.filter((w) => w.status === "included");
  const { existing, bySource } = groupWarrants(warrants);
  const hasUnresolved = attributeMeta.unresolved_count > 0;

  function handleWarrantStatusChange(warrantId: string, newStatus: string) {
    setWarrants((prev) =>
      prev.map((w) => (w.id === warrantId ? { ...w, status: newStatus } : w))
    );
  }

  async function handleQuickAction(conflictId: string, status: string) {
    try {
      const res = await fetch(`/api/conflicts/${conflictId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Conflict ${status}`);
      router.refresh();
    } catch {
      toast.error("Failed to update conflict");
    }
  }

  async function handleSynthesize() {
    const warrantIds = includedWarrants.map((w) => w.id);
    if (warrantIds.length === 0) {
      toast.error("Select at least one warrant to synthesize");
      return;
    }

    setSynthesizing(true);
    try {
      const res = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plantId, attributeId, warrantIds }),
      });
      if (!res.ok) throw new Error("Synthesis failed");
      const result = await res.json();
      setSynthesisResult(result);
    } catch {
      toast.error("Failed to generate synthesis");
    } finally {
      setSynthesizing(false);
    }
  }

  async function handleApprove() {
    const warrantIds = includedWarrants.map((w) => w.id);
    if (warrantIds.length === 0) {
      toast.error("Select at least one warrant to approve");
      return;
    }

    setApproving(true);
    try {
      const res = await fetch("/api/claims/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plantId,
          attributeId,
          plantName,
          attributeName,
          warrantIds,
          synthesizedText: synthesisResult?.synthesized_text ?? null,
          categoricalValue: synthesisResult?.categorical_value ?? null,
          confidence: synthesisResult?.confidence ?? "MODERATE",
          confidenceReasoning: synthesisResult?.confidence_reasoning ?? null,
          approvalNotes: approvalNotes || null,
          editedValue: null,
        }),
      });
      if (!res.ok) throw new Error("Approval failed");
      const { commitHash } = await res.json();
      toast.success(`Claim approved! Commit: ${commitHash.slice(0, 8)}...`);
      router.refresh();
    } catch {
      toast.error("Failed to approve claim");
    } finally {
      setApproving(false);
    }
  }

  return (
    <Card id={attributeMeta.attribute_name}>
      {/* Section header — always visible */}
      <CardHeader
        className="cursor-pointer select-none"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isExpanded ? (
              <ChevronDown className="size-5 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-5 text-muted-foreground" />
            )}
            <CardTitle className="text-base">{attributeName}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={severityVariant(attributeMeta.max_severity)}
              className={severityClassName(attributeMeta.max_severity)}
            >
              {attributeMeta.conflict_count} conflict
              {attributeMeta.conflict_count !== 1 ? "s" : ""}
            </Badge>
            {hasUnresolved ? (
              <Badge variant="outline">
                {attributeMeta.unresolved_count} unresolved
              </Badge>
            ) : (
              <Badge variant="default">resolved</Badge>
            )}
            <Badge variant="secondary">
              {warrants.length} warrant{warrants.length !== 1 ? "s" : ""}
            </Badge>
            {data.claim && (
              <Badge variant={claimStatusVariant(data.claim.status)}>
                {data.claim.status}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Expanded content */}
      {isExpanded && (
        <CardContent className="space-y-6 pt-0">
          {/* Existing claim info */}
          {data.claim && (
            <div className="rounded-md border bg-muted/30 px-4 py-3">
              <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                Existing Claim
              </p>
              <p className="text-sm">{data.claim.synthesized_text}</p>
              <div className="mt-2 flex gap-2">
                <Badge variant="outline">
                  Confidence: {data.claim.confidence}
                </Badge>
                {data.claim.dolt_commit_hash && (
                  <Badge variant="outline">
                    Commit: {data.claim.dolt_commit_hash.slice(0, 8)}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Production value */}
          {data.productionValue && (
            <div className="text-sm">
              <span className="text-muted-foreground">Production value: </span>
              <span className="font-medium">{data.productionValue}</span>
            </div>
          )}

          {/* Conflicts */}
          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase text-muted-foreground">
              Conflicts
            </p>
            {data.conflicts.map((conflict) => (
              <ConflictCard
                key={conflict.id}
                conflict={conflict}
                warrants={warrants}
                plantName={plantName}
                attributeName={attributeName}
                onQuickAction={handleQuickAction}
              />
            ))}
          </div>

          <Separator />

          {/* Warrants — Existing */}
          {existing.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Existing Evidence</p>
              {existing.map((w) => (
                <WarrantCard
                  key={w.id}
                  warrant={w}
                  conflicts={data.conflicts.filter(
                    (c) => c.other_warrant_id === w.id
                  )}
                  onStatusChange={handleWarrantStatusChange}
                />
              ))}
            </div>
          )}

          {/* Warrants — External, grouped by source */}
          {Object.entries(bySource).map(([source, sourceWarrants]) => (
            <div key={source} className="space-y-3">
              <p className="text-sm font-semibold">{source}</p>
              {sourceWarrants.map((w) => (
                <WarrantCard
                  key={w.id}
                  warrant={w}
                  conflicts={data.conflicts.filter(
                    (c) => c.other_warrant_id === w.id
                  )}
                  onStatusChange={handleWarrantStatusChange}
                />
              ))}
            </div>
          ))}

          {warrants.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No warrants found for this attribute.
            </p>
          )}

          <Separator />

          {/* Synthesis */}
          <div className="space-y-3">
            <p className="text-sm font-semibold">Synthesis</p>
            {synthesisResult ? (
              <div className="rounded-md border bg-muted/30 px-4 py-3 space-y-2">
                <p className="text-sm">{synthesisResult.synthesized_text}</p>
                <Badge variant="outline">
                  Confidence: {synthesisResult.confidence}
                </Badge>
                {synthesisResult.confidence_reasoning && (
                  <p className="text-sm text-muted-foreground">
                    {synthesisResult.confidence_reasoning}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Include warrants above, then generate a synthesis.
              </p>
            )}
            <Button
              size="sm"
              onClick={handleSynthesize}
              disabled={synthesizing || includedWarrants.length === 0}
            >
              {synthesizing
                ? "Synthesizing..."
                : `Synthesize from ${includedWarrants.length} warrant${includedWarrants.length !== 1 ? "s" : ""}`}
            </Button>
          </div>

          {/* Approval */}
          <div className="space-y-3">
            <p className="text-sm font-semibold">Approve Claim</p>
            <Input
              placeholder="Approval notes (optional)..."
              value={approvalNotes}
              onChange={(e) => setApprovalNotes(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={approving || includedWarrants.length === 0}
              >
                {approving
                  ? "Approving..."
                  : `Approve with ${includedWarrants.length} warrant${includedWarrants.length !== 1 ? "s" : ""}`}
              </Button>
              {includedWarrants.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  Include at least one warrant
                </span>
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── Conflict Card ────────────────────────────────────────────────────────

interface ConflictCardProps {
  conflict: ConflictSummary;
  warrants: WarrantDetail[];
  plantName: string;
  attributeName: string;
  onQuickAction: (conflictId: string, status: string) => void;
}

function ConflictCard({
  conflict,
  warrants,
  plantName,
  attributeName,
  onQuickAction,
}: ConflictCardProps) {
  // Find the two warrants involved in this conflict
  // ConflictSummary from fetchClaimViewData includes warrant_a_id and warrant_b_id
  // but maps them as other_warrant_id. We need to look at the raw data.
  // The warrants involved are those whose IDs match the conflict's source values.
  const conflictWarrantA = warrants.find(
    (w) =>
      w.value === conflict.value_a &&
      (w.source_id_code === conflict.source_a ||
        w.source_dataset === conflict.source_a)
  );
  const conflictWarrantB = warrants.find(
    (w) =>
      w.value === conflict.value_b &&
      (w.source_id_code === conflict.source_b ||
        w.source_dataset === conflict.source_b)
  );

  return (
    <div className="rounded-md border bg-background p-4 space-y-3">
      {/* Conflict header */}
      <div className="flex items-center gap-2">
        <Badge
          variant={severityVariant(conflict.severity)}
          className={severityClassName(conflict.severity)}
        >
          {conflict.severity}
        </Badge>
        <span className="text-sm font-medium">
          {conflict.conflict_type.replace(/_/g, " ")}
        </span>
        <Badge variant={statusVariant(conflict.status)}>{conflict.status}</Badge>
      </div>

      {/* Values comparison */}
      <div className="text-sm">
        <span className="text-muted-foreground">{conflict.source_a}:</span>{" "}
        <span className="font-medium">{conflict.value_a ?? "—"}</span>
        <span className="mx-2 text-muted-foreground">vs</span>
        <span className="text-muted-foreground">{conflict.source_b}:</span>{" "}
        <span className="font-medium">{conflict.value_b ?? "—"}</span>
      </div>

      {/* Specialist verdict */}
      {conflict.specialist_verdict && (
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{conflict.specialist_verdict}</Badge>
            {conflict.specialist_recommendation && (
              <span className="text-sm text-muted-foreground">
                {conflict.specialist_recommendation}
              </span>
            )}
          </div>
          {conflict.specialist_analysis && (
            <p className="mt-1 text-sm text-muted-foreground">
              {conflict.specialist_analysis}
            </p>
          )}
        </div>
      )}

      {/* Research panel */}
      <ResearchPanel
        conflictId={conflict.id}
        sourceA={conflict.source_a}
        sourceB={conflict.source_b}
        plantName={plantName}
        attributeName={attributeName}
      />

      {/* Quick actions */}
      {(conflict.status === "pending" || conflict.status === "annotated") && (
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => onQuickAction(conflict.id, "resolved")}
          >
            Resolve
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onQuickAction(conflict.id, "dismissed")}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
