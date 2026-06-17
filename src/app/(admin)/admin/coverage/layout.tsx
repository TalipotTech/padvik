/**
 * Route-scoped layout for `/admin/coverage`.
 *
 * Adds a left sidebar with the admin shell's primary + legacy nav links so
 * the Coverage page — the end-to-end content-ingest workstation — always
 * has one-click access to the rest of the admin without having to scroll
 * back up to the top header. Other admin pages continue to use only the
 * top-header nav defined in `(admin)/layout.tsx`.
 *
 * Inherits the top header, auth gating, and container width from the
 * parent admin layout — this file only layers in the sidebar.
 */
import { CoverageSideNav } from "./_components/coverage-side-nav";

export default function CoverageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      {/* Left sidebar — sticky so the nav stays visible while Coverage
          scrolls through long reports. Collapses to a plain block above
          the content on narrow viewports (keeps touch layouts simple). */}
      <aside className="lg:w-56 lg:shrink-0">
        <div className="lg:sticky lg:top-20">
          <CoverageSideNav />
        </div>
      </aside>

      {/* Main content column. `min-w-0` lets wide tables/grids shrink
          inside the flex row instead of pushing the sidebar off-screen. */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
