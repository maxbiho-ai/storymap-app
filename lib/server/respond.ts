import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "./externalPins";

export const unauthorized = () =>
  NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
  }
  console.error("[external-publish]", err);
  return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
}
