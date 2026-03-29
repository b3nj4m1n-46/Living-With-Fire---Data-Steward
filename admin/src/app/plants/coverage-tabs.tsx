"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { AttributeCoverage } from "@/lib/queries/coverage";
import type { EnrichmentSummaryRow } from "@/lib/queries/enrichment";

// ── Types ───────────────────────────────────────────────────────────────

type AttrSort = "coverage_asc" | "coverage_desc" | "name" | "category";

interface PlantGapRow {
  plantId: string;
  genus: string;
  species: string;
  commonName: string | null;
}

interface SourceGroup {
  sourceId: string;
  displayName: string;
  totalCandidates: number;
  attributes: {
    attributeId: string;
    attributeName: string;
    category: string;
    candidateCount: number;
    gapCount: number;
  }[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

function coverageColor(pct: number): string {
  if (pct < 50) return "bg-red-500";
  if (pct < 80) return "bg-yellow-500";
  return "bg-green-500";
}

function coverageTextColor(pct: number): string {
  if (pct < 50) return "text-red-600 dark:text-red-400";
  if (pct < 80) return "text-yellow-600 dark:text-yellow-400";
  return "text-green-600 dark:text-green-400";
}

function CoverageBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${coverageColor(pct)}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className={`text-xs font-medium ${coverageTextColor(pct)}`}>
        {pct}%
      </span>
    </div>
  );
}

function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {Array.from({ length: cols }).map((_, i) => (
            <TableHead key={i}>
              <Skeleton className="h-4 w-20" />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }).map((_, i) => (
          <TableRow key={i}>
            {Array.from({ length: cols }).map((_, j) => (
              <TableCell key={j}>
                <Skeleton className="h-4 w-full" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ── Attribute Coverage Tab ──────────────────────────────────────────────

function AttributeCoverageTab() {
  const [data, setData] = useState<AttributeCoverage[]>([]);
  const [enrichment, setEnrichment] = useState<EnrichmentSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<AttrSort>("coverage_asc");
  const [expandedAttr, setExpandedAttr] = useState<string | null>(null);
  const [gapPlants, setGapPlants] = useState<PlantGapRow[]>([]);
  const [gapLoading, setGapLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/coverage").then((r) => r.json()),
      fetch("/api/enrichment").then((r) => r.json()),
    ]).then(([cov, enr]) => {
      setData(cov);
      setEnrichment(enr);
      setLoading(false);
    });
  }, []);

  const enrichMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of enrichment) {
      map.set(row.attributeId, row.enrichableCount);
    }
    return map;
  }, [enrichment]);

  const sorted = useMemo(() => {
    const copy = [...data];
    switch (sort) {
      case "coverage_desc":
        copy.sort((a, b) => b.coveragePct - a.coveragePct);
        break;
      case "name":
        copy.sort((a, b) => a.attributeName.localeCompare(b.attributeName));
        break;
      case "category":
        copy.sort((a, b) => a.category.localeCompare(b.category) || a.coveragePct - b.coveragePct);
        break;
      case "coverage_asc":
      default:
        copy.sort((a, b) => a.coveragePct - b.coveragePct);
        break;
    }
    return copy;
  }, [data, sort]);

  const toggleExpand = useCallback(
    async (attributeId: string) => {
      if (expandedAttr === attributeId) {
        setExpandedAttr(null);
        return;
      }
      setExpandedAttr(attributeId);
      setGapLoading(true);
      try {
        const res = await fetch(`/api/coverage/${attributeId}`);
        const json = await res.json();
        setGapPlants(json.plants ?? []);
      } catch {
        setGapPlants([]);
      }
      setGapLoading(false);
    },
    [expandedAttr]
  );

  if (loading) return <TableSkeleton cols={6} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Sort:</span>
        {(
          [
            ["coverage_asc", "Lowest Coverage"],
            ["coverage_desc", "Highest Coverage"],
            ["name", "Name"],
            ["category", "Category"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={sort === value ? "default" : "outline"}
            size="sm"
            onClick={() => setSort(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Attribute</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Coverage</TableHead>
            <TableHead className="text-right">With Value</TableHead>
            <TableHead className="text-right">Missing</TableHead>
            <TableHead className="text-right">Enrichable</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((attr) => (
            <Fragment key={attr.attributeId}>
              <TableRow
                className="cursor-pointer"
                onClick={() => toggleExpand(attr.attributeId)}
              >
                <TableCell className="font-medium">
                  {expandedAttr === attr.attributeId ? "\u25BC " : "\u25B6 "}
                  {attr.attributeName}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{attr.category}</Badge>
                </TableCell>
                <TableCell>
                  <CoverageBar pct={attr.coveragePct} />
                </TableCell>
                <TableCell className="text-right">
                  {attr.plantsWithValue.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {attr.gapCount.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {enrichMap.get(attr.attributeId)?.toLocaleString() ?? "\u2014"}
                </TableCell>
              </TableRow>
              {expandedAttr === attr.attributeId && (
                <TableRow key={`${attr.attributeId}-detail`}>
                  <TableCell colSpan={6} className="bg-muted/30 p-4">
                    {gapLoading ? (
                      <div className="space-y-2">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <Skeleton key={i} className="h-4 w-64" />
                        ))}
                      </div>
                    ) : gapPlants.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No plants missing this attribute.
                      </p>
                    ) : (
                      <div>
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          Plants missing {attr.attributeName} (showing first{" "}
                          {Math.min(gapPlants.length, 50)}
                          {attr.gapCount > 50
                            ? ` of ${attr.gapCount.toLocaleString()}`
                            : ""}
                          ):
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {gapPlants.slice(0, 50).map((p) => (
                            <Link
                              key={p.plantId}
                              href={`/plants/${p.plantId}`}
                              className="text-xs hover:underline"
                            >
                              <Badge variant="outline">
                                {p.genus} {p.species}
                                {p.commonName ? ` (${p.commonName})` : ""}
                              </Badge>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Enrichment Tab ──────────────────────────────────────────────────────

function EnrichmentTab() {
  const [data, setData] = useState<EnrichmentSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/enrichment")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  const sourceGroups = useMemo(() => {
    const map = new Map<string, SourceGroup>();

    for (const row of data) {
      for (const src of row.sourceBreakdown) {
        let group = map.get(src.sourceId);
        if (!group) {
          group = {
            sourceId: src.sourceId,
            displayName: src.displayName,
            totalCandidates: 0,
            attributes: [],
          };
          map.set(src.sourceId, group);
        }
        group.totalCandidates += src.candidateCount;
        group.attributes.push({
          attributeId: row.attributeId,
          attributeName: row.attributeName,
          category: row.category,
          candidateCount: src.candidateCount,
          gapCount: row.gapCount,
        });
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => b.totalCandidates - a.totalCandidates
    );
  }, [data]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
              <Skeleton className="mt-2 h-4 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (sourceGroups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No enrichment opportunities found.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sourceGroups.map((group) => (
        <Card
          key={group.sourceId}
          className="cursor-pointer transition-colors hover:bg-accent/50"
          onClick={() =>
            setExpandedSource(
              expandedSource === group.sourceId ? null : group.sourceId
            )
          }
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span>{group.displayName}</span>
              <Badge variant="secondary">{group.sourceId}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {group.totalCandidates.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">
              enrichment candidates across {group.attributes.length} attribute
              {group.attributes.length === 1 ? "" : "s"}
            </p>

            {expandedSource === group.sourceId && (
              <div className="mt-3 space-y-1.5 border-t pt-3">
                {group.attributes
                  .sort((a, b) => b.candidateCount - a.candidateCount)
                  .map((attr) => (
                    <div
                      key={attr.attributeId}
                      className="flex items-center justify-between text-xs"
                    >
                      <span>
                        {attr.attributeName}{" "}
                        <span className="text-muted-foreground">
                          ({attr.category})
                        </span>
                      </span>
                      <Badge variant="outline">
                        {attr.candidateCount} / {attr.gapCount.toLocaleString()}{" "}
                        gaps
                      </Badge>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────

export function CoverageDetailTabs() {
  return (
    <Tabs defaultValue="attributes">
      <TabsList>
        <TabsTrigger value="attributes">Attribute Gaps</TabsTrigger>
        <TabsTrigger value="enrichment">Enrichment</TabsTrigger>
      </TabsList>

      <TabsContent value="attributes">
        <AttributeCoverageTab />
      </TabsContent>

      <TabsContent value="enrichment">
        <EnrichmentTab />
      </TabsContent>
    </Tabs>
  );
}
