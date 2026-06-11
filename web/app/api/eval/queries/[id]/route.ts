import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { devRoutesEnabled } from "@/lib/env";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!devRoutesEnabled()) return new Response(null, { status: 404 });
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  // eval_labels has ON DELETE CASCADE so labels go with the query.
  await sql()`delete from eval_queries where id = ${id}`;
  return NextResponse.json({ ok: true });
}
