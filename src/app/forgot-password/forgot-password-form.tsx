"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { requestPasswordReset } from "@/app/actions/password-reset";
import TurnstileWidget from "@/app/components/turnstile-widget";
import { Mail, ArrowLeft, AlertTriangle, CheckCircle2 } from "lucide-react";

export default function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const roleParam = searchParams.get("role");
  const role: "owner" | "staff" = roleParam === "owner" ? "owner" : "staff";

  const [email, setEmail] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // Cleared on unmount so a navigation that happens during the 2s delay isn't
  // yanked back to the reset page by a timer that outlived the component.
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!captchaToken) {
      setError("Please complete the captcha.");
      return;
    }

    setLoading(true);

    const formData = new FormData();
    formData.set("email", email);
    formData.set("role", role);
    formData.set("captchaToken", captchaToken);

    const result = await requestPasswordReset(formData);
    setLoading(false);

    if (result.error) {
      setError(result.error);
      setCaptchaToken("");
      setCaptchaKey((k) => k + 1);
      return;
    }

    if (result.success) {
      setMessage(result.message || "Reset code sent!");
      setSubmitted(true);
      // Redirect to reset password page after 2 seconds
      redirectTimer.current = setTimeout(() => {
        router.push(
          `/reset-password?email=${encodeURIComponent(email)}&role=${role}`
        );
      }, 2000);
    }
  }

  // Never link back to a login path from client code — the real login URL is
  // secret (env-configured) and this bundle ships to the browser. Home is the
  // neutral exit; the user re-enters via their bookmarked login link.
  const backLink = "/";

  return (
    <div className="max-w-md w-full bg-zinc-900 p-5 sm:p-8 rounded-2xl border border-zinc-800 shadow-xl">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-500/10 border border-yellow-500/30 rounded-full mb-4">
          <Mail size={28} className="text-yellow-500" />
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-yellow-500 mb-2">
          {role === "owner" ? "Owner" : "Staff"} Password Reset
        </p>
        <h1 className="text-2xl md:text-3xl font-black">Forgot Password?</h1>
        <p className="text-sm text-zinc-400 mt-3">
          Enter your registered email and we&apos;ll send you a code to reset your
          password.
        </p>
      </div>

      {submitted && message ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-4 text-center">
            <CheckCircle2 size={32} className="text-green-500 mx-auto mb-2" />
            <p className="text-green-300 text-sm font-medium">{message}</p>
            <p className="text-zinc-400 text-xs mt-2">
              Check your inbox (and spam folder). Redirecting...
            </p>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="reset-email" className="block text-sm font-medium mb-2">
              {role === "owner" ? "Owner Email" : "Staff Email"}
            </label>
            <input
              id="reset-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              placeholder={
                role === "owner" ? "owner@gmail.com" : "staff@brothersgym.com"
              }
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Verify you&apos;re human
            </label>
            <div key={captchaKey}>
              <TurnstileWidget
                onVerify={(token) => setCaptchaToken(token)}
                action="forgot-password"
                theme="dark"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300 text-sm text-center flex items-center gap-2 justify-center">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !captchaToken}
            className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-black py-3 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider"
          >
            {loading ? "Sending code..." : "Send Reset Code"}
          </button>
        </form>
      )}

      <div className="mt-6 pt-6 border-t border-zinc-800 text-center">
        <Link
          href={backLink}
          className="text-yellow-500 hover:text-yellow-400 text-sm font-medium inline-flex items-center gap-1"
        >
          <ArrowLeft size={14} /> Back to Home
        </Link>
      </div>
    </div>
  );
}