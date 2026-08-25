"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { resetPasswordWithOTP } from "@/app/actions/password-reset";
import TurnstileWidget from "@/app/components/turnstile-widget";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  CheckCircle2,
  KeyRound,
} from "lucide-react";

export default function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams.get("email") || "";
  const roleParam = searchParams.get("role");
  const role: "owner" | "staff" = roleParam === "owner" ? "owner" : "staff";

  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Redirect if no email in URL
  useEffect(() => {
    if (!email) {
      router.push("/forgot-password");
    }
  }, [email, router]);

  // Cleared on unmount so a user who navigates during the 3s success screen
  // isn't pulled to the login page afterwards by a stale timer.
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
    formData.set("otp", otp);
    formData.set("newPassword", newPassword);
    formData.set("confirmPassword", confirmPassword);
    formData.set("role", role);
    formData.set("captchaToken", captchaToken);

    const result = await resetPasswordWithOTP(formData);
    setLoading(false);

    if (result.error) {
      setError(result.error);
      setCaptchaToken("");
      setCaptchaKey((k) => k + 1);
      return;
    }

    if (result.success) {
      setSuccess(true);
      // Send home, never to a login path — the real login URL is secret
      // (env-configured) and this bundle ships to the browser. The user signs
      // in again via their bookmarked login link.
      redirectTimer.current = setTimeout(() => {
        router.push("/");
      }, 3000);
    }
  }

  const passwordStrength = {
    length: newPassword.length >= 8,
    upper: /[A-Z]/.test(newPassword),
    lower: /[a-z]/.test(newPassword),
    digit: /\d/.test(newPassword),
    match: newPassword.length > 0 && newPassword === confirmPassword,
  };

  if (success) {
    return (
      <div className="max-w-md w-full bg-zinc-900 p-5 sm:p-8 rounded-2xl border border-zinc-800 shadow-xl text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-green-500/10 border border-green-500/30 rounded-full mb-4">
          <CheckCircle2 size={40} className="text-green-500" />
        </div>
        <h1 className="text-2xl font-black mb-3">Password Reset!</h1>
        <p className="text-zinc-400 text-sm mb-6">
          Your password has been successfully reset. Redirecting to login...
        </p>
        <div className="animate-pulse text-yellow-500 text-xs">Please wait...</div>
      </div>
    );
  }

  return (
    <div className="max-w-md w-full bg-zinc-900 p-5 sm:p-8 rounded-2xl border border-zinc-800 shadow-xl">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-500/10 border border-yellow-500/30 rounded-full mb-4">
          <KeyRound size={28} className="text-yellow-500" />
        </div>
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-yellow-500 mb-2">
          Reset Password
        </p>
        <h1 className="text-2xl md:text-3xl font-black">Set New Password</h1>
        <p className="text-sm text-zinc-400 mt-3">
          Enter the code sent to <br />
          <span className="text-yellow-500 font-medium">{email}</span>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* OTP */}
        <div>
          <label htmlFor="reset-otp" className="block text-sm font-medium mb-2">
            Reset Code (6 digits)
          </label>
          <input
            id="reset-otp"
            name="otp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            required
            maxLength={6}
            autoFocus
            placeholder="000000"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-4 text-center text-xl tracking-[0.5em] font-mono focus:outline-none focus:border-yellow-500"
          />
        </div>

        {/* New Password */}
        <div>
          <label htmlFor="reset-new-password" className="block text-sm font-medium mb-2">
            New Password
          </label>
          <div className="relative">
            <input
              id="reset-new-password"
              name="newPassword"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              placeholder="Enter new password"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:border-yellow-500"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Password strength indicators */}
        {newPassword.length > 0 && (
          <div className="bg-zinc-800/50 rounded-lg p-3 space-y-1 text-xs">
            <StrengthCheck met={passwordStrength.length} text="At least 8 characters" />
            <StrengthCheck met={passwordStrength.upper} text="One uppercase letter (A-Z)" />
            <StrengthCheck met={passwordStrength.lower} text="One lowercase letter (a-z)" />
            <StrengthCheck met={passwordStrength.digit} text="One number (0-9)" />
          </div>
        )}

        {/* Confirm Password */}
        <div>
          <label
            htmlFor="reset-confirm-password"
            className="block text-sm font-medium mb-2"
          >
            Confirm Password
          </label>
          <input
            id="reset-confirm-password"
            name="confirmPassword"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            placeholder="Type password again"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 focus:outline-none focus:border-yellow-500"
          />
          {confirmPassword.length > 0 && (
            <p
              className={`text-xs mt-1 ${
                passwordStrength.match ? "text-green-400" : "text-red-400"
              }`}
            >
              {passwordStrength.match
                ? "✓ Passwords match"
                : "✗ Passwords do not match"}
            </p>
          )}
        </div>

        {/* Captcha */}
        <div>
          <label className="block text-sm font-medium mb-2">Verify you&apos;re human</label>
          <div key={captchaKey}>
            <TurnstileWidget
              onVerify={(token) => setCaptchaToken(token)}
              action="reset-password"
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
          disabled={
            loading ||
            !captchaToken ||
            !passwordStrength.length ||
            !passwordStrength.upper ||
            !passwordStrength.lower ||
            !passwordStrength.digit ||
            !passwordStrength.match ||
            otp.length !== 6
          }
          className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-black py-3 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider"
        >
          {loading ? "Resetting..." : "Reset Password"}
        </button>
      </form>

      <div className="mt-6 pt-6 border-t border-zinc-800 text-center space-y-2">
        <Link
          href={`/forgot-password?role=${role}`}
          className="text-yellow-500 hover:text-yellow-400 text-xs font-medium block"
        >
          Didn&apos;t get the code? Request a new one
        </Link>
      </div>
    </div>
  );
}

function StrengthCheck({ met, text }: { met: boolean; text: string }) {
  return (
    <div
      className={`flex items-center gap-2 ${met ? "text-green-400" : "text-zinc-500"}`}
    >
      <span>{met ? "✓" : "○"}</span>
      <span>{text}</span>
    </div>
  );
}