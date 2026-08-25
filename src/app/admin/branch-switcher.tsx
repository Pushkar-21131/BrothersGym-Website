"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check } from "lucide-react";
import toast from "react-hot-toast";
import { switchBranchAction } from "@/app/actions/auth";

type Branch = {
  id: number;
  code: string;
  name: string;
};

type Props = {
  branches: Branch[];
  currentBranchId: number | "all";
  isOwner: boolean;
};

/**
 * Branch picker for the drawer.
 *
 * Rendered as a list of tappable rows rather than a <select>. The owner
 * switches branches constantly, and a native select on Android takes two taps
 * and hides the current value behind a modal; rows show the whole picture at
 * once and each is a 44px target.
 *
 * Staff cannot switch — they see their branch as a static row.
 */
export default function BranchSwitcher({
  branches,
  currentBranchId,
  isOwner,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function choose(value: string) {
    if (isPending) return;
    startTransition(async () => {
      const r = await switchBranchAction(value);
      if (r.error) {
        toast.error(r.error);
      } else {
        toast.success(`Switched to ${r.branchName}`);
        router.refresh();
      }
    });
  }

  if (!isOwner) {
    const branch = branches.find((b) => b.id === currentBranchId);
    return (
      <div className="adm-nav" style={{ pointerEvents: "none" }}>
        <Building2 size={17} />
        <span>{branch?.name || "—"}</span>
        <span className="adm-nav-count">{branch?.code}</span>
      </div>
    );
  }

  const options: { value: string; label: string; code?: string }[] = [
    { value: "all", label: "All Branches" },
    ...branches.map((b) => ({ value: String(b.id), label: b.name, code: b.code })),
  ];

  return (
    <div style={{ opacity: isPending ? 0.6 : 1 }}>
      {options.map((opt) => {
        const active = String(currentBranchId) === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => choose(opt.value)}
            disabled={isPending}
            className={`adm-nav${active ? " active" : ""}`}
            style={{ width: "100%", textAlign: "left" }}
          >
            <Building2 size={17} />
            <span>{opt.label}</span>
            {active ? (
              <Check size={15} style={{ marginLeft: "auto" }} />
            ) : (
              opt.code && <span className="adm-nav-count">{opt.code}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
