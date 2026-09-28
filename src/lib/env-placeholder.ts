/**
 * Is an environment variable unset — or still set to the masked placeholder that
 * ships in .env.example?
 *
 * WHY THIS IS ITS OWN MODULE
 * Two callers need the same answer and must never disagree:
 *
 *   razorpay-account.ts — decides from it whether per-branch keys are configured,
 *                         and therefore whether the global key is used at all.
 *   env-check.ts        — reports at startup which keys are missing.
 *
 * When those two computed it differently the operator was warned that the global
 * RAZORPAY_KEY_ID "is being IGNORED" while checkout was in fact charging every
 * branch with it. One definition, imported by both, is the fix.
 *
 * Deliberately dependency-free and side-effect-free: env-check.ts runs at module
 * load, before anything else is guaranteed to be initialised, so this must not
 * pull in a client, a database connection, or any other module.
 */

/**
 * A placeholder counts as unset.
 *
 * Left as-is, "rzp_test_xxxxxxxxxx" is a non-empty string, so `||` treats it as
 * a real value and Razorpay answers with a bare 401 "Authentication failed" that
 * says nothing about which variable is wrong. The same applies to a Resend key
 * left at its masked example value.
 */
export function isPlaceholder(v?: string | null): boolean {
  return !v || /x{4,}/i.test(v);
}
