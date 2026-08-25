"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          "timeout-callback"?: () => void;
          "unsupported-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "compact" | "flexible";
          action?: string;
          "refresh-expired"?: "auto" | "manual" | "never";
          retry?: "auto" | "never";
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const DEV = process.env.NODE_ENV !== "production";

type Props = {
  onVerify: (token: string) => void;
  onError?: () => void;
  action?: string;
  theme?: "light" | "dark" | "auto";
};

export default function TurnstileWidget({
  onVerify,
  onError,
  action,
  theme = "dark",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [status, setStatus] = useState<string>("Loading captcha...");

  // Store callbacks in refs to prevent re-renders
  const onVerifyRef = useRef(onVerify);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onVerifyRef.current = onVerify;
    onErrorRef.current = onError;
  }, [onVerify, onError]);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!scriptReady) return;
    if (!siteKey) return;
    if (widgetIdRef.current) return; // Already rendered

    let attempts = 0;
    const maxAttempts = 50;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const tryRender = () => {
      if (cancelled) return;
      attempts++;

      if (typeof window === "undefined" || !window.turnstile) {
        if (attempts < maxAttempts) {
          pollTimer = setTimeout(tryRender, 100);
        } else {
          setStatus("Failed to load captcha. Refresh the page.");
        }
        return;
      }

      // The container is normally committed before this effect runs, but if it
      // somehow isn't, keep polling rather than silently giving up with a blank
      // slot and a permanently disabled submit button.
      if (!containerRef.current) {
        if (attempts < maxAttempts) pollTimer = setTimeout(tryRender, 100);
        return;
      }

      try {
        setStatus("");
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          size: "flexible",
          action,
          // Cloudflare refreshes an expired challenge on its own. The old code
          // also called reset() by hand from expired-callback, which raced that
          // refresh and could flash a second challenge.
          "refresh-expired": "auto",
          retry: "auto",
          callback: (token: string) => {
            if (DEV) console.log("[Turnstile] verified");
            onVerifyRef.current(token);
          },
          "error-callback": () => {
            console.error("[Turnstile] widget error");
            setStatus("Captcha error. Try again.");
            // Drop the stale token so the form can't be submitted with it.
            onVerifyRef.current("");
            onErrorRef.current?.();
          },
          "expired-callback": () => {
            // Tokens are only valid for ~5 minutes. The parent was holding on
            // to the expired one, so a slowly-filled form submitted a dead
            // token and came back with "Captcha verification failed".
            if (DEV) console.log("[Turnstile] token expired");
            onVerifyRef.current("");
            setStatus("Captcha expired — verifying again...");
          },
          "timeout-callback": () => {
            if (DEV) console.log("[Turnstile] challenge timed out");
            onVerifyRef.current("");
            setStatus("Captcha timed out. Complete it again.");
          },
          "unsupported-callback": () => {
            onVerifyRef.current("");
            setStatus("This browser can't run the captcha. Try another browser.");
          },
        });
        if (DEV) console.log("[Turnstile] rendered", widgetIdRef.current);
      } catch (err) {
        console.error("[Turnstile] render error:", err);
        setStatus("Failed to render captcha.");
      }
    };

    tryRender();

    return () => {
      // Stop the retry loop first — otherwise a pending poll can re-render the
      // widget into a container this effect just tore down. The owner login
      // remounts this component on every failed attempt (captchaKey), so an
      // uncancelled loop also stacks up across retries.
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);

      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        } catch {
          /* ignore */
        }
      }
    };
  }, [scriptReady, siteKey, theme, action]);

  if (!siteKey) {
    return (
      <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-3">
        <p className="font-bold">⚠️ Captcha not configured</p>
        <p className="mt-1">
          Set <code>NEXT_PUBLIC_TURNSTILE_SITE_KEY</code> in <code>.env</code>
        </p>
      </div>
    );
  }

  return (
    <>
      <Script
        // render=explicit stops Cloudflare from scanning the page for
        // .cf-turnstile elements on load — we render by hand below, and
        // implicit mode is what makes the widget appear twice if a page ever
        // gains a markup-rendered instance.
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onLoad={() => setScriptReady(true)}
        onError={() => {
          console.error("[Turnstile] failed to load script");
          setStatus("Failed to load Cloudflare. Check your internet.");
        }}
      />
      <div ref={containerRef} className="turnstile-widget min-h-[65px]" />
      {status && (
        <p className="text-xs text-zinc-500 mt-2">
          <span className="inline-block animate-pulse text-yellow-500">●</span>{" "}
          {status}
        </p>
      )}
    </>
  );
}