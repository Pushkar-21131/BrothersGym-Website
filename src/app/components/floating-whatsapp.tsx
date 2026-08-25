"use client";

import { useState, useRef, useEffect } from "react";
import { Building2, MessageCircle, X } from "lucide-react";

type Branch = {
  code: string;
  name: string;
  ownerName: string;
  phone: string;
};

// These are hardcoded because they rarely change and this is a client component
const BRANCHES: Branch[] = [
  {
    code: "NR",
    name: "Nangal Raya",
    ownerName: "Shubhrant Thakur",
    phone: "917042061402",
  },
  {
    code: "SP",
    name: "Sagar Pur",
    ownerName: "Tushar Thakur",
    phone: "918076540872",
  },
];

export default function FloatingWhatsApp() {
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  function buildWhatsAppLink(branch: Branch) {
    const msg = encodeURIComponent(
      `Hi ${branch.ownerName}! I want to know more about Brothers Gym ${branch.name} membership.`
    );
    return `https://wa.me/${branch.phone}?text=${msg}`;
  }

  return (
    <div ref={popupRef} className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {/* Popup with branch options */}
      {open && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200 w-72">
          {/* Header */}
          <div className="bg-green-500 p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle size={20} className="text-white" />
              <div>
                <p className="text-white font-black text-sm">Chat With Us</p>
                <p className="text-green-100 text-xs">Choose a branch</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-white/80 hover:text-white"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Branch buttons */}
          <div className="p-3 space-y-2">
            {BRANCHES.map((branch) => (
              <a
                key={branch.code}
                href={buildWhatsAppLink(branch)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800 hover:bg-green-500/10 hover:border-green-500 border border-transparent transition-all group"
              >
                <div className="w-10 h-10 bg-yellow-500/20 border border-yellow-500/30 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-green-500 group-hover:border-green-500 transition-colors">
                  <Building2 size={16} className="text-yellow-500 group-hover:text-white transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold text-sm truncate">{branch.name}</p>
                  <p className="text-zinc-400 text-xs truncate">{branch.ownerName}</p>
                </div>
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center shrink-0">
                  <MessageCircle size={14} className="text-white" />
                </div>
              </a>
            ))}
          </div>

          {/* Footer note */}
          <div className="bg-zinc-950/50 px-4 py-2 border-t border-zinc-800">
            <p className="text-[10px] text-zinc-500 text-center">
              Replies usually within 1 hour
            </p>
          </div>
        </div>
      )}

      {/* Main WhatsApp Button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative bg-green-500 hover:bg-green-400 text-white rounded-full p-4 shadow-2xl shadow-green-500/40 hover:scale-110 transition-all duration-300"
        aria-label="Open WhatsApp chat"
      >
        {!open && (
          <span className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-30"></span>
        )}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-7 h-7 relative z-10"
        >
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      </button>
    </div>
  );
}