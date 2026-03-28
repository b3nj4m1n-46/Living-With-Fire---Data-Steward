import { fetchClaimViewData } from "@/lib/queries/claims";
import { ClaimViewClient } from "./claim-view-client";

export const dynamic = "force-dynamic";

export default async function ClaimViewPage({
  params,
}: {
  params: Promise<{ plantId: string; attributeId: string }>;
}) {
  const { plantId, attributeId } = await params;
  const data = await fetchClaimViewData(plantId, attributeId);

  return (
    <ClaimViewClient
      data={data}
      plantId={plantId}
      attributeId={attributeId}
    />
  );
}
