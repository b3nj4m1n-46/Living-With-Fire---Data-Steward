"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import type { DoltLogEntry } from "@/lib/queries/history";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function HistoryClient({
  initialEntries,
}: {
  initialEntries: DoltLogEntry[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialEntries.length === 50);
  const [undoTarget, setUndoTarget] = useState<DoltLogEntry | null>(null);
  const [reverting, setReverting] = useState(false);

  async function loadMore() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/dolt/log?offset=${entries.length}&limit=50`
      );
      const more: DoltLogEntry[] = await res.json();
      setEntries((prev) => [...prev, ...more]);
      if (more.length < 50) setHasMore(false);
    } catch {
      toast.error("Failed to load more entries");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevert() {
    if (!undoTarget) return;
    setReverting(true);
    try {
      const res = await fetch("/api/dolt/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitHash: undoTarget.commit_hash }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Revert failed");
        return;
      }

      toast.success(
        `Reverted commit ${undoTarget.commit_hash.slice(0, 8)}`
      );
      setUndoTarget(null);
      router.refresh();
    } catch {
      toast.error("Failed to revert commit");
    } finally {
      setReverting(false);
    }
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <Table>
            {entries.length === 0 && (
              <TableCaption>No commits found.</TableCaption>
            )}
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Hash</TableHead>
                <TableHead>Message</TableHead>
                <TableHead className="w-[120px]">Date</TableHead>
                <TableHead className="w-[120px]">Committer</TableHead>
                <TableHead className="w-[180px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry, i) => (
                <TableRow key={entry.commit_hash}>
                  <TableCell
                    className="font-mono text-xs"
                    title={entry.commit_hash}
                  >
                    {entry.commit_hash.slice(0, 8)}
                  </TableCell>
                  <TableCell className="max-w-md truncate">
                    {entry.message}
                  </TableCell>
                  <TableCell
                    className="text-xs text-muted-foreground"
                    title={new Date(entry.date).toLocaleString()}
                  >
                    {timeAgo(entry.date)}
                  </TableCell>
                  <TableCell className="text-xs">{entry.committer}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={`/history/${entry.commit_hash}`} />}
                      >
                        View Changes
                      </Button>
                      {i < 5 && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setUndoTarget(entry)}
                        >
                          Undo
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loading}>
            {loading ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}

      <Dialog
        open={undoTarget !== null}
        onOpenChange={(open) => !open && setUndoTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo Commit</DialogTitle>
            <DialogDescription>
              This will revert all changes from this commit by creating a new
              commit. This action cannot be easily undone.
            </DialogDescription>
          </DialogHeader>

          {undoTarget && (
            <div className="rounded-md border p-3 text-sm">
              <p>
                <span className="font-medium">Hash:</span>{" "}
                <code className="font-mono">
                  {undoTarget.commit_hash.slice(0, 8)}
                </code>
              </p>
              <p>
                <span className="font-medium">Message:</span>{" "}
                {undoTarget.message}
              </p>
              <p>
                <span className="font-medium">Date:</span>{" "}
                {new Date(undoTarget.date).toLocaleString()}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUndoTarget(null)}
              disabled={reverting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevert}
              disabled={reverting}
            >
              {reverting ? "Reverting..." : "Confirm Revert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
