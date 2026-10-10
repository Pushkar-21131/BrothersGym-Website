"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { staffLoginAction, completeStaffLogin } from "@/app/actions/auth";
import Link from "next/link";
import toast from "react-hot-toast";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import TurnstileWidget from "@/app/components/turnstile-widget";

function StaffLoginForm() {
  const searchParams = useSearchParams();
  const [step, setStep] = useState<"password" | "otp">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string>("");
  const [captchaKey, setCaptchaKey] = useState(0); // Force re-render on error

  useEffect(() => {
    if (searchParams.get("expired") === "1") {
      toast.error("Your session expired. Please login again.");
    }
  }, [searchParams]);

  async function handlePasswordStep(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!captchaToken) {
      setError("Please complete the captcha.");
      return;
    }

    setLoading(true);

    const deviceInfo = `${navigator.userAgent.slice(0, 100)}`;

    // Credentials and captcha are checked server-side here; the code is only
    // emailed once they both check out.
    const result = await staffLoginAction(
      email.trim().toLowerCase(),
      password,
      deviceInfo,
      captchaToken
    );
    setLoading(false);

    if (result.error) {
      setError(result.error);
      // The Turnstile token is spent either way, so the widget has to be
      // re-issued before another attempt can be made.
      setCaptchaToken("");
      setCaptchaKey((k) => k + 1);
      return;
    }

    setStep("otp");
  }

  async function handleOTPStep(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Re-checks the password alongside the code, then sets the session.
    const result = await completeStaffLogin(
      email.trim().toLowerCase(),
      password,
      otp
    );
    setLoading(false);

    if (result?.error) {
      setError(result.error);
      // A block or wrong credentials means starting over with a fresh captcha.
      if (result.error.toLowerCase().includes("too many")) {
        setStep("password");
        setOtp("");
        setCaptchaToken("");
        setCaptchaKey((k) => k + 1);
      }
    }
  }

  // min-h-dvh, not min-h-screen — see the note in owner-login/page.tsx.
  return (
    <div className="min-h-dvh flex items-center justify-center bg-zinc-950 text-white px-4 py-6 sm:py-8">
      <div className="max-w-md w-full bg-zinc-900 p-5 sm:p-8 rounded-2xl border border-zinc-800 shadow-xl">
        <div className="text-center mb-5 sm:mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-yellow-500 mb-2">
            Staff Portal
          </p>
          <h1 className="text-3xl font-black">Staff Login</h1>
          <p className="text-sm text-zinc-400 mt-3">
            {step === "password"
              ? "This login is only for gym staff members."
              : "A 6-digit code has been sent to your email."}
          </p>
        </div>

        {/* STEP 1: Password + Captcha */}
        {step === "password" && (
          <form onSubmit={handlePasswordStep} className="space-y-4 sm:space-y-5">
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500"
                placeholder="staff@brothersgym.com"
              />
            </div>

            <div>
              <label htmlFor="staff-password" className="block text-sm font-medium mb-2">
                Password
              </label>
              <input
                id="staff-password"
                type="password"
                name="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              {loading ? "Sending verification..." : "Continue"}
            </button>

            {!captchaToken && (
              <p className="text-xs text-zinc-500 text-center">
                Complete the captcha above to continue
              </p>
            )}
          </form>
        )}

        {/* STEP 2: OTP Verification */}
        {step === "otp" && (
          <form onSubmit={handleOTPStep} className="space-y-5">
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center">
              <ShieldCheck size={24} className="text-green-500 mx-auto mb-2" />
              <p className="text-sm text-green-300">
                Verification code sent to your email
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                Check your inbox (and spam folder)
              </p>
            </div>

            <div>
              <label htmlFor="staff-otp" className="block text-sm font-medium mb-2">
                Enter 6-digit Code
              </label>
              <input
                id="staff-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) =>
                  setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                required
                maxLength={6}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-4 text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:border-yellow-500"
                placeholder="000000"
                autoFocus
              />
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300 text-sm text-center flex items-center gap-2 justify-center">
                <AlertTriangle size={16} />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-black py-3 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider"
            >
              {loading ? "Verifying..." : "Verify & Login"}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("password");
                setOtp("");
                setError("");
                setCaptchaToken("");
                setCaptchaKey((k) => k + 1);
              }}
              className="w-full text-zinc-500 hover:text-zinc-300 text-sm py-2"
            >
              ← Go back
            </button>
          </form>
        )}

        <p className="text-xs text-zinc-500 text-center mt-4 sm:mt-6">
          Staff passwords are set by the gym owner.
          <br />
          Ask the owner if you need yours changed.
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
        <div className="min-h-dvh flex items-center justify-center bg-zinc-950 text-white">
          <p className="text-zinc-500">Loading…</p>
        </div>
      }
    >
      <StaffLoginForm />
    </Suspense>
  );
}
