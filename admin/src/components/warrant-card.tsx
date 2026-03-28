"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { WarrantDetail, ConflictSummary } from "@/lib/queries/claims";

interface WarrantCardProps {
  warrant: WarrantDetail;
  conflicts: ConflictSummary[];
  onStatusChange: (warrantId: string, newStatus: string) => void;
}

function confidenceVariant(confidence: number | null) {
  if (confidence === null) return "secondary" as const;
  if (confidence >= 0.9) return "default" as const;
  if (confidence >= 0.7) return "secondary" as const;
  return "outline" as const;
}

function confidenceLabel(confidence: number | null) {
  if (confidence === null) return "N/A";
  return `${Math.round(confidence * 100)}%`;
}

function borderColor(status: string) {
  switch (status) {
    case "included":
      return "border-l-green-500";
    case "excluded":
      return "border-l-red-500";
    default:
      return "border-l-muted-foreground/30";
  }
}

export function WarrantCard({
  warrant,
  conflicts,
  onStatusChange,
}: WarrantCardProps) {
  const [status, setStatus] = useState(warrant.status);
  const [toggling, setToggling] = useState(false);

  const isIncluded = status === "included";

  async function handleToggle() {
    const newStatus = isIncluded ? "excluded" : "included";
    const previousStatus = status;

    // Optimistic update
    setStatus(newStatus);
    setToggling(true);

    try {
      const res = await fetch(`/api/warrants/${warrant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        throw new Error(`Failed to update warrant status`);
      }

      onStatusChange(warrant.id, newStatus);
    } catch {
      // Revert on error
      setStatus(previousStatus);
      toast.error("Failed to update warrant status");
    } finally {
      setToggling(false);
    }
  }

  const warrantConflicts = conflicts.filter(
    (c) =>
      c.other_warrant_id === warrant.id ||
      conflicts.some(
        (cc) =>
          (cc.id === c.id && cc.other_warrant_id === warrant.id) ||
          c.id === cc.id
      )
  );

  return (
    <Card className={`border-l-4 ${borderColor(status)}`}>
      <CardContent className="space-y-3 pt-4">
        {/* Top row: checkbox + badges */}
        <div className="flex items-start gap-3">
          <Checkbox
            checked={isIncluded}
            onCheckedChange={handleToggle}
            disabled={toggling}
            aria-label={`Include warrant from ${warrant.source_id_code ?? warrant.source_dataset ?? "unknown"}`}
          />
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {warrant.source_id_code ?? warrant.source_dataset ?? "existing"}
            </Badge>
            <Badge variant="outline">{warrant.warrant_type}</Badge>
            {warrant.match_confidence !== null && (
              <Badge variant={confidenceVariant(warrant.match_confidence)}>
                Match: {confidenceLabel(warrant.match_confidence)}
              </Badge>
            )}
            {warrantConflicts.length > 0 && (
              <Badge variant="destructive">
                {warrantConflicts.length} conflict
                {warrantConflicts.length > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
        </div>

        {/* Value display */}
        <div className="space-y-1 pl-7">
          <div className="text-lg font-semibold">{warrant.value}</div>
          {warrant.source_value &&
            warrant.source_value !== warrant.value && (
              <p className="text-sm text-muted-foreground">
                Original: {warrant.source_value}
              </p>
            )}
          {warrant.value_context && (
            <p className="text-sm text-muted-foreground italic">
              {warrant.value_context}
            </p>
          )}
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 pl-7 text-sm text-muted-foreground">
          {warrant.source_methodology && (
            <span>Method: {warrant.source_methodology}</span>
          )}
          {warrant.source_region && (
            <span>Region: {warrant.source_region}</span>
          )}
          {warrant.source_year && <span>Year: {warrant.source_year}</span>}
          {warrant.source_reliability && (
            <span>Reliability: {warrant.source_reliability}</span>
          )}
          <span>Match: {warrant.match_method}</span>
        </div>

        {/* Specialist notes */}
        {warrant.specialist_notes && (
          <div className="rounded-md bg-muted px-3 py-2 ml-7 text-sm">
            <span className="font-medium">Specialist: </span>
            {warrant.specialist_notes}
          </div>
        )}

        {/* Conflict details inline */}
        {warrantConflicts.length > 0 && (
          <div className="space-y-2 pl-7">
            {warrantConflicts.map((c) => (
              <div
                key={c.id}
                className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      c.severity === "critical" ? "destructive" : "outline"
                    }
                    className={
                      c.severity === "moderate"
                        ? "border-yellow-500 text-yellow-700 dark:text-yellow-400"
                        : undefined
                    }
                  >
                    {c.severity}
                  </Badge>
                  <span className="font-medium">{c.conflict_type}</span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {c.source_a}: {c.value_a} vs {c.source_b}: {c.value_b}
                </p>
                {c.specialist_verdict && (
                  <p className="mt-1">
                    Verdict: <span className="font-medium">{c.specialist_verdict}</span>
                    {c.specialist_recommendation &&
                      ` — ${c.specialist_recommendation}`}
                  </p>
                )}
                {c.specialist_analysis && (
                  <p className="mt-1 text-muted-foreground">
                    {c.specialist_analysis}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
