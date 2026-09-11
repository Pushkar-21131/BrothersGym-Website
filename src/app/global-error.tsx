"use client";

/**
 * Last-resort error boundary.
 *
 * React calls this when a render throws somewhere the app didn't catch — the
 * case that currently produces a blank page. Because it replaces the root
 * layout, it has to render its own <html> and <body>.
 *
 * Styling is inline rather than from globals.css: if the failure happened
 * during hydration the stylesheet may not have applied, and a crash screen that
 * is itself unstyled looks like a second bug.
 */
import { useEffect } from "react";
import { captureError } from "@/lib/report";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // digest is Next.js's server-side error id — it is the only way to tie this
    // screen back to the matching server log line, so it goes in the report.
    captureError(error, { digest: error.digest, boundary: "global-error" });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#09090b",
          color: "#fafafa",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "420px", textAlign: "center" }}>
          <p
            style={{
              margin: "0 0 12px",
              fontSize: "12px",
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "#eab308",
              fontWeight: 700,
            }}
          >
            Brothers Gym
          </p>
          <h1
            style={{
              margin: "0 0 12px",
              fontSize: "24px",
              fontWeight: 800,
              lineHeight: 1.25,
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              margin: "0 0 24px",
              fontSize: "14px",
              lineHeight: 1.6,
              color: "#a1a1aa",
            }}
          >
            This page hit an unexpected error. We&apos;ve been notified and are
            looking into it.
          </p>

          <div
            style={{
              display: "flex",
              gap: "12px",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={reset}
              style={{
                cursor: "pointer",
                border: "none",
                borderRadius: "9999px",
                padding: "12px 24px",
                fontSize: "14px",
                fontWeight: 700,
                backgroundColor: "#eab308",
                color: "#09090b",
              }}
            >
              Try again
            </button>
            {/* Deliberately a plain <a>, not next/link. The app has already
                crashed, so a client-side navigation would reuse the same broken
                React tree and likely crash again. A full document load throws
                the bad state away and starts clean — which is the whole point
                of this button. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                borderRadius: "9999px",
                padding: "12px 24px",
                fontSize: "14px",
                fontWeight: 700,
                border: "1px solid #3f3f46",
                color: "#fafafa",
                textDecoration: "none",
              }}
            >
              Go home
            </a>
          </div>

          {error.digest ? (
            <p
              style={{
                margin: "24px 0 0",
                fontSize: "11px",
                color: "#52525b",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
