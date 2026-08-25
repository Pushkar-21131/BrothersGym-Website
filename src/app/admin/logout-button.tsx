"use client";

import { useTransition } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";

/**
 * Logout control.
 *
 * Deliberately NOT a <form action={logoutAction}> button. Inside the mobile
 * menu the click handler that closes the menu runs first, unmounting the form
 * before the browser dispatches the submit — the browser then refuses to submit
 * a detached form and logs "Form submission canceled because the form is not
 * connected". Calling the server action directly from a transition has no form
 * to detach, so it works the same in the sidebar and in the menu.
 */
export default function LogoutButton({
  className,
  iconSize = 18,
}: {
  className?: string;
  iconSize?: number;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await logoutAction();
        })
      }
      className={className}
    >
      {pending ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : (
        <LogOut size={iconSize} />
      )}
      <span className="text-sm font-bold">
        {pending ? "Signing out..." : "Logout"}
      </span>
    </button>
  );
}
