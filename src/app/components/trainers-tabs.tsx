"use client";

import { useState } from "react";
import { Building2, MapPin, User } from "lucide-react";
import { formatINR } from "@/lib/utils";

// Add this component at the bottom of the file:
function InstagramIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

type Trainer = {
  id: number;
  branchId: number;
  branchCode: string | null;
  branchName: string | null;
  name: string;
  photoUrl: string | null;
  experience: string;
  ptFee: number;
  isOwner: boolean;
  instagramUrl: string | null;
};

type Branch = {
  id: number;
  code: string;
  name: string;
  address: string;
};

type Props = {
  branches: Branch[];
  trainers: Trainer[];
  owners: Trainer[];
};

export default function TrainersTabs({ branches, trainers, owners }: Props) {
  const [activeBranchId, setActiveBranchId] = useState<number>(branches[0]?.id || 0);

  const activeBranch = branches.find((b) => b.id === activeBranchId);
  const filteredTrainers = trainers.filter((t) => t.branchId === activeBranchId);

  // Minimum PT fee across all trainers of active branch
  const minFee = filteredTrainers.length
    ? Math.min(...filteredTrainers.map((t) => t.ptFee))
    : 0;

  return (
    <div className="space-y-8 md:space-y-16">
      {/* ============ OWNERS SECTION ============ */}
      {owners.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-5 md:mb-8">
            <div className="w-1 h-8 bg-yellow-500 rounded-full"></div>
            <h3 className="text-2xl md:text-3xl font-black uppercase tracking-wide">
              The Owners
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6">
            {owners.map((owner) => (
              <TrainerCard key={owner.id} trainer={owner} isOwner />
            ))}
          </div>
        </div>
      )}

      {/* ============ TRAINERS SECTION WITH TABS ============ */}
      <div>
        {/* Header with tabs on the right */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5 md:mb-8">
          <div className="flex items-center gap-3">
            <div className="w-1 h-8 bg-zinc-500 rounded-full"></div>
            <h3 className="text-2xl md:text-3xl font-black uppercase tracking-wide text-zinc-300">
              Trainers
            </h3>
            {activeBranch && (
              <span className="inline-flex items-center gap-1 text-xs bg-yellow-500/20 text-yellow-500 px-3 py-1 rounded-full font-bold">
                <MapPin size={12} /> {activeBranch.code}
              </span>
            )}
          </div>

          {/* Branch tabs */}
          {branches.length > 1 && (
            <div className="inline-flex bg-zinc-900 border border-zinc-800 rounded-lg p-1 self-start md:self-auto">
              {branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setActiveBranchId(b.id)}
                  className={`px-4 py-2 rounded text-xs font-black uppercase tracking-wider transition-all ${
                    activeBranchId === b.id
                      ? "bg-yellow-500 text-black shadow-lg"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Trainer cards */}
        {filteredTrainers.length === 0 ? (
          <div className="bg-zinc-900/40 border border-zinc-800 border-dashed rounded-2xl p-12 text-center">
            <User size={40} className="text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">
              No trainers listed at {activeBranch?.name} yet.
            </p>
            <p className="text-xs text-zinc-600 mt-1">Check back soon!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6">
            {filteredTrainers.map((trainer) => (
              <TrainerCard key={trainer.id} trainer={trainer} />
            ))}
          </div>
        )}

        {/* Bottom info bar */}
        {filteredTrainers.length > 0 && minFee > 0 && (
          <div className="mt-6 md:mt-8 flex items-center justify-center gap-2 text-sm text-yellow-500/80">
            <span>
              Personal training starts at{" "}
              <span className="font-black text-yellow-500">{formatINR(minFee)}/month</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Trainer Card =====
function TrainerCard({ trainer, isOwner = false }: { trainer: Trainer; isOwner?: boolean }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden group hover:border-yellow-500/50 transition-all duration-300 hover:-translate-y-1">
      {/* Image — 7/8 is portrait, which is right for a narrow grid cell but ~410px
          tall once the card goes full-width on a phone. 4/3 keeps the photo
          prominent without turning one trainer into a whole screen of scrolling. */}
      <div className="aspect-4/3 sm:aspect-7/8 bg-zinc-800 relative overflow-hidden">
        {trainer.photoUrl ? (
          <img
            src={trainer.photoUrl}
            alt={trainer.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <User size={72} className="text-zinc-700" />
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-linear-to-t from-zinc-950 via-zinc-950/60 to-transparent"></div>

        {/* Branch badge — the NR/SP tag and the OWNER tag opposite it were sized for
            a wide card and nearly met in the middle of a ~155px grid cell, so both
            step down a notch on phones. */}
        {trainer.branchCode && (
          <div className="absolute top-2 left-2 sm:top-3 sm:left-3 bg-yellow-500 text-black text-[9px] sm:text-[10px] font-black uppercase tracking-wider sm:tracking-widest px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full flex items-center gap-1 shadow-lg whitespace-nowrap">
            <Building2 strokeWidth={2.5} className="w-2.5 h-2.5 sm:w-[11px] sm:h-[11px]" />
            {trainer.branchCode}
          </div>
        )}

        {/* Owner badge */}
        {isOwner && (
          <div className="absolute top-2 right-2 sm:top-3 sm:right-3 bg-black/60 backdrop-blur-md border border-yellow-500/50 text-yellow-500 text-[9px] sm:text-[10px] font-black uppercase tracking-wider sm:tracking-widest px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full whitespace-nowrap">
            ⭐ Owner
          </div>
        )}

        {/* Name + Instagram at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-3 md:p-4 flex justify-between items-end">
          <div className="flex-1 min-w-0">
            {/* No break-words: that is what split "SHUBHRANT" into "SHUBHRA"/"NT"
                and "BHARDWAJ" into "BHARDW"/"AJ" once the name outgrew a narrow
                cell. Without it a long name wraps between words instead, and at
                full width on a phone it fits one line. */}
            <h4 className="text-xl sm:text-2xl font-black uppercase tracking-wide text-white leading-tight md:truncate drop-shadow-lg">
              {trainer.name}
            </h4>
            <p className="text-[10px] font-black uppercase tracking-widest text-yellow-500 mt-0.5">
              {isOwner ? "Co-Founder" : trainer.branchName}
            </p>
          </div>

          {trainer.instagramUrl && (
            <a
              href={trainer.instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 bg-black/60 backdrop-blur-md border border-white/20 hover:border-yellow-500 hover:bg-yellow-500 p-2 rounded-full transition-all duration-300 shadow-lg group/insta"
              aria-label={`${trainer.name} on Instagram`}
              title="View Instagram"
            >
              <InstagramIcon
                size={16}
                className="text-white group-hover/insta:text-black transition-colors"
              />
            </a>
          )}
        </div>
      </div>

      {/* Card body — compact */}
      <div className="p-3 md:p-4 space-y-2 md:space-y-3">
        <p className="text-xs text-zinc-400 line-clamp-2 min-h-8 leading-relaxed">
          {trainer.experience}
        </p>

        <div className="flex items-center justify-between gap-2 pt-3 border-t border-zinc-800">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest whitespace-nowrap">
            PT / month
          </span>
          <span className="text-lg font-black text-yellow-500 whitespace-nowrap">
            {formatINR(trainer.ptFee)}
          </span>
        </div>
      </div>
    </div>
  );
}