/**
 * Cloudflare Turnstile verification helper.
 * Verifies captcha token on the server before proceeding with sensitive actions.
 */

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = {
  success: boolean;
  error?: string;
};

/**
 * Verify a Turnstile token with Cloudflare's API.
 * Returns { success: true } if valid, or { success: false, error } if invalid.
 */
export async function verifyTurnstile(
  token: string | undefined | null,
  ip?: string
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    console.error("[Turnstile] TURNSTILE_SECRET_KEY not set in environment");
    return {
      success: false,
      error: "Captcha service not configured.",
    };
  }

  if (!token || typeof token !== "string" || !token.trim()) {
    return {
      success: false,
      error: "Please complete the captcha.",
    };
  }

  try {
    const body = new URLSearchParams();
    body.append("secret", secret);
    body.append("response", token);
    if (ip) body.append("remoteip", ip);

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store",
      // Without a deadline a stalled Cloudflare request holds the server action
      // open indefinitely, and the login form just spins with no error.
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error("[Turnstile] Cloudflare API returned:", response.status);
      return {
        success: false,
        error: "Captcha verification service is down. Try again later.",
      };
    }

    const data = (await response.json()) as {
      success: boolean;
      "error-codes"?: string[];
      hostname?: string;
      challenge_ts?: string;
    };

    if (data.success) {
      return { success: true };
    }

    const codes = data["error-codes"] ?? [];
    console.error("[Turnstile] verification failed:", codes);

    // Tokens are single-use and short-lived, so this is the common failure for
    // a real person — a resubmit, or a form left open too long. Saying so beats
    // the generic message, which reads like the captcha itself is broken.
    if (codes.includes("timeout-or-duplicate")) {
      return {
        success: false,
        error: "Captcha expired. Please complete it again.",
      };
    }

    return {
      success: false,
      error: "Captcha verification failed. Please try again.",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      console.error("[Turnstile] verification timed out");
      return {
        success: false,
        error: "Captcha check timed out. Please try again.",
      };
    }
    console.error("[Turnstile] network error:", error);
    return {
      success: false,
      error: "Could not verify captcha. Check your internet connection.",
    };
  }
}