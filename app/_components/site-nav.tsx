/**
 * Visible top nav for the engineering pages and the in-session chat header.
 * Links open in a new tab so the current session (and any live overlay on it)
 * stays put. There is no hamburger: hiding these behind a menu is the bug.
 */

export const SITE_NAV_LINKS = [
  { href: "/cookbook", label: "Cookbook" },
  { href: "/compare", label: "V1 → V2" },
  { href: "/observe", label: "Observability" },
  // A static artifact in public/, not a route — there is no page.tsx to pass a
  // `current` for, and target="_blank" below is exactly right for it.
  { href: "/venus-architecture.html", label: "System map" },
  { href: "/curated", label: "Gallery" },
  { href: "/my-wedding", label: "My Wedding" },
  { href: "/outreach", label: "Emails" },
] as const;

export function SiteNavLinks({ current }: { readonly current?: string }) {
  return (
    <>
      {SITE_NAV_LINKS.map((link) =>
        current === link.href ? (
          <span
            aria-current="page"
            className="whitespace-nowrap font-medium text-foreground"
            key={link.href}
          >
            {link.label}
          </span>
        ) : (
          <a
            className="whitespace-nowrap transition-colors hover:text-foreground"
            href={link.href}
            key={link.href}
            rel="noopener noreferrer"
            target="_blank"
          >
            {link.label}
          </a>
        ),
      )}
    </>
  );
}

export function SiteNav({ current }: { readonly current?: string }) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <a
          className="venus-script shrink-0 text-2xl text-primary leading-none"
          href="/"
          rel="noopener noreferrer"
          target="_blank"
        >
          Venus
        </a>
        <nav
          aria-label="Site"
          className="flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1.5 text-muted-foreground text-xs"
        >
          <SiteNavLinks current={current} />
        </nav>
      </div>
    </header>
  );
}
