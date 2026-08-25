"use client";

import { useActionState, useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { staffLoginAction } from "@/app/actions/auth";
import Link from "next/link";
import toast from "react-hot-toast";
import TurnstileWidget from "@/app/components/turnstile-widget";

function StaffLoginForm() {
  const [state, formAction, pending] = useActionState(staffLoginAction, null);
  const searchParams = useSearchParams();
  const [captchaToken, setCaptchaToken] = useState<string>("");
  const [captchaKey, setCaptchaKey] = useState(0); // Force re-render on error

  useEffect(() => {
    if (searchParams.get("expired") === "1") {
      toast.error("Your session expired. Please login again.");
    }
    if (searchParams.get("reset") === "success") {
      toast.success("Password reset successful! Please login with your new password.");
    }
  }, [searchParams]);

  // If the server returns an error, reset the captcha (token was consumed).
  // This synchronizes an external widget (Turnstile) to server state, which is
  // a valid effect; the token must be cleared only *after* the server responds.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (state?.error) {
      setCaptchaToken("");
      setCaptchaKey((k) => k + 1);
    }
  }, [state]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white px-4 py-6 sm:py-8">
      <div className="max-w-md w-full bg-zinc-900 p-5 sm:p-8 rounded-2xl border border-zinc-800 shadow-xl">
        <div className="text-center mb-5 sm:mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-yellow-500 mb-2">
            Staff Portal
          </p>
          <h1 className="text-3xl font-black">Staff Login</h1>
          <p className="text-sm text-zinc-400 mt-3">
            This login is only for gym staff members.
          </p>
        </div>

        <form action={formAction} className="space-y-4 sm:space-y-5">
          <div>
            <label htmlFor="staff-email" className="block text-sm font-medium mb-2">
              Staff Email
            </label>
            <input
              id="staff-email"
              type="email"
              name="email"
              required
              autoComplete="email"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500"
              placeholder="staff@brothersgym.com"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="staff-password" className="block text-sm font-medium">
                Password
              </label>
              <Link
                href="/forgot-password?role=staff"
                className="text-xs text-yellow-500 hover:text-yellow-400 font-medium"
              >
                Forgot password?
              </Link>
            </div>
            <input
              id="staff-password"
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500"
              placeholder="Enter password"
            />
          </div>

          {/* Cloudflare Turnstile Captcha */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Verify you&apos;re human
            </label>
            <div key={captchaKey}>
              <TurnstileWidget
                onVerify={(token) => setCaptchaToken(token)}
                action="staff-login"
                theme="dark"
              />
            </div>
            <input type="hidden" name="captchaToken" value={captchaToken} />
          </div>

          {state?.error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300 text-sm text-center">
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending || !captchaToken}
            className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-black py-3 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider"
          >
            {pending ? "Checking..." : "Login as Staff"}
          </button>

          {!captchaToken && (
            <p className="text-xs text-zinc-500 text-center">
              Complete the captcha above to enable login
            </p>
          )}
        </form>

        <p className="text-xs text-zinc-500 text-center mt-4 sm:mt-6">
          Staff accounts are created by the gym owner.
        </p>

        <div className="mt-3 sm:mt-4 text-center text-sm">
          <Link href="/" className="text-yellow-500 hover:underline">
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function StaffLoginPage() {
  // useSearchParams requires a Suspense boundary during static prerender.
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white">
          <p className="text-zinc-500">Loading…</p>
        </div>
      }
    >
      <StaffLoginForm />
    </Suspense>
  );
}