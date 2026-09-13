/**
 * Environment variable validator
 * Runs at app startup — refuses to start if critical vars missing
 */

const requiredInProduction = [
  "DATABASE_URL",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "OWNER_EMAIL",
  "SESSION_SECRET",
];

/**
 * True unless online payments are switched off site-wide.
 *
 * PAYMENT_MODE=contact is the kill switch: no gateway is attempted, every join
 * becomes a lead the owner calls, and Razorpay keys are genuinely unused — so
 * warning about them would be noise. Any other value (including unset, and
 * including a stale `manual` left over from the deleted QR flow) means the
 * gateway is live and its keys are required.
 */
const razorpayMode = process.env.PAYMENT_MODE !== "contact";

/**
 * Branch codes that have a per-branch Razorpay key configured.
 *
 * Inlined rather than imported from razorpay-account.ts to keep this file
 * dependency-free — it runs at module load, before anything else is guaranteed
 * to be initialised.
 */
const perBranchCodes = Object.keys(process.env)
  .map((k) => /^RAZORPAY_KEY_ID_([A-Z0-9_]+)$/.exec(k))
  .filter((m): m is RegExpExecArray => Boolean(m) && Boolean(process.env[m![0]]?.trim()))
  .map((m) => m[1]);

/**
 * The two branches have different owners, so each has its own Razorpay account.
 * Once any per-branch key exists the global RAZORPAY_KEY_ID is no longer used as
 * a fallback (that fallback would settle one branch's payments into the other
 * owner's bank account), so the two setups are validated differently.
 */
const isMultiAccount = perBranchCodes.length > 0;

const recommendedInProduction = [
  "RESEND_API_KEY",
  // No DSN in production means errors are invisible — they reach console.error
  // and nothing else. Not fatal (the site runs fine), but it is the difference
  // between finding out about a broken payment from a dashboard and finding out
  // from a member's phone call.
  "NEXT_PUBLIC_SENTRY_DSN",
  // Razorpay keys only matter while the gateway is live. Under
  // PAYMENT_MODE=contact they are genuinely unused, so warning about them in
  // production would just be noise.
  ...(razorpayMode
    ? isMultiAccount
      ? perBranchCodes.flatMap((code) => [
          `RAZORPAY_KEY_SECRET_${code}`,
          `RAZORPAY_WEBHOOK_SECRET_${code}`,
        ])
      : ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]
    : []),
];

function validateEnv() {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const key of requiredInProduction) {
    if (!process.env[key] || process.env[key]?.trim() === "") {
      missing.push(key);
    }
  }

  for (const key of recommendedInProduction) {
    if (!process.env[key] || process.env[key]?.trim() === "") {
      warnings.push(key);
    }
  }

  // Weak password check
  const password = process.env.ADMIN_PASSWORD;
  if (password && password.length < 8) {
    warnings.push("ADMIN_PASSWORD is very short (<8 chars). Use a stronger password.");
  }
  if (password && ["admin", "admin123", "password", "12345678"].includes(password.toLowerCase())) {
    missing.push("ADMIN_PASSWORD is a common weak password. Change it immediately.");
  }

  // Session signing secret check
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    missing.push("SESSION_SECRET (signs the admin session cookie — generate with node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\")");
  } else if (sessionSecret.trim().length < 32) {
    warnings.push("SESSION_SECRET is very short (<32 chars). Use a longer random value.");
  }

  // ===== PAYMENT_MODE SANITY =====
  // Only "contact" is special; everything else means the gateway is live. A
  // typo'd or stale value therefore fails SAFE (payments on) rather than silently
  // off — but it should still be said out loud, because "manual" used to be a
  // real mode and someone reading the env file will assume it still is.
  const mode = process.env.PAYMENT_MODE?.trim();
  if (mode && mode !== "contact" && mode !== "razorpay") {
    warnings.push(
      `PAYMENT_MODE="${mode}" is not a recognised value — treating it as "razorpay" ` +
        `(gateway live). The only two values are "razorpay" and "contact". If you meant ` +
        `to switch online payments off, set PAYMENT_MODE=contact — the CSP is now built ` +
        `per request in lib/csp.ts, so this takes effect without a rebuild.`
    );
  }

  // The gateway is on but nothing is configured to charge with. Every member's
  // order call fails and they all land on the contact screen — the site still
  // works, but nobody pays online and nothing in the UI says why.
  if (
    razorpayMode &&
    !isMultiAccount &&
    !process.env.RAZORPAY_KEY_ID?.trim()
  ) {
    warnings.push(
      "online payments are ON but NO Razorpay account is configured, so every " +
        "checkout will fail over to the contact-the-owner screen. Set " +
        "RAZORPAY_KEY_ID_<CODE> / RAZORPAY_KEY_SECRET_<CODE> per branch, or set " +
        "PAYMENT_MODE=contact if that is intended."
    );
  }

  // ===== PER-BRANCH RAZORPAY SANITY =====
  // The failure this catches is expensive and silent: configure NR, forget SP,
  // and SP's checkout throws at the moment a member tries to pay. Surfacing it
  // at startup costs nothing.
  if (razorpayMode && isMultiAccount) {
    if (perBranchCodes.length === 1) {
      warnings.push(
        `only one branch (${perBranchCodes[0]}) has a Razorpay account configured. ` +
          `Per-branch mode is active, so every OTHER branch's checkout will fail rather ` +
          `than fall back to the global key — that fallback is disabled deliberately, ` +
          `because it would settle one branch's payments into the other owner's bank ` +
          `account. Add RAZORPAY_KEY_ID_<CODE> and RAZORPAY_KEY_SECRET_<CODE> per branch.`
      );
    }
    if (
      process.env.RAZORPAY_KEY_ID?.trim() ||
      process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID?.trim()
    ) {
      warnings.push(
        "a global RAZORPAY_KEY_ID / NEXT_PUBLIC_RAZORPAY_KEY_ID is set but is being " +
          "IGNORED, because per-branch keys are configured. Remove it so there is no " +
          "doubt about which account is live."
      );
    }
  }

  if (missing.length > 0) {
    const message = [
      "",
      "===============================================",
      "❌ CRITICAL: Missing environment variables",
      "===============================================",
      ...missing.map((v) => `  - ${v}`),
      "",
      "Set these in your .env file (or Vercel dashboard).",
      "App will not start.",
      "===============================================",
      "",
    ].join("\n");

    if (process.env.NODE_ENV === "production") {
      throw new Error(message);
    } else {
      console.error(message);
    }
  }

  if (warnings.length > 0 && process.env.NODE_ENV === "production") {
    console.warn(
      "\n⚠️  Missing recommended env vars: " +
        warnings.join(", ") +
        "\n  Some features may not work.\n"
    );
  }
}

validateEnv();