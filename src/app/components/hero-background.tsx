"use client";

import { useSyncExternalStore } from "react";
import Image from "next/image";

type NetworkInformation = {
  saveData?: boolean;
  effectiveType?: string;
};

/** Never changes after mount, so there is nothing to subscribe to. */
function noopSubscribe() {
  return () => {};
}

function shouldPlayVideo(): boolean {
  // Respect an explicit OS-level "reduce motion" preference.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return false;
  }

  const conn = (navigator as Navigator & { connection?: NetworkInformation })
    .connection;

  if (conn?.saveData) return false;
  if (conn?.effectiveType && conn.effectiveType !== "4g") return false;

  return true;
}

/**
 * Hero background.
 *
 * The poster image (~300 KB) always renders. The 4.4 MB video is only mounted
 * when the visitor is on a connection that can afford it — previously every
 * mobile visitor downloaded the whole file before the page settled, which is
 * expensive on a metered Indian mobile plan for a clip sitting behind a 70%
 * black overlay.
 *
 * useSyncExternalStore rather than useEffect + setState: the server snapshot is
 * always false, so SSR and the first client render agree and the video is added
 * in the same commit that reads the connection info.
 */
export default function HeroBackground() {
  const playVideo = useSyncExternalStore(
    noopSubscribe,
    shouldPlayVideo,
    () => false
  );

  return (
    <>
      <Image
        src="/images/hero-poster.jpg"
        alt=""
        aria-hidden="true"
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      {playVideo && (
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="none"
          poster="/images/hero-poster.jpg"
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="/videos/gym-background.mp4" type="video/mp4" />
        </video>
      )}
    </>
  );
}
