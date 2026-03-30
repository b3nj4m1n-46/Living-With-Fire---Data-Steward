"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PlantDetail, AttributeValueRow, PlantImage, SourceAttribution } from "@/lib/queries/plants";

interface PlantDetailClientProps {
  data: PlantDetail;
}

// --- Value decoding ---

function decodeValue(value: string, valuesAllowed: string | null): string | null {
  if (!valuesAllowed || !value) return null;
  try {
    const allowed = JSON.parse(valuesAllowed) as { id: string; displayName: string }[];
    // Try exact ID match first
    const match = allowed.find((v) => v.id === value);
    if (match) return match.displayName;
    // Try case-insensitive displayName match (value might already be the display name)
    const nameMatch = allowed.find(
      (v) => v.displayName.toLowerCase() === value.toLowerCase()
    );
    if (nameMatch) return nameMatch.displayName;
  } catch {
    // not valid JSON
  }
  return null;
}

/** Character score placement interpretation */
function characterScorePlacement(score: number): string {
  if (score <= 2) return "P0 — Do not plant near structures";
  if (score <= 4) return "P5 — Plant 5-10 ft from buildings";
  if (score <= 8) return "P10 — Plant 10+ ft from buildings";
  if (score <= 12) return "P10S — Plant 10-30 ft (sparse)";
  if (score <= 16) return "P30 — Plant 30+ ft from buildings";
  if (score <= 19) return "P50 — Plant 50+ ft from buildings";
  return "P100 — Plant 100+ ft from buildings";
}

function displayValue(attr: AttributeValueRow): {
  display: string;
  suffix: string;
  subtitle: string;
  isSourceValue: boolean;
} {
  const decoded = decodeValue(attr.value, attr.values_allowed);
  const units = attr.value_units ?? "";

  // If decoded from values_allowed, use the display name
  if (decoded) {
    return { display: decoded, suffix: units ? ` ${units}` : "", subtitle: "", isSourceValue: false };
  }

  // Value exists but wasn't in values_allowed — show it with units
  if (attr.value) {
    let subtitle = "";

    // Character Score: add placement interpretation
    if (attr.attribute_id === "70dcbd81-352d-4678-8d8a-f3bd51f1bab6") {
      const num = Number(attr.value);
      if (!isNaN(num)) subtitle = characterScorePlacement(num);
    }

    return {
      display: attr.value,
      suffix: units ? ` ${units}` : "",
      subtitle,
      isSourceValue: false,
    };
  }

  // Fall back to source_value
  if (attr.source_value) {
    return { display: attr.source_value, suffix: "", subtitle: "", isSourceValue: true };
  }

  return { display: "", suffix: "", subtitle: "", isSourceValue: false };
}

// --- Key attribute IDs for the hero section ---

const HERO_ATTRIBUTES: Record<string, { label: string; icon: string }> = {
  "d996587c-383b-4dc6-a23c-239b7de7e47b": { label: "Fire Rating", icon: "fire" },
  "d9174148-6563-4f92-9673-01feb6a529ce": { label: "Water", icon: "water" },
  "af3e70d2-dc9c-4027-a09f-15d7d8b0dd10": { label: "Drought Tolerant", icon: "drought" },
  "ff4c4d0e-35d5-4804-aea3-2a6334ef8cb5": { label: "Deer Resistance", icon: "deer" },
  "716f3d8f-195f-4d16-824b-6dd1e88767a6": { label: "Native Status", icon: "native" },
  "f0b45dc9-ee00-479a-8181-b4fda01f5233": { label: "Hardiness Zone", icon: "zone" },
  "5d642c32-436d-4075-bbb9-39794bae07d1": { label: "Min Height", icon: "height" },
  "7692e4d8-9e4d-42b2-bdf3-5b386feeecfb": { label: "Max Height", icon: "height" },
  "70dcbd81-352d-4678-8d8a-f3bd51f1bab6": { label: "Character Score", icon: "score" },
};

const RELATIVE_VALUE_CATEGORY = "Relative Value Matrix";

// --- Attribute grouping helpers ---

interface SubGroup {
  name: string;
  attrs: AttributeValueRow[];
}

interface CategoryGroup {
  category: string;
  directAttrs: AttributeValueRow[];
  subGroups: SubGroup[];
}

function buildCategoryGroups(
  attributes: AttributeValueRow[],
  categories: string[]
): CategoryGroup[] {
  const groups: CategoryGroup[] = [];

  for (const category of categories) {
    // Skip Relative Value Matrix — it's internal calculated metadata
    if (category === RELATIVE_VALUE_CATEGORY) continue;

    const catAttrs = attributes.filter(
      (a) => (a.category ?? "Uncategorized") === category && !a.is_calculated
    );
    if (catAttrs.length === 0) continue;

    // Split into direct (parent_name is null or same as category) vs sub-grouped
    const directAttrs: AttributeValueRow[] = [];
    const subMap = new Map<string, AttributeValueRow[]>();

    for (const attr of catAttrs) {
      if (!attr.parent_name || attr.parent_name === category) {
        directAttrs.push(attr);
      } else {
        const list = subMap.get(attr.parent_name) ?? [];
        list.push(attr);
        subMap.set(attr.parent_name, list);
      }
    }

    const subGroups: SubGroup[] = [];
    for (const [name, attrs] of subMap) {
      subGroups.push({ name, attrs });
    }

    groups.push({ category, directAttrs, subGroups });
  }

  return groups;
}

// --- Icon helper for hero stats ---

function StatIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    fire: "\u{1F525}",
    water: "\u{1F4A7}",
    drought: "\u{2600}",
    deer: "\u{1F98C}",
    native: "\u{1F33F}",
    zone: "\u{1F321}",
    height: "\u{1F4CF}",
    score: "\u{2B50}",
  };
  return <span className="text-lg">{icons[type] ?? "\u{25CF}"}</span>;
}

// --- Image Gallery ---

function ImageGallery({ images }: { images: PlantImage[] }) {
  const [selected, setSelected] = useState(0);

  if (images.length === 0) return null;

  const primary = images[selected];

  return (
    <div className="space-y-2">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={primary.image_url}
          alt={primary.image_type ?? "Plant photo"}
          className="h-full w-full object-cover"
        />
        {primary.image_type && (
          <Badge variant="secondary" className="absolute top-2 left-2 capitalize">
            {primary.image_type}
          </Badge>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {images.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setSelected(i)}
              className={`relative h-14 w-14 flex-shrink-0 overflow-hidden rounded border-2 transition-colors ${
                i === selected
                  ? "border-primary"
                  : "border-transparent hover:border-muted-foreground/30"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.image_url}
                alt={img.image_type ?? "Thumbnail"}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
      {primary.copyright && (
        <p className="text-xs text-muted-foreground">{primary.copyright}</p>
      )}
    </div>
  );
}

// --- Hero Stats ---

function HeroStats({ attributes }: { attributes: AttributeValueRow[] }) {
  const stats: { label: string; icon: string; display: string; subtitle: string }[] = [];

  for (const attr of attributes) {
    const hero = HERO_ATTRIBUTES[attr.attribute_id];
    if (!hero) continue;
    const val = displayValue(attr);
    if (!val.display) continue;
    // Avoid duplicate labels (e.g., two height entries)
    if (stats.some((s) => s.label === hero.label)) continue;
    stats.push({
      label: hero.label,
      icon: hero.icon,
      display: val.display + val.suffix,
      subtitle: val.subtitle,
    });
  }

  if (stats.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex items-center gap-2 rounded-lg border bg-card p-2.5 text-sm"
        >
          <StatIcon type={stat.icon} />
          <div className="min-w-0">
            <p className="truncate font-medium">{stat.display}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            {stat.subtitle && (
              <p className="text-xs text-muted-foreground">{stat.subtitle}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Attribute value display ---

function AttrValueDisplay({ attr }: { attr: AttributeValueRow }) {
  const val = displayValue(attr);
  const isBool =
    attr.value_type === "boolean" ||
    val.display === "true" ||
    val.display === "false";

  if (isBool) {
    const isTrue = val.display === "true" || val.display === "Yes";
    return (
      <Badge variant={isTrue ? "default" : "outline"}>
        {isTrue ? "Yes" : "No"}
      </Badge>
    );
  }

  return (
    <span>
      {val.display ? (
        <>
          {val.display}{val.suffix}
          {val.isSourceValue && (
            <span className="ml-1.5 text-xs text-muted-foreground italic">
              (raw)
            </span>
          )}
        </>
      ) : (
        <span className="text-muted-foreground italic">&mdash;</span>
      )}
      {val.subtitle && (
        <p className="text-xs text-muted-foreground mt-0.5">{val.subtitle}</p>
      )}
      {attr.value_notes && (
        <p className="text-xs text-muted-foreground mt-0.5">
          {attr.value_notes}
        </p>
      )}
    </span>
  );
}

// --- Curation badges ---

function CurationBadges({
  attr,
  overlay,
  plantId,
}: {
  attr: AttributeValueRow;
  overlay: PlantDetail["overlay"];
  plantId: string;
}) {
  const warrants = overlay.warrantCounts[attr.attribute_id] ?? 0;
  const conflicts = overlay.conflictCounts[attr.attribute_name] ?? 0;
  const claim = overlay.pendingClaims[attr.attribute_id];

  if (!warrants && !conflicts && !claim) return null;

  const claimHref = `/claims/${plantId}/${attr.attribute_id}`;

  return (
    <div className="flex gap-1.5 flex-wrap">
      {warrants > 0 && (
        <Link href={claimHref}>
          <Badge variant="secondary" className="cursor-pointer hover:bg-secondary/80">
            {warrants} warrant{warrants !== 1 ? "s" : ""}
          </Badge>
        </Link>
      )}
      {conflicts > 0 && (
        <Link href={`/conflicts/${plantId}`}>
          <Badge variant="destructive" className="cursor-pointer">
            {conflicts} conflict{conflicts !== 1 ? "s" : ""}
          </Badge>
        </Link>
      )}
      {claim && (
        <Link href={claimHref}>
          <Badge
            variant={claim.status === "approved" ? "default" : "outline"}
            className="cursor-pointer"
          >
            {claim.status}
          </Badge>
        </Link>
      )}
    </div>
  );
}

// --- Attribute name helper ---

function attrDisplayName(attr: AttributeValueRow): string {
  if (/^\d+[A-Z]?$/.test(attr.attribute_name) && attr.attribute_notes) {
    return attr.attribute_notes;
  }
  return attr.attribute_name;
}

// --- Source display ---

function SourceDisplay({
  attr,
  sourcesByAttribute,
}: {
  attr: AttributeValueRow;
  sourcesByAttribute: Record<string, SourceAttribution[]>;
}) {
  const sources = sourcesByAttribute[attr.attribute_id];

  // If we have production source attributions, show those
  if (sources && sources.length > 0) {
    return (
      <div className="mt-0.5 flex flex-wrap gap-1">
        {sources.map((s) => (
          <span
            key={s.source_id}
            className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
          >
            {s.source_name}
          </span>
        ))}
      </div>
    );
  }

  // Fall back to inline source_name from the value row
  if (attr.source_name) {
    return (
      <p className="mt-0.5 text-xs text-muted-foreground">
        Source: {attr.source_name}
      </p>
    );
  }

  // No source at all
  if (!attr.value_notes?.startsWith("Calculated")) {
    return (
      <p className="mt-0.5 text-xs text-yellow-600 dark:text-yellow-400">
        No source attribution
      </p>
    );
  }

  return null;
}

// --- Card View ---

function CardView({
  groups,
  overlay,
  plantId,
  sourcesByAttribute,
}: {
  groups: CategoryGroup[];
  overlay: PlantDetail["overlay"];
  plantId: string;
  sourcesByAttribute: Record<string, SourceAttribution[]>;
}) {
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <Card key={group.category}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{group.category}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Direct attributes as a flex grid of chips/values */}
            {group.directAttrs.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {group.directAttrs.map((attr, idx) => (
                  <div
                    key={`${attr.attribute_id}-${idx}`}
                    className="flex items-start justify-between gap-2 rounded-md border p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/claims/${plantId}/${attr.attribute_id}`}
                        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {attrDisplayName(attr)}
                      </Link>
                      <div className="mt-1 text-sm">
                        <AttrValueDisplay attr={attr} />
                      </div>
                      <SourceDisplay attr={attr} sourcesByAttribute={sourcesByAttribute} />
                    </div>
                    <CurationBadges
                      attr={attr}
                      overlay={overlay}
                      plantId={plantId}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Sub-grouped attributes */}
            {group.subGroups.map((sub) => (
              <div key={sub.name}>
                <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                  {sub.name}
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {sub.attrs.map((attr, idx) => (
                    <div
                      key={`${attr.attribute_id}-${idx}`}
                      className="flex items-start justify-between gap-2 rounded-md border p-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/claims/${plantId}/${attr.attribute_id}`}
                          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {attrDisplayName(attr)}
                        </Link>
                        <div className="mt-1 text-sm">
                          <AttrValueDisplay attr={attr} />
                        </div>
                        {attr.source_name && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Source: {attr.source_name}
                          </p>
                        )}
                      </div>
                      <CurationBadges
                        attr={attr}
                        overlay={overlay}
                        plantId={plantId}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// --- List View ---

function ListView({
  groups,
  overlay,
  plantId,
  sourcesByAttribute,
}: {
  groups: CategoryGroup[];
  overlay: PlantDetail["overlay"];
  plantId: string;
  sourcesByAttribute: Record<string, SourceAttribution[]>;
}) {
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const allAttrs = [
          ...group.directAttrs,
          ...group.subGroups.flatMap((s) => s.attrs),
        ];

        return (
          <Card key={group.category}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{group.category}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Attribute</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Curation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allAttrs.map((attr, idx) => (
                    <TableRow key={`${attr.attribute_id}-${idx}`}>
                      <TableCell>
                        <Link
                          href={`/claims/${plantId}/${attr.attribute_id}`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {attrDisplayName(attr)}
                        </Link>
                        {attr.parent_name &&
                          attr.parent_name !== group.category && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              ({attr.parent_name})
                            </span>
                          )}
                      </TableCell>
                      <TableCell className="font-medium">
                        <AttrValueDisplay attr={attr} />
                      </TableCell>
                      <TableCell className="text-sm">
                        <SourceDisplay attr={attr} sourcesByAttribute={sourcesByAttribute} />
                      </TableCell>
                      <TableCell>
                        <CurationBadges
                          attr={attr}
                          overlay={overlay}
                          plantId={plantId}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// --- Calculated Fields Summary ---

function CalculatedFieldsSummary({
  attributes,
}: {
  attributes: AttributeValueRow[];
}) {
  const calcAttrs = attributes.filter((a) => a.is_calculated);
  if (calcAttrs.length === 0) return null;

  // Separate the "Has X" flags from other calculated fields
  const hasFlags = calcAttrs.filter((a) => a.attribute_name.startsWith("Has "));
  const otherCalc = calcAttrs.filter(
    (a) => !a.attribute_name.startsWith("Has ")
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Calculated Fields</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {otherCalc.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {otherCalc.map((attr, idx) => {
              const val = displayValue(attr);
              return (
                <div
                  key={`${attr.attribute_id}-${idx}`}
                  className="rounded-md border p-2 text-sm"
                >
                  <p className="text-muted-foreground">{attrDisplayName(attr)}</p>
                  <p className="font-medium">{val.display || "\u2014"}</p>
                </div>
              );
            })}
          </div>
        )}

        {hasFlags.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Completeness Flags
            </p>
            <div className="flex flex-wrap gap-1.5">
              {hasFlags.map((attr, idx) => {
                const val = displayValue(attr);
                const hasIt = val.display === "1" || val.display === "true";
                return (
                  <Badge
                    key={`${attr.attribute_id}-${idx}`}
                    variant={hasIt ? "default" : "outline"}
                  >
                    {attr.attribute_name.replace("Has ", "")}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main Component ---

export function PlantDetailClient({ data }: PlantDetailClientProps) {
  const {
    plant,
    images,
    attributes,
    sourcesByAttribute,
    categories,
    overlay,
    pendingSync,
    pendingClaimCount,
  } = data;

  const groups = buildCategoryGroups(attributes, categories);

  // Count non-calculated attributes
  const userAttrs = attributes.filter((a) => !a.is_calculated);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold">
              <span className="italic">
                {plant.genus} {plant.species}
              </span>
            </h2>
            {pendingSync && (
              <Link href="/sync">
                <Badge
                  variant="outline"
                  className="border-yellow-500 text-yellow-700 dark:text-yellow-400"
                >
                  {pendingClaimCount} pending sync
                </Badge>
              </Link>
            )}
          </div>
          {plant.common_name && (
            <p className="text-lg text-muted-foreground">{plant.common_name}</p>
          )}
          {plant.subspecies_varieties && (
            <p className="text-sm text-muted-foreground">
              {plant.subspecies_varieties}
            </p>
          )}
          {plant.last_updated && (
            <p className="text-sm text-muted-foreground">
              Last updated:{" "}
              {new Date(plant.last_updated).toLocaleDateString()}
            </p>
          )}
        </div>
        <Link href="/plants">
          <Button variant="outline" size="sm">
            Back to Plants
          </Button>
        </Link>
      </div>

      {/* Hero: Images + Key Stats side by side */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {images.length > 0 && (
          <div className="lg:col-span-1">
            <ImageGallery images={images} />
          </div>
        )}
        <div className={images.length > 0 ? "lg:col-span-2" : "lg:col-span-3"}>
          <HeroStats attributes={attributes} />

          {/* Plant notes / urls */}
          {(plant.notes || plant.urls) && (
            <div className="mt-4 space-y-1 text-sm text-muted-foreground">
              {plant.notes && <p>{plant.notes}</p>}
              {plant.urls && (
                <p>
                  <a
                    href={plant.urls}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    External reference
                  </a>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Summary + View Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{userAttrs.length} attribute values</span>
          <span>{groups.length} categories</span>
          {images.length > 0 && <span>{images.length} images</span>}
        </div>
      </div>

      {/* Card / List toggle */}
      {userAttrs.length > 0 ? (
        <Tabs defaultValue="card">
          <TabsList>
            <TabsTrigger value="card">Cards</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
          </TabsList>

          <TabsContent value="card">
            <CardView
              groups={groups}
              overlay={overlay}
              plantId={plant.id}
              sourcesByAttribute={sourcesByAttribute}
            />
          </TabsContent>

          <TabsContent value="list">
            <ListView
              groups={groups}
              overlay={overlay}
              plantId={plant.id}
              sourcesByAttribute={sourcesByAttribute}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              No attribute values found for this plant.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Calculated fields at the bottom */}
      <CalculatedFieldsSummary attributes={attributes} />
    </div>
  );
}
