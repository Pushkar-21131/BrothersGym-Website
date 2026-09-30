/**
 * Admin loading state.
 *
 * Every admin page is `force-dynamic`: it re-renders on the server on each
 * visit and queries a database in a different region from the functions. Before
 * this file existed, tapping a nav link left the screen completely frozen until
 * the response arrived — no spinner, no skeleton, nothing. A measured wait with
 * no feedback reads as roughly twice as long as the same wait with feedback,
 * which is most of what "the app feels slow" was describing.
 *
 * Nothing here makes anything faster. It makes the wait legible.
 *
 * One generic skeleton at the admin root covers every admin route that does not
 * define its own. It deliberately mirrors the list pages (header plus rows)
 * rather than the dashboard's hero block: the list pages are the ones the owner
 * moves between most, and a skeleton that broadly matches the incoming layout
 * reads as progress instead of as the wrong page appearing.
 *
 * The rows reuse .adm-card so the placeholder inherits the real theme variables
 * from admin.css. Only the bars inside are invented, and they are drawn from
 * white at low opacity rather than a fixed grey so they stay correct if the
 * palette changes.
 */
export default function AdminLoading() {
  return (
    <div className="animate-pulse" aria-busy="true">
      {/* Also announced to a screen reader, which gets nothing from grey bars. */}
      <span className="sr-only">Loading…</span>

      <div className="adm-head">
        <div className="h-6 w-36 rounded-md bg-white/[0.07]" />
        <div className="mt-2 h-3 w-52 rounded bg-white/5" />
      </div>

      <div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="adm-card">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-white/[0.07]" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-1/3 rounded bg-white/[0.07]" />
                <div className="h-3 w-1/2 rounded bg-white/5" />
              </div>
              <div className="h-6 w-16 shrink-0 rounded-full bg-white/[0.06]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
