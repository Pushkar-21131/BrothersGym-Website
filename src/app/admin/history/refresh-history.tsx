"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export default function RefreshHistory() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" className="adm-btn adm-history-refresh" disabled={pending} aria-busy={pending}
    onClick={() => startTransition(() => router.refresh())}>
    <RefreshCw size={14} /> {pending ? "Refreshing…" : "Refresh"}
  </button>;
}
