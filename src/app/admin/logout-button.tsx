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
 *
 * The `window.location.assign` is not decoration. The action clears the cookie,
 * but a client-side `router.push` would leave the document — and its router
 * cache and any in-flight prefetch — alive. A prefetch response landing after
 * the clear can put the session cookie back, which is exactly how logout used
 * to fail on the deployed site. A full load discards all of it.
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
          window.location.assign("/");
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
