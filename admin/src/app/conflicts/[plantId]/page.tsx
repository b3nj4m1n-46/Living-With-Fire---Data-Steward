import { fetchPlantConflictAttributes } from "@/lib/queries/conflicts";
import { fetchClaimViewData } from "@/lib/queries/claims";
import { PlantConflictsClient } from "./plant-conflicts-client";

export const dynamic = "force-dynamic";

export default async function PlantConflictsPage({
  params,
}: {
  params: Promise<{ plantId: string }>;
}) {
  const { plantId } = await params;

  const conflictedAttributes = await fetchPlantConflictAttributes(plantId);

  // Parallel-fetch full claim/warrant data for each conflicted attribute
  const attributeDataList = await Promise.all(
    conflictedAttributes
      .filter((a) => a.attribute_id != null)
      .map((a) =>
        fetchClaimViewData(plantId, a.attribute_id!).then((data) => ({
          ...data,
          attributeMeta: a,
        }))
      )
  );

  const plant = attributeDataList[0]?.plant ?? null;

  const totalConflicts = conflictedAttributes.reduce(
    (sum, a) => sum + a.conflict_count,
    0
  );
  const totalUnresolved = conflictedAttributes.reduce(
    (sum, a) => sum + a.unresolved_count,
    0
  );

  return (
    <PlantConflictsClient
      plantId={plantId}
      plant={plant}
      totalConflicts={totalConflicts}
      totalUnresolved={totalUnresolved}
      attributeDataList={attributeDataList}
    />
  );
}
