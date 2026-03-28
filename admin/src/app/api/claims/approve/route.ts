import pool from "@/lib/dolt";

export async function POST(request: Request) {
  const client = await pool.connect();

  try {
    const body = await request.json();
    const {
      plantId,
      attributeId,
      plantName,
      attributeName,
      warrantIds,
      synthesizedText,
      categoricalValue,
      confidence,
      confidenceReasoning,
      approvalNotes,
      editedValue,
    } = body;

    if (!plantId || !attributeId || !Array.isArray(warrantIds) || warrantIds.length === 0) {
      return Response.json(
        { error: "Missing required fields: plantId, attributeId, warrantIds (non-empty)" },
        { status: 400 }
      );
    }

    // Generate a UUID for the claim
    const idResult = await client.query<{ id: string }>(
      "SELECT gen_random_uuid()::text AS id"
    );
    const claimId = idResult.rows[0].id;

    // Insert claim record
    await client.query(
      `INSERT INTO claims (
        id, status, plant_id, attribute_id, plant_name, attribute_name,
        categorical_value, synthesized_text, confidence, confidence_reasoning,
        warrant_count, approved_by, approved_at, approval_notes, edited_value,
        created_at
      ) VALUES (
        $1, 'approved', $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, 'admin', NOW(), $11, $12,
        NOW()
      )`,
      [
        claimId,
        plantId,
        attributeId,
        plantName ?? null,
        attributeName ?? null,
        categoricalValue ?? null,
        synthesizedText ?? `Approved with ${warrantIds.length} warrant(s)`,
        confidence ?? "MODERATE",
        confidenceReasoning ?? null,
        warrantIds.length,
        approvalNotes ?? null,
        editedValue ?? null,
      ]
    );

    // Insert claim_warrants junction rows
    for (const warrantId of warrantIds) {
      const cwId = (
        await client.query<{ id: string }>(
          "SELECT gen_random_uuid()::text AS id"
        )
      ).rows[0].id;

      await client.query(
        `INSERT INTO claim_warrants (id, claim_id, warrant_id) VALUES ($1, $2, $3)`,
        [cwId, claimId, warrantId]
      );
    }

    // Dolt version control: stage and commit
    await client.query(`SELECT dolt_add('.')`);

    const commitResult = await client.query(
      `SELECT dolt_commit('-m', $1)`,
      [`Approve claim: ${plantName ?? plantId} / ${attributeName ?? attributeId}`]
    );

    // Extract commit hash from dolt_commit result
    const commitRow = commitResult.rows[0];
    const commitHash =
      typeof commitRow === "object"
        ? Object.values(commitRow as Record<string, unknown>)[0]
        : String(commitRow);

    // Store the commit hash on the claim
    await client.query(
      `UPDATE claims SET dolt_commit_hash = $1 WHERE id = $2`,
      [String(commitHash), claimId]
    );

    await client.query(`SELECT dolt_add('.')`);
    await client.query(`SELECT dolt_commit('-m', $1)`, [
      `Store commit hash for claim ${claimId}`,
    ]);

    return Response.json({
      claimId,
      commitHash: String(commitHash),
    });
  } catch (error) {
    console.error("POST /api/claims/approve error:", error);

    // Attempt to reset dirty working state
    try {
      await client.query(`SELECT dolt_checkout('.')`);
    } catch {
      // Ignore cleanup errors
    }

    return Response.json(
      { error: "Failed to approve claim" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
