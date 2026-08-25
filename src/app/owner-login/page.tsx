"use client";

import { useState } from "react";
import { completeOwnerLogin } from "@/app/actions/auth";
import { sendLoginOTP } from "@/app/actions/otp";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import Link from "next/link";
import TurnstileWidget from "@/app/components/turnstile-widget";

export default function OwnerAccessPage() {
  const [step, setStep] = useState<"password" | "otp">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string>("");
  const [captchaKey, setCaptchaKey] = useState(0);

  async function handlePasswordStep(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!captchaToken) {
      setError("Please complete the captcha.");
      return;
    }

    setLoading(true);

    const deviceInfo = `${navigator.userAgent.slice(0, 100)}`;
    const adminEmail = email.trim().toLowerCase();

    // Credentials + captcha are validated server-side here; the OTP email is
    // only sent once they check out.
    const result = await sendLoginOTP(adminEmail, deviceInfo, password, captchaToken);
    setLoading(false);

    if (result.error) {
      setError(result.error);
      // Reset captcha
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

    // Re-checks credentials and the OTP together, then sets the session.
    const loginResult = await completeOwnerLogin(
      email.trim().toLowerCase(),
      password,
      otp
    );
    setLoading(false);

    if (loginResult?.error) {
      setError(loginResult.error);
      // A block or bad credentials means starting over with a fresh captcha.
      if (loginResult.error.toLowerCase().includes("too many")) {
        setStep("password");
        setOtp("");
        setCaptchaToken("");
        setCaptchaKey((k) => k + 1);
      }
      return;
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white px-4 py-6 sm:py-8">
      <div className="max-w-md w-full bg-zinc-900 p-5 sm:p-8 rounded-2xl shadow-2xl border border-yellow-500/20">
        <div className="flex justify-center mb-4 sm:mb-6">
          <img
            src="/images/brothers-gym-logo.svg"
            alt="Brothers Gym logo"
            className="h-20 w-20 sm:h-28 sm:w-28 rounded-full shadow-xl shadow-yellow-500/10"
          />
        </div>

        <div className="text-center mb-5 sm:mb-8">
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-yellow-500 mb-2">
            Owner Only
          </p>
          <h1 className="text-3xl font-black text-white">Secure Access</h1>
          <p className="text-sm text-zinc-400 mt-3">
            {step === "password"
              ? "Enter your admin credentials to proceed."
              : "A 6-digit code has been sent to your email."}
          </p>
        </div>

        {/* STEP 1: Password + Captcha */}
        {step === "password" && (
          <form onSubmit={handlePasswordStep} className="space-y-4 sm:space-y-5">
            <div>
              <label htmlFor="owner-email" className="block text-sm font-medium mb-2">
                Admin Email
              </label>
              <input
                id="owner-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500"
                placeholder="owner@gmail.com"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="owner-password" className="block text-sm font-medium">
                  Password
                </label>
                <Link
                  href="/forgot-password?role=owner"
                  className="text-xs text-yellow-500 hover:text-yellow-400 font-medium"
                >
                  Forgot password?
                </Link>
              </div>
              <input
                id="owner-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500"
                placeholder="Enter private password"
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
                  action="owner-login"
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
              <label htmlFor="owner-otp" className="block text-sm font-medium mb-2">
                Enter 6-digit Code
              </label>
              <input
                id="owner-otp"
                name="otp"
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
              className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-black py-3 px-4 rounded-lg disabled:opacity-50 uppercase tracking-wider"
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
          Even with correct credentials, a verification code is required.
          <br />
          This protects against unauthorized access.
        </p>
      </div>
    </div>
  );
}