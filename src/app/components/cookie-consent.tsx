"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Cookie, X } from "lucide-react";

const CONSENT_COOKIE = "cookie-consent";
const CONSENT_VERSION = "1.0";

export default function CookieConsent() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Check if user has already consented
    const consent = getCookie(CONSENT_COOKIE);
    if (!consent || consent !== CONSENT_VERSION) {
      // Show after slight delay for better UX
      const timer = setTimeout(() => setShow(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  function acceptAll() {
    setCookie(CONSENT_COOKIE, CONSENT_VERSION, 365);
    setShow(false);
  }

  function acceptEssential() {
    setCookie(CONSENT_COOKIE, "essential-only", 365);
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 md:p-6 animate-in slide-in-from-bottom duration-500">
      <div className="max-w-4xl mx-auto bg-zinc-900 border border-yellow-500/30 rounded-2xl shadow-2xl overflow-hidden">
        {/* Content */}
        <div className="p-5 md:p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-yellow-500/20 border border-yellow-500/30 rounded-xl flex items-center justify-center shrink-0">
              <Cookie size={24} className="text-yellow-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-bold text-lg mb-2">
                We value your privacy
              </h3>
              <p className="text-zinc-400 text-sm leading-relaxed mb-1">
                Brothers Gym uses essential cookies to keep you logged in and process
                payments securely. We do NOT use tracking cookies or share your data
                with advertisers.
              </p>
              <p className="text-xs text-zinc-500">
                By continuing, you agree to our{" "}
                <Link
                  href="/privacy"
                  className="text-yellow-500 underline hover:text-yellow-400"
                >
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
            <button
              onClick={acceptEssential}
              className="text-zinc-500 hover:text-white shrink-0"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 mt-5">
            <button
              onClick={acceptAll}
              className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-black py-3 px-6 rounded-lg transition-colors uppercase tracking-wider text-sm"
            >
              Accept All Cookies
            </button>
            <button
              onClick={acceptEssential}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 px-6 rounded-lg transition-colors text-sm"
            >
              Essential Only
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Cookie helpers =====
function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(";").shift() || null;
  return null;
}

function setCookie(name: string, value: string, days: number) {
  if (typeof document === "undefined") return;
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value}; expires=${date.toUTCString()}; path=/; SameSite=Lax`;
}