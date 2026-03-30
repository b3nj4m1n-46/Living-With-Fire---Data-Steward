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
import type { PlantDetail, AttributeValueRow, PlantImage } from "@/lib/queries/plants";

interface PlantDetailClientProps {
  data: PlantDetail;
}

// --- Value decoding ---

function decodeValue(value: string, valuesAllowed: string | null): string {
  if (!valuesAllowed || !value) return value;
  try {
    const allowed = JSON.parse(valuesAllowed) as { id: string; displayName: string }[];
    const match = allowed.find((v) => v.id === value);
    if (match) return match.displayName;
  } catch {
    // not valid JSON, return raw
  }
  return value;
}

function displayValue(attr: AttributeValueRow): {
  display: string;
  isSourceValue: boolean;
} {
  const decoded = decodeValue(attr.value, attr.values_allowed);
  if (decoded) return { display: decoded, isSourceValue: false };
  if (attr.source_value) return { display: attr.source_value, isSourceValue: true };
  return { display: "", isSourceValue: false };
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
  const stats: { label: string; icon: string; display: string }[] = [];

  for (const attr of attributes) {
    const hero = HERO_ATTRIBUTES[attr.attribute_id];
    if (!hero) continue;
    const val = displayValue(attr);
    if (!val.display) continue;
    // Avoid duplicate labels (e.g., two height entries)
    if (stats.some((s) => s.label === hero.label)) continue;
    stats.push({ label: hero.label, icon: hero.icon, display: val.display });
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
          {val.display}
          {val.isSourceValue && (
            <span className="ml-1.5 text-xs text-muted-foreground italic">
              (raw)
            </span>
          )}
        </>
      ) : (
        <span className="text-muted-foreground italic">&mdash;</span>
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

  return (
    <div className="flex gap-1.5 flex-wrap">
      {warrants > 0 && (
        <Badge variant="secondary">
          {warrants} warrant{warrants !== 1 ? "s" : ""}
        </Badge>
      )}
      {conflicts > 0 && (
        <Link href={`/conflicts/${plantId}`}>
          <Badge variant="destructive">
            {conflicts} conflict{conflicts !== 1 ? "s" : ""}
          </Badge>
        </Link>
      )}
      {claim && (
        <Badge variant={claim.status === "approved" ? "default" : "outline"}>
          {claim.status}
        </Badge>
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

// --- Card View ---

function CardView({
  groups,
  overlay,
  plantId,
}: {
  groups: CategoryGroup[];
  overlay: PlantDetail["overlay"];
  plantId: string;
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
}: {
  groups: CategoryGroup[];
  overlay: PlantDetail["overlay"];
  plantId: string;
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
                      <TableCell className="text-sm text-muted-foreground">
                        {attr.source_name ? (
                          attr.source_name
                        ) : attr.value_notes?.startsWith("Calculated") ? (
                          <span className="italic">calculated</span>
                        ) : (
                          <span className="italic">&mdash;</span>
                        )}
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
            />
          </TabsContent>

          <TabsContent value="list">
            <ListView
              groups={groups}
              overlay={overlay}
              plantId={plant.id}
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
