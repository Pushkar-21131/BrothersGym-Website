/**
 * Payment-proof MIME handling and status-poll tokens for the join flow.
 *
 * Like manual-join.ts this is deliberately NOT a "use server" module: it is
 * called from server actions and route handlers, and every export here is a
 * pure function or a token operation, so nothing becomes a public endpoint by
 * living in this file.
 */

import { SignJWT, jwtVerify } from "jose";

// ============================================================================
// PROOF IMAGE
// ============================================================================
//
// UPLOAD VALIDATION USED TO LIVE HERE and is gone: `validateProofImage`, its
// magic-byte sniffer and the base64 size pre-check. Nothing uploads a screenshot
// any more — the QR/proof flow was deleted — so the validator was unreachable,
// and unreachable security code is worse than absent security code because it
// reads like something is still being checked. Git has it if the flow ever
// returns.
//
// What remains is what SERVING an already-stored image still needs.

/**
 * The image types a stored payment screenshot can be.
 *
 * Deliberately a closed list rather than a `startsWith("image/")` test: SVG is
 * an image by that measure and is also a script-execution vector, so it must
 * never reach an <img> the owner opens. /api/admin/join-proof/[id] checks the
 * stored MIME against this list before echoing it in a Content-Type — a row
 * whose column somehow holds anything else is served as a download instead.
 */
export const ALLOWED_PROOF_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ProofMime = (typeof ALLOWED_PROOF_MIMES)[number];

/**
 * Ceiling that WAS enforced on the decoded image, in bytes.
 *
 * Kept as documentation, not as a check: no new images arrive, but this is the
 * bound the retention arithmetic assumes for the ones already stored (~53–120KB
 * of base64 each, see the note on onlineJoins.proofImage), and trainer-photo.ts
 * cites it to explain why its own limit is tighter.
 */
export const MAX_PROOF_BYTES = 300 * 1024;

// ============================================================================
// STATUS POLL TOKEN
// ============================================================================
//
// The status page needs to re-check a request every few seconds so it flips to
// "confirmed" while the member is watching. It cannot just call getJoinStatus on
// a timer: that action is metered at 5 attempts / 15 minutes with a 30-minute
// block (lib/security.ts), which a poll would burn through in under two minutes
// and lock the member out of checking their own membership.
//
// So the reference+phone proof is exchanged ONCE, on the form submit, for a
// short-lived signed token naming the join id. Polling verifies the signature
// instead of re-proving identity, which means the poll endpoint has no
// brute-force surface at all — a token cannot be guessed — and no phone number
// travels back and forth on a timer.

const POLL_TOKEN_AUDIENCE = "join-status-poll";
const POLL_TOKEN_TTL_SECONDS = 60 * 60 * 2; // 2h — longer than anyone waits

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set.");
  return new TextEncoder().encode(secret);
}

/**
 * Mint a poll token for one join id.
 *
 * The audience claim is what keeps this from being interchangeable with an admin
 * session token: both are HS256 over SESSION_SECRET, so without a distinct,
 * verified `aud` a poll token would be a valid session and vice versa.
 */
export async function createStatusPollToken(joinId: number): Promise<string> {
  return await new SignJWT({ joinId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(POLL_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${POLL_TOKEN_TTL_SECONDS}s`)
    .sign(getSecret());
}

/** Verify a poll token. Returns the join id, or null if missing/invalid/expired. */
export async function verifyStatusPollToken(
  token: string | undefined | null
): Promise<number | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
      audience: POLL_TOKEN_AUDIENCE,
    });
    const joinId = payload.joinId;
    if (typeof joinId !== "number" || !Number.isInteger(joinId) || joinId <= 0) {
      return null;
    }
    return joinId;
  } catch {
    return null;
  }
}
