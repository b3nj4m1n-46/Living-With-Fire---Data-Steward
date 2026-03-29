"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// --- Types ---

interface Suggestion {
  scientificName: string;
  commonName: string | null;
  family: string | null;
}

interface SynonymResolution {
  searchedName: string;
  acceptedName: string;
  acceptedCommonName: string | null;
}

interface TaxonomyResult {
  family: string | null;
  lifeform: string | null;
  climate: string | null;
  nativeRange: string | null;
  commonName: string | null;
  sources: string[];
  synonym: SynonymResolution | null;
}

interface ProductionMatch {
  exists: boolean;
  plantId?: string;
  genus?: string;
  species?: string;
  commonName?: string;
  attributeCount?: number;
}

interface MappedField {
  sourceColumn: string;
  value: string;
  attributeId: string | null;
  attributeName: string | null;
  attributeCategory: string | null;
}

interface SourceHit {
  sourceId: string;
  displayName: string;
  category: string;
  matchedName: string;
  matchConfidence: number;
  fields: MappedField[];
}

interface LookupResult {
  taxonomy: TaxonomyResult;
  productionMatch: ProductionMatch;
  sourceHits: SourceHit[];
}

interface EditableAttribute {
  key: string;
  attributeId: string | null;
  attributeName: string;
  sourceColumn: string;
  value: string;
  sourceIdCode: string;
  sourceValue: string;
  sourceDisplayName: string;
  category: string;
  matchConfidence: number;
  included: boolean;
  edited: boolean;
  calculated: boolean;
}

// --- Constants ---

const STEP_LABELS = [
  "Identify Plant",
  "Source Hits",
  "Review Attributes",
  "Create",
];

// Calculated attribute UUIDs (read-only, auto-derived)
const CALCULATED_IDS = new Set([
  "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "bacadba3-a4f8-4550-9906-6b5535a619b6",
  "e8686d2e-fe16-440e-bc70-af4a0328cd05",
  "b1000001-0001-4000-8000-000000000001",
  "b1000001-0001-4000-8000-000000000002",
  "b1000001-0001-4000-8000-000000000003",
  "b1000001-0001-4000-8000-000000000004",
  "b1000001-0001-4000-8000-000000000005",
  "b1000001-0001-4000-8000-000000000006",
  "b1000001-0001-4000-8000-000000000007",
  "b1000001-0001-4000-8000-000000000008",
  "b1000001-0001-4000-8000-000000000009",
  "b1000001-0001-4000-8000-000000000010",
  "b1000001-0001-4000-8000-000000000011",
  "b1000001-0001-4000-8000-000000000012",
  "b1000001-0001-4000-8000-000000000013",
  "b1000001-0001-4000-8000-000000000014",
  "b1000001-0001-4000-8000-000000000015",
]);

const CATEGORY_ORDER = [
  "Flammability",
  "Wildlife Values",
  "Water Requirements",
  "Growth",
  "Environmental Requirements to Thrive",
  "Nativeness",
  "Invasiveness",
  "Soils",
  "Plant Materials",
  // Fallback source categories for unmapped fields
  "fire",
  "deer",
  "water",
  "pollinators",
  "birds",
  "native",
  "invasive",
  "traits",
];

// --- Component ---

export function AddPlantClient() {
  const router = useRouter();

  // Navigation
  const [step, setStep] = useState(1);

  // Step 1 — Name Input
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedName, setSelectedName] = useState("");
  const suggestRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Step 1 → 2 transition
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);

  // Step 3 — Attribute review
  const [attributes, setAttributes] = useState<EditableAttribute[]>([]);

  // Step 4 — Create
  const [creating, setCreating] = useState(false);
  const [curatorNotes, setCuratorNotes] = useState("");

  // --- Typeahead ---

  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/plants/lookup?suggest=${encodeURIComponent(q.trim())}`
      );
      if (res.ok) {
        const data: Suggestion[] = await res.json();
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
      }
    } catch {
      // Non-critical
    }
  }, []);

  function handleQueryChange(value: string) {
    setQuery(value);
    setSelectedName("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300);
  }

  function handleSelectSuggestion(suggestion: Suggestion) {
    setQuery(suggestion.scientificName);
    setSelectedName(suggestion.scientificName);
    setShowSuggestions(false);
    setSuggestions([]);
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        suggestRef.current &&
        !suggestRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // --- Full Lookup ---

  async function handleLookup() {
    const name = selectedName || query.trim();
    if (name.length < 3) {
      toast.error("Enter at least 3 characters");
      return;
    }

    setLookingUp(true);
    try {
      const res = await fetch(
        `/api/plants/lookup?q=${encodeURIComponent(name)}`
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Lookup failed");
      }
      const data: LookupResult = await res.json();
      setLookupResult(data);

      // Build editable attributes from source hits
      buildEditableAttributes(data);

      setStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setLookingUp(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (showSuggestions && suggestions.length > 0) {
        handleSelectSuggestion(suggestions[0]);
      } else {
        handleLookup();
      }
    }
  }

  // --- Build Editable Attributes ---

  function buildEditableAttributes(data: LookupResult) {
    const attrs: EditableAttribute[] = [];
    const seen = new Set<string>();

    for (const hit of data.sourceHits) {
      for (const field of hit.fields) {
        // Use sourceId:sourceColumn as a unique key for dedup
        const dedupKey = `${hit.sourceId}:${field.sourceColumn}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        // Use mapped attribute name/category if available, else fall back to source column
        const displayName = field.attributeName
          || field.sourceColumn.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        const displayCategory = field.attributeCategory || hit.category;

        const isCalc = field.attributeId ? CALCULATED_IDS.has(field.attributeId) : false;

        attrs.push({
          key: dedupKey,
          attributeId: field.attributeId,
          attributeName: displayName,
          sourceColumn: field.sourceColumn,
          value: field.value,
          sourceIdCode: hit.sourceId,
          sourceValue: field.value,
          sourceDisplayName: hit.displayName,
          category: displayCategory,
          matchConfidence: hit.matchConfidence,
          included: field.attributeId !== null && !isCalc, // auto-include only mapped non-calculated
          edited: false,
          calculated: isCalc,
        });
      }
    }

    setAttributes(attrs);
  }

  // --- Attribute Editing ---

  function toggleAttribute(key: string) {
    setAttributes((prev) =>
      prev.map((a) => (a.key === key ? { ...a, included: !a.included } : a))
    );
  }

  function updateAttributeValue(key: string, newValue: string) {
    setAttributes((prev) =>
      prev.map((a) =>
        a.key === key ? { ...a, value: newValue, edited: newValue !== a.sourceValue } : a
      )
    );
  }

  // --- Create Plant ---

  async function handleCreate() {
    if (!lookupResult) return;

    const name = selectedName || query.trim();
    const parts = name.split(/\s+/);
    const genus = parts[0] || "";
    const species = parts.slice(1).join(" ") || "";

    const included = attributes.filter((a) => a.included);
    if (included.length === 0) {
      toast.error("Select at least one attribute to include");
      return;
    }

    // Warn if any included attributes lack a production UUID
    const unmapped = included.filter((a) => !a.attributeId);
    if (unmapped.length > 0) {
      toast.error(
        `${unmapped.length} attribute(s) have no production UUID mapping and will be stored as raw source data: ${unmapped.map((a) => a.sourceColumn).join(", ")}`
      );
    }

    setCreating(true);
    try {
      const res = await fetch("/api/plants/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          genus,
          species,
          commonName: lookupResult.taxonomy.commonName || undefined,
          attributes: included.map((a) => ({
            attributeId: a.attributeId || a.key,
            attributeName: a.attributeName,
            value: a.value,
            sourceIdCode: a.sourceIdCode,
            sourceValue: a.sourceValue,
            sourceDataset: a.sourceDisplayName,
            matchConfidence: a.matchConfidence,
          })),
          curatorNotes: curatorNotes.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Creation failed");
      }

      const data = await res.json();
      toast.success(`Plant created with ${data.warrantCount} warrants`);
      router.push(`/plants/${data.plantId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setCreating(false);
    }
  }

  // --- Derived state ---

  const rawName = selectedName || query.trim();
  // Use accepted name if synonym was resolved
  const plantName = lookupResult?.taxonomy.synonym?.acceptedName || rawName;
  const parts = plantName.split(/\s+/);
  const genus = parts[0] || "";
  const species = parts.slice(1).join(" ") || "";
  const includedAttrs = attributes.filter((a) => a.included);

  // Group attributes by category
  const groupedAttrs: Record<string, EditableAttribute[]> = {};
  for (const attr of attributes) {
    const cat = attr.category;
    if (!groupedAttrs[cat]) groupedAttrs[cat] = [];
    groupedAttrs[cat].push(attr);
  }
  const sortedCategories = Object.keys(groupedAttrs).sort(
    (a, b) =>
      (CATEGORY_ORDER.indexOf(a) === -1 ? 99 : CATEGORY_ORDER.indexOf(a)) -
      (CATEGORY_ORDER.indexOf(b) === -1 ? 99 : CATEGORY_ORDER.indexOf(b))
  );

  // --- Render ---

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Add New Plant</h2>
        <Link href="/plants">
          <Button variant="outline" size="sm">
            Back to Plants
          </Button>
        </Link>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEP_LABELS.map((label, i) => {
          const stepNum = i + 1;
          const isActive = step === stepNum;
          const isDone = step > stepNum;
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && (
                <div
                  className={`h-px w-8 ${isDone ? "bg-primary" : "bg-border"}`}
                />
              )}
              <Badge
                variant={isActive ? "default" : isDone ? "default" : "secondary"}
                className={isDone ? "opacity-60" : ""}
              >
                {stepNum}. {label}
              </Badge>
            </div>
          );
        })}
      </div>

      {/* Step 1: Identify Plant */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Scientific Name Lookup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Type a scientific name to search taxonomy backbones and all source
              databases. Select from suggestions or type a full name and press
              Enter.
            </p>

            <div className="relative" ref={suggestRef}>
              <Input
                placeholder="e.g. Mahonia aquifolium"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true);
                }}
                className="text-lg"
                autoFocus
              />

              {/* Suggestion dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
                  {suggestions.map((s) => (
                    <button
                      key={s.scientificName}
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => handleSelectSuggestion(s)}
                    >
                      <span className="font-medium italic">
                        {s.scientificName}
                      </span>
                      {s.commonName && (
                        <span className="text-muted-foreground">
                          {s.commonName}
                        </span>
                      )}
                      {s.family && (
                        <Badge variant="outline" className="ml-auto text-xs">
                          {s.family}
                        </Badge>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedName && (
              <div className="rounded-md bg-muted p-3 text-sm">
                Selected:{" "}
                <span className="font-medium italic">{selectedName}</span>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-end">
            <Button
              onClick={handleLookup}
              disabled={lookingUp || query.trim().length < 3}
            >
              {lookingUp ? "Searching..." : "Search All Sources"}
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Step 2: Source Hit Map */}
      {step === 2 && lookupResult && (
        <>
          {/* Synonym resolution banner */}
          {lookupResult.taxonomy.synonym && (
            <Card className="border-blue-500">
              <CardContent className="flex items-center gap-3 py-4">
                <Badge
                  variant="outline"
                  className="border-blue-500 text-blue-700 dark:text-blue-400"
                >
                  Synonym resolved
                </Badge>
                <span className="text-sm">
                  <span className="italic">{lookupResult.taxonomy.synonym.searchedName}</span>
                  {" "}is a synonym of{" "}
                  <span className="font-medium italic">{lookupResult.taxonomy.synonym.acceptedName}</span>
                  {lookupResult.taxonomy.synonym.acceptedCommonName && (
                    <> ({lookupResult.taxonomy.synonym.acceptedCommonName})</>
                  )}
                  . All searches used the accepted name.
                </span>
              </CardContent>
            </Card>
          )}

          {/* Taxonomy info */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Taxonomy</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <span className="text-muted-foreground">Scientific Name</span>
                  <p className="font-medium italic">{plantName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Common Name</span>
                  <p className="font-medium">
                    {lookupResult.taxonomy.commonName || "—"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Family</span>
                  <p className="font-medium">
                    {lookupResult.taxonomy.family || "—"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Lifeform</span>
                  <p className="font-medium">
                    {lookupResult.taxonomy.lifeform || "—"}
                  </p>
                </div>
                {lookupResult.taxonomy.climate && (
                  <div>
                    <span className="text-muted-foreground">Climate</span>
                    <p className="font-medium">
                      {lookupResult.taxonomy.climate}
                    </p>
                  </div>
                )}
                {lookupResult.taxonomy.nativeRange && (
                  <div className="sm:col-span-2">
                    <span className="text-muted-foreground">Native Range</span>
                    <p className="font-medium">
                      {lookupResult.taxonomy.nativeRange}
                    </p>
                  </div>
                )}
              </div>
              {lookupResult.taxonomy.sources.length > 0 && (
                <div className="mt-2 flex gap-1">
                  {lookupResult.taxonomy.sources.map((s) => (
                    <Badge key={s} variant="outline" className="text-xs">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Production match warning */}
          {lookupResult.productionMatch.exists && (
            <Card className="border-yellow-500">
              <CardContent className="flex items-center gap-3 py-4">
                <Badge
                  variant="outline"
                  className="border-yellow-500 text-yellow-700 dark:text-yellow-400"
                >
                  Already exists
                </Badge>
                <span className="text-sm">
                  This plant is already in production with{" "}
                  {lookupResult.productionMatch.attributeCount} attributes.
                </span>
                <Link
                  href={`/plants/${lookupResult.productionMatch.plantId}`}
                  className="ml-auto"
                >
                  <Button variant="outline" size="sm">
                    View Plant
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Source hit table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Source Hits ({lookupResult.sourceHits.length} of{" "}
                {lookupResult.sourceHits.length +
                  (attributes.length === 0
                    ? 0
                    : attributes.length - lookupResult.sourceHits.length)}{" "}
                sources)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Matched Name</TableHead>
                    <TableHead>Key Fields</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lookupResult.sourceHits.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-center text-muted-foreground py-8"
                      >
                        No matches found in source databases.
                      </TableCell>
                    </TableRow>
                  ) : (
                    lookupResult.sourceHits.map((hit) => (
                      <TableRow key={hit.sourceId}>
                        <TableCell>
                          <div>
                            <span className="font-mono text-xs">
                              {hit.sourceId}
                            </span>
                            <p className="text-sm">{hit.displayName}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="capitalize">
                            {hit.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="italic text-sm">
                          {hit.matchedName}
                          {hit.matchConfidence < 1.0 && (
                            <Badge variant="outline" className="ml-2 text-xs">
                              {Math.round(hit.matchConfidence * 100)}%
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {hit.fields.map((f) => (
                              <Badge
                                key={f.sourceColumn}
                                variant={f.attributeId ? "outline" : "secondary"}
                                className="text-xs"
                                title={f.attributeId ? `→ ${f.attributeName}` : "unmapped"}
                              >
                                {f.sourceColumn}: {f.value.length > 30 ? f.value.slice(0, 30) + "..." : f.value}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={lookupResult.sourceHits.length === 0}
              >
                Review Attributes
              </Button>
            </CardFooter>
          </Card>
        </>
      )}

      {/* Step 3: Attribute Review Grid */}
      {step === 3 && (
        <>
          {/* Identity summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Plant Identity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <span className="text-muted-foreground">Genus</span>
                  <p className="font-medium italic">{genus}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Species</span>
                  <p className="font-medium italic">{species}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Common Name</span>
                  <p className="font-medium">
                    {lookupResult?.taxonomy.commonName || "—"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Attribute cards by category */}
          {sortedCategories.map((category) => {
            const catAttrs = groupedAttrs[category];
            return (
              <Card key={category}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base capitalize">
                    {category}{" "}
                    <span className="text-muted-foreground font-normal">
                      ({catAttrs.filter((a) => a.included).length}/
                      {catAttrs.length} selected)
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>Attribute</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {catAttrs.map((attr) => (
                        <TableRow
                          key={attr.key}
                          className={attr.included ? "" : "opacity-50"}
                        >
                          <TableCell>
                            <Checkbox
                              checked={attr.included}
                              onCheckedChange={() => toggleAttribute(attr.key)}
                              disabled={attr.calculated}
                            />
                          </TableCell>
                          <TableCell className="text-sm font-medium">
                            <div>
                              {attr.attributeName}
                              {attr.calculated && (
                                <Badge variant="outline" className="ml-2 text-xs">
                                  calculated
                                </Badge>
                              )}
                              {!attr.attributeId && !attr.calculated && (
                                <Badge variant="secondary" className="ml-2 text-xs">
                                  unmapped
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {attr.sourceColumn}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Input
                              value={attr.value}
                              onChange={(e) =>
                                updateAttributeValue(attr.key, e.target.value)
                              }
                              className="h-8 text-sm"
                              disabled={!attr.included || attr.calculated}
                            />
                            {attr.edited && (
                              <span className="text-xs text-yellow-600">
                                edited (was: {attr.sourceValue})
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {attr.sourceIdCode}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}

          {attributes.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  No attributes found from source databases.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button
              onClick={() => setStep(4)}
              disabled={includedAttrs.length === 0}
            >
              Review & Create ({includedAttrs.length} attributes)
            </Button>
          </div>
        </>
      )}

      {/* Step 4: Confirm & Create */}
      {step === 4 && lookupResult && (
        <Card>
          <CardHeader>
            <CardTitle>Confirm Plant Creation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary */}
            <div className="rounded-md bg-muted p-4 space-y-2 text-sm">
              <div>
                <span className="font-medium">Plant:</span>{" "}
                <span className="italic">
                  {genus} {species}
                </span>
              </div>
              {lookupResult.taxonomy.commonName && (
                <div>
                  <span className="font-medium">Common Name:</span>{" "}
                  {lookupResult.taxonomy.commonName}
                </div>
              )}
              {lookupResult.taxonomy.family && (
                <div>
                  <span className="font-medium">Family:</span>{" "}
                  {lookupResult.taxonomy.family}
                </div>
              )}
              <div>
                <span className="font-medium">Attributes:</span>{" "}
                {includedAttrs.length} from{" "}
                {new Set(includedAttrs.map((a) => a.sourceIdCode)).size} sources
              </div>
              <div>
                <span className="font-medium">Categories:</span>{" "}
                {[
                  ...new Set(includedAttrs.map((a) => a.category)),
                ].join(", ")}
              </div>
              {includedAttrs.some((a) => a.edited) && (
                <div>
                  <Badge
                    variant="outline"
                    className="border-yellow-500 text-yellow-700"
                  >
                    {includedAttrs.filter((a) => a.edited).length} hand-edited
                    values
                  </Badge>
                </div>
              )}
            </div>

            {/* Curator notes */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Curator Notes (optional)
              </label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Notes about this plant entry..."
                value={curatorNotes}
                onChange={(e) => setCuratorNotes(e.target.value)}
              />
            </div>

            {lookupResult.productionMatch.exists && (
              <div className="rounded-md border border-yellow-500 p-3 text-sm text-yellow-700 dark:text-yellow-400">
                This plant already exists in production. Creating it again will
                add a new staging entry. Consider editing the existing plant
                instead.
              </div>
            )}
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(3)}>
              Back
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Creating..." : "Create Plant"}
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
