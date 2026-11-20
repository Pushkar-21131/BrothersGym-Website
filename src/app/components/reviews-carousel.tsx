"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function ReviewsCarousel({ children, count }: { children: ReactNode; count: number }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const cards = Array.from(track.children) as HTMLElement[];
      const first = cards[0]?.offsetLeft ?? 0;
      let nearest = 0;
      for (let index = 1; index < cards.length; index++) {
        if (Math.abs(cards[index].offsetLeft - first - track.scrollLeft) < Math.abs(cards[nearest].offsetLeft - first - track.scrollLeft)) nearest = index;
      }
      setCurrent(nearest);
    };
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(update); };
    track.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(track);
    update();
    return () => {
      track.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [count]);

  function moveTo(index: number) {
    const track = trackRef.current;
    if (!track) return;
    const card = track.children[Math.max(0, Math.min(count - 1, index))] as HTMLElement | undefined;
    const first = track.firstElementChild as HTMLElement | null;
    if (!card || !first) return;
    track.scrollTo({ left: card.offsetLeft - first.offsetLeft, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }

  return (
    <div className="max-w-xl mx-auto lg:max-w-none">
      <div ref={trackRef} id="member-reviews-track" role="group" aria-label="Member reviews" aria-roledescription="carousel" tabIndex={count > 1 ? 0 : undefined} onKeyDown={(event) => {
        if (event.target !== event.currentTarget || window.matchMedia("(min-width: 1024px)").matches) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          moveTo(current + (event.key === "ArrowRight" ? 1 : -1));
        }
      }} className="public-reviews-track relative grid grid-flow-col auto-cols-[100%] gap-4 items-start overflow-x-auto snap-x snap-mandatory overscroll-x-contain lg:grid-flow-row lg:grid-cols-3 lg:auto-cols-auto lg:gap-6 lg:overflow-visible">
        {children}
      </div>
      {count > 1 && <div className="mt-4 flex items-center justify-center gap-5 lg:hidden">
        <button type="button" aria-label="Previous review" aria-controls="member-reviews-track" disabled={current === 0} onClick={() => moveTo(current - 1)} className="min-h-11 min-w-11 rounded-lg border border-zinc-700 bg-zinc-900 flex items-center justify-center text-yellow-500 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"><ChevronLeft size={20} aria-hidden="true" /></button>
        <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-zinc-400 tabular-nums">Review <span className="text-white font-bold">{current + 1}</span> of {count}</p>
        <button type="button" aria-label="Next review" aria-controls="member-reviews-track" disabled={current === count - 1} onClick={() => moveTo(current + 1)} className="min-h-11 min-w-11 rounded-lg border border-zinc-700 bg-zinc-900 flex items-center justify-center text-yellow-500 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"><ChevronRight size={20} aria-hidden="true" /></button>
      </div>}
    </div>
  );
}
