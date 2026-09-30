import StatusClient from "./status-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Membership Status | Brothers Gym",
  description:
    "Check the status of your Brothers Gym membership using your reference code and registered phone number.",
  // Matters more here than elsewhere: the page reads a ?ref= query parameter,
  // so without a canonical every reference code would be its own indexable URL.
  alternates: { canonical: "/join/status" },
};

export default async function JoinStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawRef = Array.isArray(params.ref) ? params.ref[0] : params.ref;
  const initialRef = (rawRef || "").trim();

  return (
    <div style={{ backgroundColor: "#0a0a0f", minHeight: "100vh" }}>
      <StatusClient initialRef={initialRef} />
    </div>
  );
}
