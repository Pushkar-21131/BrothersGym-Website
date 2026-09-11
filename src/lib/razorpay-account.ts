/**
 * Per-branch Razorpay credentials.
 *
 * WHY THIS EXISTS
 * The two Brothers Gym branches have different owners. Payments for a Nangal
 * Raya (NR) membership must settle into that owner's bank account, and Sagar Pur
 * (SP) payments into the other's — which means two separate Razorpay merchant
 * accounts, each with its own key pair, its own KYC, and its own webhook secret.
 * A single global RAZORPAY_KEY_ID cannot express that.
 *
 * WHY ENV VARS AND NOT A `branches` COLUMN
 * A live key secret sitting in a Postgres table that the admin panel can read is
 * a far larger blast radius than one in the host's env store: any SQL injection,
 * any over-broad admin query, any database backup handed to a third party now
 * leaks the ability to charge cards. Rotating a compromised key should also not
 * require a database write. The cost is that adding a third branch needs a
 * redeploy, which for a two-branch gym is the right trade.
 *
 * NAMING
 *   RAZORPAY_KEY_ID_NR / RAZORPAY_KEY_SECRET_NR / RAZORPAY_WEBHOOK_SECRET_NR
 *   RAZORPAY_KEY_ID_SP / RAZORPAY_KEY_SECRET_SP / RAZORPAY_WEBHOOK_SECRET_SP
 *
 * The suffix is the branch `code` column, uppercased.
 */

/**
 * A placeholder counts as unset.
 *
 * Left as-is, "rzp_test_xxxxxxxxxx" is a non-empty string, so `||` treats it as
 * a real value and Razorpay answers with a bare 401 "Authentication failed" that
 * says nothing about which variable is wrong.
 */
const isPlaceholder = (v?: string | null): boolean => !v || /x{4,}/i.test(v);

/** Branch `code` → env var suffix. "nr" and "NR" must resolve identically. */
export function normaliseBranchCode(branchCode: string): string {
  return branchCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

/** Internal alias kept for readability at the call sites below. */
const envSuffix = normaliseBranchCode;

/** First of `names` that holds a real (non-placeholder) value. */
function pick(...names: string[]): string | undefined {
  for (const name of names) {
    const v = process.env[name];
    if (!isPlaceholder(v)) return v!.trim();
  }
  return undefined;
}

/**
 * Is the deployment configured with per-branch accounts?
 *
 * THIS GUARD IS THE IMPORTANT PART OF THIS FILE. The obvious implementation of
 * per-branch credentials is "look for RAZORPAY_KEY_ID_<CODE>, fall back to the
 * global RAZORPAY_KEY_ID". That fallback is a money-misrouting bug: configure
 * RAZORPAY_KEY_ID_NR and forget RAZORPAY_KEY_ID_SP, and every SP membership
 * silently charges into the NR owner's account. Nobody notices until an owner
 * reconciles a bank statement, and by then the money is in the wrong person's
 * account.
 *
 * So the fallback is all-or-nothing. The moment ANY suffixed key exists, this
 * deployment is multi-account and every branch must name its own credentials.
 * A missing one is a hard failure with a message that says which var to set.
 */
function isMultiAccount(): boolean {
  return Object.keys(process.env).some(
    (k) => /^RAZORPAY_KEY_ID_[A-Z0-9_]+$/.test(k) && !isPlaceholder(process.env[k])
  );
}

export type RazorpayAccount = {
  /** Normalised branch code this account belongs to. */
  branchCode: string;
  /** Public — checkout.js needs it in the browser. */
  keyId: string;
  /** Secret — signs orders and verifies payment signatures. Never send to a client. */
  keySecret: string;
};

/**
 * Credentials for the Razorpay account that should receive this branch's money.
 *
 * Throws rather than returning null: every caller is about to move money, and a
 * silent fallback is how payments end up in the wrong account.
 */
export function razorpayAccountFor(branchCode: string): RazorpayAccount {
  const suffix = envSuffix(branchCode);
  if (!suffix) throw new Error("razorpayAccountFor called without a branch code");

  const multi = isMultiAccount();

  const keyId = multi
    ? pick(`RAZORPAY_KEY_ID_${suffix}`)
    : pick("RAZORPAY_KEY_ID", "NEXT_PUBLIC_RAZORPAY_KEY_ID");

  const keySecret = multi
    ? pick(`RAZORPAY_KEY_SECRET_${suffix}`)
    : pick("RAZORPAY_KEY_SECRET");

  if (!keyId) {
    throw new Error(
      multi
        ? `Razorpay key ID for branch ${suffix} is missing — set RAZORPAY_KEY_ID_${suffix}. ` +
          `Other branches already have per-branch keys, so the global RAZORPAY_KEY_ID is ` +
          `deliberately NOT used as a fallback: it would settle this branch's payments into ` +
          `another owner's account.`
        : "Razorpay key ID is missing or still a placeholder — set RAZORPAY_KEY_ID in .env"
    );
  }

  if (!keySecret) {
    throw new Error(
      multi
        ? `Razorpay key secret for branch ${suffix} is missing — set RAZORPAY_KEY_SECRET_${suffix}.`
        : "Razorpay key secret is missing or still a placeholder — set RAZORPAY_KEY_SECRET in .env"
    );
  }

  return { branchCode: suffix, keyId, keySecret };
}

/**
 * Webhook signing secret for a branch's Razorpay account.
 *
 * Returns null rather than throwing: the webhook route turns an unconfigured
 * secret into a 503, which is a deliberate "refuse rather than skip
 * verification" and a more useful signal to Razorpay than a 500.
 *
 * NOTE this is NOT the API key secret. It is a separate value chosen in each
 * Razorpay dashboard, and each of the two accounts has its own.
 */
export function razorpayWebhookSecretFor(branchCode: string): string | null {
  const suffix = envSuffix(branchCode);
  if (!suffix) return null;

  return (
    (isMultiAccount()
      ? pick(`RAZORPAY_WEBHOOK_SECRET_${suffix}`)
      : pick("RAZORPAY_WEBHOOK_SECRET")) ?? null
  );
}

/**
 * Branch codes that have a usable Razorpay account configured.
 *
 * Used by the env checker to report a half-configured multi-account setup at
 * startup instead of at the moment a member tries to pay.
 */
export function configuredRazorpayBranchCodes(): string[] {
  return Object.keys(process.env)
    .map((k) => /^RAZORPAY_KEY_ID_([A-Z0-9_]+)$/.exec(k))
    .filter((m): m is RegExpExecArray => Boolean(m) && !isPlaceholder(process.env[m![0]]))
    .map((m) => m[1]);
}
