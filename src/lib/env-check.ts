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

const recommendedInProduction = [
  "RESEND_API_KEY",
  // Razorpay keys only matter when the online-join flow is set to the gateway.
  // In the default manual-UPI mode they are unused, so warning about them in
  // production would just be noise.
  ...(process.env.PAYMENT_MODE === "razorpay"
    ? ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]
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