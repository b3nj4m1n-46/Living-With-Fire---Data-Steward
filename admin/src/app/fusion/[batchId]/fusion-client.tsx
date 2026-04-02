"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  MappingBatch,
  ColumnMapping,
} from "@/lib/queries/fusion";

// --- Constants ---

const MAPPING_TYPES = [
  "DIRECT",
  "CROSSWALK",
  "SPLIT",
  "NEW_ATTRIBUTE",
  "SKIP",
  "UNCERTAIN",
] as const;

const MAPPING_DESCRIPTIONS: Record<string, { short: string; detail: string }> = {
  DIRECT: {
    short: "Maps 1:1 to a production attribute",
    detail: "Source values transfer directly to the target attribute with no transformation needed.",
  },
  CROSSWALK: {
    short: "Values need translation",
    detail: "Source uses different values (e.g. \"High\"/\"Low\") that must be converted to the production scale. Edit the crosswalk to define the translation.",
  },
  SPLIT: {
    short: "One column maps to multiple attributes",
    detail: "This column encodes more than one concept and needs to be split into separate production attributes. Not yet supported for automatic warrant creation.",
  },
  NEW_ATTRIBUTE: {
    short: "No matching production attribute exists",
    detail: "This data doesn't fit any existing attribute. A new attribute would need to be created in the production schema to store it.",
  },
  SKIP: {
    short: "Not a plant attribute \u2014 no warrant created",
    detail: "This column is structural (e.g. a join key or plant identifier) and is used during matching, not stored as an attribute value.",
  },
  UNCERTAIN: {
    short: "AI couldn't confidently map this column",
    detail: "The mapping needs human review. The AI found a possible match but isn't confident enough to commit. Change to DIRECT, CROSSWALK, or SKIP after reviewing.",
  },
};

/** Columns used by the matching pipeline to join source records to production plants. */
const JOIN_KEY_COLUMNS = new Set([
  "scientific_name", "botanical_name", "species", "taxon", "genus",
  "usda_symbol", "common_name",
]);

function isJoinKey(column: string): boolean {
  return JOIN_KEY_COLUMNS.has(column.toLowerCase());
}

// --- Helpers ---

function confidenceVariant(c: number) {
  if (c >= 0.8) return "default" as const;
  if (c >= 0.5) return "outline" as const;
  return "destructive" as const;
}

function confidenceClass(c: number) {
  if (c >= 0.8) return "";
  if (c >= 0.5) return "border-yellow-500 text-yellow-700 dark:text-yellow-400";
  return "";
}

function mappingTypeColor(type: string) {
  switch (type) {
    case "DIRECT":
      return "default" as const;
    case "CROSSWALK":
      return "secondary" as const;
    case "SKIP":
      return "outline" as const;
    case "UNCERTAIN":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

// --- Props ---

interface FusionClientProps {
  batch: MappingBatch;
}

// --- Preview result type ---

interface PreviewResult {
  totalSourceRecords: number;
  warrantsEstimated: number;
  warrantsSkipped: number;
  warrantsFlagged: number;
  plantsCovered: number;
  attributesCovered: number;
}

// --- Component ---

export function FusionClient({ batch }: FusionClientProps) {
  const router = useRouter();
  const config = batch.mapping_config;

  const [mappings, setMappings] = useState<ColumnMapping[]>(
    config?.mappings ?? []
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(
    null
  );
  const [crosswalkIdx, setCrosswalkIdx] = useState<number | null>(null);
  const [crosswalkDraft, setCrosswalkDraft] = useState<
    Record<string, string>
  >({});

  if (!config) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No mapping configuration found for this batch.
        </CardContent>
      </Card>
    );
  }

  // Compute summary from current state
  const summary = mappings.reduce(
    (acc, m) => {
      acc.total++;
      const key = m.mappingType.toLowerCase().replace("_", "");
      if (key === "direct") acc.direct++;
      else if (key === "crosswalk") acc.crosswalk++;
      else if (key === "split") acc.split++;
      else if (key === "newattribute") acc.newAttribute++;
      else if (key === "skip") acc.skip++;
      else if (key === "uncertain") acc.uncertain++;
      return acc;
    },
    {
      total: 0,
      direct: 0,
      crosswalk: 0,
      split: 0,
      newAttribute: 0,
      skip: 0,
      uncertain: 0,
    }
  );

  // --- Handlers ---

  function updateMapping(index: number, updates: Partial<ColumnMapping>) {
    setMappings((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      // Clear target if switching to SKIP
      if (updates.mappingType === "SKIP") {
        next[index].targetAttributeId = null;
        next[index].targetAttributeName = null;
        next[index].crosswalk = null;
      }
      return next;
    });
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/fusion/${batch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings }),
      });
      if (!res.ok) throw new Error("Save failed");
      setDirty(false);
      toast.success("Mapping edits saved");
    } catch {
      toast.error("Failed to save mapping edits");
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    setPreviewing(true);
    setPreviewResult(null);
    try {
      const res = await fetch("/api/fusion/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: batch.id, mappings }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Preview failed");
      }
      const data = await res.json();
      setPreviewResult(data);
      setDirty(false);
      toast.success("Preview generated");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Preview failed"
      );
    } finally {
      setPreviewing(false);
    }
  }

  async function handleExecute() {
    setExecuting(true);
    try {
      const res = await fetch("/api/fusion/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: batch.id, mappings }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Execution failed");
      }
      const data = await res.json();
      toast.success(
        `Created ${data.warrantsCreated} warrants, detected ${data.conflictsDetected} conflicts`
      );
      router.push("/fusion");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Execution failed"
      );
    } finally {
      setExecuting(false);
    }
  }

  function openCrosswalk(index: number) {
    setCrosswalkIdx(index);
    setCrosswalkDraft({ ...(mappings[index].crosswalk ?? {}) });
  }

  function saveCrosswalk() {
    if (crosswalkIdx == null) return;
    updateMapping(crosswalkIdx, { crosswalk: { ...crosswalkDraft } });
    setCrosswalkIdx(null);
  }

  const isCompleted = batch.status === "completed";

  return (
    <>
      {/* Summary Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["Direct", "DIRECT", summary.direct, "default"],
            ["Crosswalk", "CROSSWALK", summary.crosswalk, "secondary"],
            ["Split", "SPLIT", summary.split, "secondary"],
            ["New", "NEW_ATTRIBUTE", summary.newAttribute, "secondary"],
            ["Skip", "SKIP", summary.skip, "outline"],
            ["Uncertain", "UNCERTAIN", summary.uncertain, "destructive"],
          ] as const
        ).map(([label, key, count, variant]) => (
          <Card key={label}>
            <CardContent className="py-3 text-center">
              <p className="text-2xl font-bold">{count}</p>
              <Badge variant={variant} className="mt-1">
                {label}
              </Badge>
              <p className="mt-1 text-xs text-muted-foreground">
                {MAPPING_DESCRIPTIONS[key]?.short}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Action Bar */}
      {!isCompleted && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSave}
              disabled={!dirty || saving}
            >
              {saving ? "Saving..." : "Save Edits"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={previewing}
            >
              {previewing ? "Generating..." : "Preview"}
            </Button>
          </div>

          <Dialog>
            <DialogTrigger
              render={
                <Button
                  disabled={executing}
                />
              }
            >
              {executing ? "Executing..." : "Execute Pipeline"}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Execute Fusion Pipeline</DialogTitle>
                <DialogDescription>
                  This will match plants, create warrants, and detect conflicts
                  using the current mapping configuration. This writes to the
                  staging database.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <Button onClick={handleExecute} disabled={executing}>
                  {executing ? "Executing..." : "Confirm Execute"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Preview Results */}
      {previewResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Preview Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  Source Records
                </p>
                <p className="text-xl font-bold">
                  {previewResult.totalSourceRecords}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Warrants Estimated
                </p>
                <p className="text-xl font-bold">
                  {previewResult.warrantsEstimated}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Plants Covered
                </p>
                <p className="text-xl font-bold">
                  {previewResult.plantsCovered}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Attributes Covered
                </p>
                <p className="text-xl font-bold">
                  {previewResult.attributesCovered}
                </p>
              </div>
            </div>
            {previewResult.warrantsFlagged > 0 && (
              <p className="mt-2 text-sm text-yellow-600">
                {previewResult.warrantsFlagged} warrants flagged for low
                confidence
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Mappings Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source Column</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Mapping</TableHead>
                <TableHead>Target Attribute</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Crosswalk</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.map((m, idx) => (
                <TableRow key={m.sourceColumn}>
                  <TableCell>
                    <div>
                      <span className="font-mono text-sm">
                        {m.sourceColumn}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {m.sourceType}
                        {m.sourceDefinition && ` \u2014 ${m.sourceDefinition}`}
                      </p>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={mappingTypeColor(m.mappingType)}>
                        {m.mappingType}
                      </Badge>
                      {isJoinKey(m.sourceColumn) && (
                        <Badge variant="outline" className="border-blue-500 text-blue-600 text-xs">
                          JOIN KEY
                        </Badge>
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
                    {isCompleted ? (
                      <span className="text-sm">{m.mappingType}</span>
                    ) : (
                      <Select
                        value={m.mappingType}
                        onValueChange={(val) =>
                          val && updateMapping(idx, { mappingType: val })
                        }
                      >
                        <SelectTrigger size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MAPPING_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>

                  <TableCell>
                    {m.mappingType === "SKIP" ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <div>
                        <span className="text-sm">
                          {m.targetAttributeName ?? "—"}
                        </span>
                        {m.targetAttributeId && (
                          <p className="font-mono text-xs text-muted-foreground">
                            {m.targetAttributeId.slice(0, 8)}...
                          </p>
                        )}
                      </div>
                    )}
                  </TableCell>

                  <TableCell>
                    <Badge
                      variant={confidenceVariant(m.confidence)}
                      className={confidenceClass(m.confidence)}
                    >
                      {(m.confidence * 100).toFixed(0)}%
                    </Badge>
                  </TableCell>

                  <TableCell>
                    {m.crosswalk &&
                    Object.keys(m.crosswalk).length > 0 ? (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => openCrosswalk(idx)}
                        disabled={isCompleted}
                      >
                        {Object.keys(m.crosswalk).length} values
                      </Button>
                    ) : m.mappingType === "CROSSWALK" ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => openCrosswalk(idx)}
                        disabled={isCompleted}
                      >
                        Add
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell>
                    {!isCompleted && m.mappingType !== "SKIP" && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          updateMapping(idx, { mappingType: "SKIP" })
                        }
                      >
                        Skip
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Unmapped Columns */}
      {config.unmappedColumns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unmapped Columns ({config.unmappedColumns.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {config.unmappedColumns.map((col) => (
                <Badge key={col} variant="outline">
                  {col}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mapping Type Reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Mapping Types
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MAPPING_TYPES.map((t) => (
              <div key={t} className="space-y-1">
                <Badge variant={mappingTypeColor(t)}>{t}</Badge>
                <p className="text-sm font-medium">
                  {MAPPING_DESCRIPTIONS[t]?.short}
                </p>
                <p className="text-xs text-muted-foreground">
                  {MAPPING_DESCRIPTIONS[t]?.detail}
                </p>
              </div>
            ))}
            <div className="space-y-1">
              <Badge variant="outline" className="border-blue-500 text-blue-600">
                JOIN KEY
              </Badge>
              <p className="text-sm font-medium">
                Used to match source records to production plants
              </p>
              <p className="text-xs text-muted-foreground">
                Columns like scientific_name or usda_symbol are used by the matching pipeline to link source rows to production plants. They appear alongside SKIP because they aren&apos;t stored as attribute values.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reasoning (collapsible per-row would be heavy, show at bottom) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            AI Reasoning
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {mappings
            .filter((m) => m.reasoning)
            .map((m) => (
              <div key={m.sourceColumn}>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{m.sourceColumn}</p>
                  <Badge variant={mappingTypeColor(m.mappingType)} className="text-xs">
                    {m.mappingType}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                  {MAPPING_DESCRIPTIONS[m.mappingType]?.detail}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{m.reasoning}</p>
                {m.notes && (
                  <p className="text-xs italic text-muted-foreground">
                    {m.notes}
                  </p>
                )}
              </div>
            ))}
        </CardContent>
      </Card>

      {/* Crosswalk Editor Dialog */}
      <Dialog
        open={crosswalkIdx != null}
        onOpenChange={(open) => {
          if (!open) setCrosswalkIdx(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Edit Crosswalk
              {crosswalkIdx != null && (
                <>
                  {" — "}
                  <span className="font-mono">
                    {mappings[crosswalkIdx]?.sourceColumn}
                  </span>
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              Map source values (left) to production values (right).
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source Value</TableHead>
                  <TableHead>Production Value</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(crosswalkDraft).map(([srcVal, prodVal]) => (
                  <TableRow key={srcVal}>
                    <TableCell className="font-mono text-sm">
                      {srcVal}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={prodVal}
                        onChange={(e) =>
                          setCrosswalkDraft((prev) => ({
                            ...prev,
                            [srcVal]: e.target.value,
                          }))
                        }
                        className="h-7 text-sm"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          setCrosswalkDraft((prev) => {
                            const next = { ...prev };
                            delete next[srcVal];
                            return next;
                          })
                        }
                      >
                        x
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setCrosswalkDraft((prev) => ({
                ...prev,
                "": "",
              }))
            }
          >
            Add Value
          </Button>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button onClick={saveCrosswalk}>Save Crosswalk</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
