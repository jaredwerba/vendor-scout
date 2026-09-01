/**
 * Guards on what may be recorded as a vendor.
 *
 * These exist because instructions were not enough. A live production run
 * recorded a caterer from a WeddingWire listing for a *different* business,
 * with the email `inquiries@hideseekmedia.com` — a media company. Outreach
 * runs live, so that inquiry would have reached a real stranger who never
 * asked for it. The scout's instructions already forbade both; repeating a
 * rule the model has already broken is not a control, so `record_vendor`
 * refuses instead.
 */

/** Where vendors are found. Never where one is recorded from. */
export const DIRECTORY_HOSTS = [
  "yelp.", "theknot.", "weddingwire.", "zola.", "eventective.", "wedding-spot.",
  "weddingspot.", "herecomestheguide.", "partyslate.", "thumbtack.", "gigsalad.",
  "google.com/maps", "facebook.", "instagram.", "tripadvisor.", "wedding.com",
  "brides.com", "junebugweddings.", "weddingrule.", "bark.com",
] as const;

/**
 * The directory this URL belongs to, or null if it looks like a vendor's own site.
 *
 * Matched on HOST LABELS, not as a substring of the URL. Plain `includes`
 * read "wedding.com" inside `luxewedding.com` and "brides.com" inside
 * `sarahbrides.com`, so a real vendor's own domain was classified as a
 * directory and silently discarded — and a scout has no way to appeal a
 * guard. A share link in a query string (`?share=facebook.com/...`) did the
 * same to a legitimate gallery page.
 *
 * Three pattern shapes, because the list mixes three intents:
 *   "yelp."           one label, anywhere in the host (yelp.com, yelp.co.uk)
 *   "wedding.com"     a domain suffix, on a label boundary
 *   "google.com/maps" a host plus a path, so the whole URL still applies
 */
export function directoryHost(url: string): string | null {
  const lower = url.toLowerCase();
  const host = lower.split("//").pop()?.split("/")[0].split("?")[0] ?? "";
  const labels = host.split(".");
  const match = (h: string): boolean => {
    if (h.includes("/")) return lower.includes(h);
    if (h.endsWith(".")) return labels.includes(h.slice(0, -1));
    const want = h.split(".");
    const at = labels.length - want.length;
    return at >= 0 && want.every((w, i) => labels[at + i] === w);
  };
  return DIRECTORY_HOSTS.find(match) ?? null;
}

const FREE_MAIL = /^(gmail|yahoo|hotmail|outlook|aol|icloud|comcast|verizon|me)\./;

/**
 * Does this address plausibly belong to this business?
 *
 * Free mail (a gmail address for a small florist) is normal and proves
 * nothing either way, so it passes. What fails is a corporate domain sharing
 * nothing with the vendor's name or website — the signature of an address
 * lifted off a directory page or another company's site.
 */
export function emailLooksForeign(
  email: string,
  website: string | undefined | null,
  name: string,
): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  if (FREE_MAIL.test(domain)) return false;
  const stem = domain
    .replace(/\.(com|net|org|co|us|biz|info|events|co\.uk)$/i, "")
    .replace(/[^a-z0-9]/g, "");
  const site = (website ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (site && site.includes(stem)) return false;
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  if (words.some((w) => stem.includes(w) || w.includes(stem))) return false;
  return true;
}

export const isContactFormOnly = (email: string) => /contact form/i.test(email);

/**
 * Does this page actually exist?
 *
 * A source URL that 404s is not a source — the eval caught a florist recorded
 * against `/weddings-events` on their own domain, a page that is simply not
 * there. Checking it here costs one request per recorded vendor and turns a
 * finding nobody can verify into a rejection the scout can act on.
 *
 * Deliberately lenient: only a definitive 404/410 fails. A 403 is bot
 * blocking, a timeout is the network, and neither means the page is gone —
 * a guard that rejects on those would throw away real vendors, which is the
 * more expensive mistake.
 */
export async function sourceIsMissing(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/128.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10_000),
    });
    return res.status === 404 || res.status === 410;
  } catch {
    // Unreachable is not the same as gone. Let it through; the eval still
    // reports reachability across the whole set.
    return false;
  }
}
