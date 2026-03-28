import { query } from "@/lib/dolt";

const VALID_STATUSES = ["included", "excluded", "unreviewed", "flagged"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!body.status || !VALID_STATUSES.includes(body.status)) {
      return Response.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    const rows = await query<{ id: string; status: string }>(
      `UPDATE warrants SET status = $1, curated_at = NOW() WHERE id = $2 RETURNING id, status`,
      [body.status, id]
    );

    if (rows.length === 0) {
      return Response.json({ error: "Warrant not found" }, { status: 404 });
    }

    return Response.json(rows[0]);
  } catch (error) {
    console.error("PATCH /api/warrants/[id] error:", error);
    return Response.json(
      { error: "Failed to update warrant" },
      { status: 500 }
    );
  }
}
