"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { WarrantCard } from "@/components/warrant-card";
import { toast } from "sonner";
import type { ClaimViewData, WarrantDetail } from "@/lib/queries/claims";

interface ClaimViewClientProps {
  data: ClaimViewData;
  plantId: string;
  attributeId: string;
}

function statusVariant(status: string | null) {
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

export function ClaimViewClient({
  data,
  plantId,
  attributeId,
}: ClaimViewClientProps) {
  const router = useRouter();
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

  const plantName = data.plant
    ? `${data.plant.genus} ${data.plant.species ?? ""}`.trim()
    : plantId;
  const commonName = data.plant?.common_name;
  const attributeName = data.attribute?.name ?? attributeId;

  const includedWarrants = warrants.filter((w) => w.status === "included");
  const { existing, bySource } = groupWarrants(warrants);

  function handleWarrantStatusChange(warrantId: string, newStatus: string) {
    setWarrants((prev) =>
      prev.map((w) => (w.id === warrantId ? { ...w, status: newStatus } : w))
    );
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

      const { claimId, commitHash } = await res.json();
      toast.success(`Claim approved! Commit: ${commitHash.slice(0, 8)}...`);
      router.refresh();
    } catch {
      toast.error("Failed to approve claim");
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Back link + Header */}
      <div>
        <Link
          href={`/conflicts/${plantId}`}
          className="text-sm text-muted-foreground hover:underline"
        >
          &larr; Back to Plant Conflicts
        </Link>
        <h2 className="mt-2 text-2xl font-bold italic">{plantName}</h2>
        {commonName && (
          <p className="text-muted-foreground">{commonName}</p>
        )}
        <p className="mt-1 text-lg">{attributeName}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="outline">
            Production: {data.productionValue ?? "none"}
          </Badge>
          <Badge variant={statusVariant(data.claim?.status ?? null)}>
            {data.claim?.status ?? "No claim"}
          </Badge>
          <Badge variant="secondary">
            {warrants.length} warrant{warrants.length !== 1 ? "s" : ""}
          </Badge>
          <Badge variant="secondary">
            {includedWarrants.length} included
          </Badge>
        </div>
      </div>

      {/* Existing claim info */}
      {data.claim && (
        <Card>
          <CardHeader>
            <CardTitle>Existing Claim</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{data.claim.synthesized_text}</p>
            <div className="flex gap-2">
              <Badge variant="outline">
                Confidence: {data.claim.confidence}
              </Badge>
              {data.claim.approved_by && (
                <Badge variant="secondary">
                  By: {data.claim.approved_by}
                </Badge>
              )}
              {data.claim.dolt_commit_hash && (
                <Badge variant="outline">
                  Commit: {data.claim.dolt_commit_hash.slice(0, 8)}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Warrant Cards — Existing */}
      {existing.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">Existing Evidence</h3>
          {existing.map((w) => (
            <WarrantCard
              key={w.id}
              warrant={w}
              conflicts={data.conflicts.filter(
                (c) =>
                  c.other_warrant_id === w.id ||
                  data.conflicts.some(
                    (cc) => cc.id === c.id
                  )
              )}
              onStatusChange={handleWarrantStatusChange}
            />
          ))}
        </div>
      )}

      {/* Warrant Cards — External, grouped by source */}
      {Object.entries(bySource).map(([source, sourceWarrants]) => (
        <div key={source} className="space-y-3">
          <h3 className="text-lg font-semibold">{source}</h3>
          {sourceWarrants.map((w) => (
            <WarrantCard
              key={w.id}
              warrant={w}
              conflicts={data.conflicts.filter(
                (c) =>
                  c.other_warrant_id === w.id ||
                  data.conflicts.some(
                    (cc) => cc.id === c.id
                  )
              )}
              onStatusChange={handleWarrantStatusChange}
            />
          ))}
        </div>
      ))}

      {warrants.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No warrants found for this plant + attribute combination.
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Synthesis Panel */}
      <Card>
        <CardHeader>
          <CardTitle>Synthesis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {synthesisResult ? (
            <div className="space-y-2">
              <p className="text-sm">{synthesisResult.synthesized_text}</p>
              <div className="flex gap-2">
                <Badge variant="outline">
                  Confidence: {synthesisResult.confidence}
                </Badge>
              </div>
              {synthesisResult.confidence_reasoning && (
                <p className="text-sm text-muted-foreground">
                  {synthesisResult.confidence_reasoning}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select warrants to include, then generate a synthesis.
            </p>
          )}
          <Button
            onClick={handleSynthesize}
            disabled={synthesizing || includedWarrants.length === 0}
          >
            {synthesizing
              ? "Synthesizing..."
              : `Synthesize from ${includedWarrants.length} warrant${includedWarrants.length !== 1 ? "s" : ""}`}
          </Button>
        </CardContent>
      </Card>

      {/* Approval Panel */}
      <Card>
        <CardHeader>
          <CardTitle>Approve Claim</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Approval notes (optional)..."
            value={approvalNotes}
            onChange={(e) => setApprovalNotes(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <Button
              onClick={handleApprove}
              disabled={approving || includedWarrants.length === 0}
            >
              {approving
                ? "Approving..."
                : `Approve with ${includedWarrants.length} warrant${includedWarrants.length !== 1 ? "s" : ""}`}
            </Button>
            {includedWarrants.length === 0 && (
              <span className="text-sm text-muted-foreground">
                Include at least one warrant to approve
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
