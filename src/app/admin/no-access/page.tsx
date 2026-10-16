import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { getVerifiedRole, getCurrentUser } from "@/lib/auth-check";
import LogoutButton from "../logout-button";

export const dynamic = "force-dynamic";

/**
 * Where an account with no section switched on lands. Not permission-checked on
 * purpose — being unreachable would restore the dead end it exists to remove.
 */
export default async function NoAccessPage() {
  const role = await getVerifiedRole();
  if (!role) redirect("/login");

  const user = await getCurrentUser();

  return (
    <section className="adm-card" style={{ maxWidth: 460, margin: "32px auto" }}>
      <div
        className="adm-feed-icon tone-gold"
        style={{ width: 38, height: 38, marginBottom: 12 }}
      >
        <ShieldAlert size={18} />
      </div>

      <h1 className="adm-h1" style={{ fontSize: 18, marginBottom: 6 }}>
        No sections are switched on
      </h1>
      <p className="adm-hint" style={{ marginBottom: 4 }}>
        {user?.name ? `${user.name}, your` : "Your"} account is signed in, but it
        hasn&apos;t been given access to any part of the panel yet. Ask the owner
        to turn on the sections you need in <strong>Admin &rarr; Users</strong>.
      </p>
      <p className="adm-hint" style={{ marginBottom: 18 }}>
        Nothing here is broken — there is simply nothing to show.
      </p>

      <LogoutButton className="adm-btn ghost" />
    </section>
  );
}
