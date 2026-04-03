"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface SummaryData {
  totalPlants: number;
  avgCompleteness: number;
  lowCoverageCount: number;
  pendingConflicts: number;
}

export function CoverageSummaryCards() {
  const [data, setData] = useState<SummaryData | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/coverage").then((r) => r.json()),
      fetch("/api/agents/counts").then((r) => r.json()),
    ]).then(([coverage, counts]) => {
      const attrs = coverage as {
        coveragePct: number;
        totalPlants: number;
      }[];
      const totalPlants = attrs[0]?.totalPlants ?? 0;
      const avgCoverage =
        attrs.length > 0
          ? Math.round(
              (attrs.reduce((s, a) => s + a.coveragePct, 0) / attrs.length) *
                10
            ) / 10
          : 0;
      const lowCount = attrs.filter((a) => a.coveragePct < 50).length;

      setData({
        totalPlants,
        avgCompleteness: avgCoverage,
        lowCoverageCount: lowCount,
        pendingConflicts: counts.pendingConflicts ?? 0,
      });
    }).catch(() => {
      // ignore — cards just won't render
    });
  }, []);

  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} size="sm">
            <CardContent className="py-3">
              <Skeleton className="h-4 w-20 mb-1" />
              <Skeleton className="h-6 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const cards = [
    { label: "Plants", value: data.totalPlants.toLocaleString() },
    { label: "Avg Coverage", value: `${data.avgCompleteness}%` },
    {
      label: "Low Coverage Attrs",
      value: data.lowCoverageCount.toString(),
      warn: data.lowCoverageCount > 0,
    },
    {
      label: "Pending Conflicts",
      value: data.pendingConflicts.toString(),
      warn: data.pendingConflicts > 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} size="sm">
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <p
              className={`text-xl font-bold ${card.warn ? "text-yellow-600 dark:text-yellow-400" : ""}`}
            >
              {card.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
