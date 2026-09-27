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
 * The poster image (~300 KB) always renders. The 1.4 MB video is only mounted
 * when the visitor is on a connection that can afford it — previously every
 * mobile visitor downloaded a 4.5 MB file before the page settled, which is
 * expensive on a metered Indian mobile plan for a clip sitting behind a 70%
 * black overlay.
 *
 * The file is 1920x1080, 7 seconds, CRF 26, with -movflags +faststart.
 *
 * DO NOT re-encode this at 720p, or at a high CRF, to save bytes. That was
 * tried, it looked soft on a real screen while the still frames looked fine,
 * and VMAF against the original says why:
 *
 *     720p  crf29    485 KB   VMAF 77.9   <- visibly degraded; shipped once, reverted
 *     1080p crf29    997 KB   VMAF 91.5
 *     720p  crf23    918 KB   VMAF 92.9
 *     1080p crf26   1348 KB   VMAF 95.4   <- what ships
 *
 * The CRF mattered more than the pixel count — 1080p at CRF 29 scores *worse*
 * than 720p at CRF 23 — so the lever to reach for is not resolution. 95+ is
 * the range where a re-encode is indistinguishable from its source. Score a
 * candidate with libvmaf before shipping it; comparing stills will pass a file
 * that scores 78, because compression damage shows up in motion.
 *
 * The savings come from the duration instead:
 *
 *   7s rather than the original 15s. The clip is one bench-press cycle, so it
 *   can be cut anywhere and looped — but only at a frame whose pose matches
 *   frame 0. Measured across 5.6–9.0s, 7.00s is the closest match in the whole
 *   window, and closer than the original 15s seam ever was.
 *
 *   faststart. The moov atom used to sit after the media data, so the browser
 *   could not begin decoding until it had the tail of the file.
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
