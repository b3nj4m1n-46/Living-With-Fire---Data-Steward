"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface AgentCounts {
  pendingConflicts: number;
  lastAudit: {
    batchId: string;
    completedAt: string;
    warrantsCreated: number;
    conflictsDetected: number;
    notes: string | null;
  } | null;
}

interface BatchRow {
  id: string;
  batch_type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  warrants_created: number | null;
  conflicts_detected: number | null;
  claims_generated: number | null;
  dolt_commit_hash: string | null;
  notes: string | null;
}

function batchTypeLabel(type: string): string {
  switch (type) {
    case "internal_audit":
      return "Internal Audit";
    case "classify_existing":
      return "Conflict Classification";
    default:
      return type;
  }
}

export function OperationsToolbar() {
  const [counts, setCounts] = useState<AgentCounts | null>(null);
  const [running, setRunning] = useState<BatchRow[]>([]);
  const [launching, setLaunching] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/counts");
      if (res.ok) setCounts(await res.json());
    } catch {
      // ignore
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/status");
      if (res.ok) {
        const data = await res.json();
        setRunning(data.running);
        return data.running.length;
      }
    } catch {
      // ignore
    }
    return 0;
  }, []);

  useEffect(() => {
    fetchCounts();
    fetchStatus();
  }, [fetchCounts, fetchStatus]);

  // Poll when operations are running
  useEffect(() => {
    if (running.length > 0 || launching) {
      if (!pollRef.current) {
        pollRef.current = setInterval(async () => {
          const runningCount = await fetchStatus();
          if (runningCount === 0 && !launching) {
            fetchCounts();
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
          }
        }, 5000);
      }
    }
    return () => {
      if (pollRef.current && running.length === 0 && !launching) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [running.length, launching, fetchStatus, fetchCounts]);

  async function runAudit() {
    setLaunching("audit");
    try {
      const res = await fetch("/api/audit/internal", { method: "POST" });
      if (res.ok) {
        fetchCounts();
        fetchStatus();
      }
    } catch {
      // ignore
    } finally {
      setLaunching(null);
    }
  }

  async function runClassify() {
    setLaunching("classify");
    try {
      const res = await fetch("/api/agents/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "internal" }),
      });
      if (res.status === 409) {
        setLaunching(null);
        return;
      }
      if (res.ok) await fetchStatus();
    } catch {
      // ignore
    } finally {
      setLaunching(null);
    }
  }

  const isAuditRunning =
    launching === "audit" ||
    running.some((b) => b.batch_type === "internal_audit");
  const isClassifyRunning =
    launching === "classify" ||
    running.some((b) => b.batch_type === "classify_existing");

  const anyRunning = running.length > 0 || !!launching;

  return (
    <>
      <Button
        onClick={runAudit}
        disabled={isAuditRunning}
      >
        {isAuditRunning ? "Running..." : "Run Audit"}
      </Button>
      <Button
        onClick={runClassify}
        disabled={isClassifyRunning || (counts?.pendingConflicts ?? 0) === 0}
      >
        {isClassifyRunning ? "Classifying..." : "Classify Conflicts"}
        {counts && counts.pendingConflicts > 0 && !isClassifyRunning && (
          <Badge variant="secondary" className="ml-1.5">
            {counts.pendingConflicts}
          </Badge>
        )}
      </Button>
      {anyRunning && (
        <div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 text-xs">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
          <span className="text-muted-foreground">
            {running.map((b) => batchTypeLabel(b.batch_type)).join(", ") ||
              "Starting..."}
          </span>
        </div>
      )}
    </>
  );
}
