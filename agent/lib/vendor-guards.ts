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

/** Great-circle distance in statute miles. Pure arithmetic — no network, no model. */
export function distanceMiles(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * A stated drive converted to a straight-line ceiling: ~55 mph of highway
 * times a ~0.8 route factor, so an hour is 45 miles as the crow flies. On the
 * run that motivated this guard, every vendor the judge flagged sat 50+ miles
 * out (Jackson NH ~98, Tamworth ~79, Keene ~57, Gilford ~58, Kingston ~56)
 * and every legitimate one within 40 — generous enough that the borderline
 * survives, wrong enough to catch the White Mountains.
 */
export const STRAIGHT_LINE_MILES_PER_DRIVE_MINUTE = 0.75;

export interface TownPoint {
  lat: number;
  lon: number;
}
export type Geocoder = (town: string) => Promise<TownPoint | null>;

/**
 * One lookup per town per process, nulls cached too — a town Nominatim cannot
 * place once will not be asked about again this run.
 */
const geoCache = new Map<string, TownPoint | null>();

/**
 * Town-level geocoding via Nominatim. Fails to null on ANY trouble — network,
 * timeout, empty result — because an unlocatable town must never reject a
 * vendor. The scout is told to skip towns it cannot place; this guard follows
 * the same rule about towns *it* cannot place.
 */
export async function geocodeTown(town: string): Promise<TownPoint | null> {
  const key = town.trim().toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key) ?? null;
  let point: TownPoint | null = null;
  try {
    const q = encodeURIComponent(town.trim());
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${q}`,
      {
        headers: {
          "user-agent": "venus-wedding-agent/1.0 (github.com/jaredwerba/vendor-scout)",
          accept: "application/json",
        },
        signal: AbortSignal.timeout(6_000),
      },
    );
    if (res.ok) {
      const rows = (await res.json()) as Array<{ lat: string; lon: string }>;
      if (rows[0]) point = { lat: Number(rows[0].lat), lon: Number(rows[0].lon) };
      if (point && (!Number.isFinite(point.lat) || !Number.isFinite(point.lon))) point = null;
    }
  } catch {
    point = null;
  }
  geoCache.set(key, point);
  return point;
}

/**
 * Is this vendor outside the couple's stated travel radius?
 *
 * Decision #8 removed a required drive time because search cannot answer
 * "how long is the drive from A to B" and a scout burned its whole budget
 * trying. The rule then lived only in the prompt, and an eval on 2026-08-30
 * measured what that is worth: 10 of 18 sampled vendors out of region, White
 * Mountains venues in a plan for a couple who said one hour. Drive time is
 * unanswerable here; straight-line distance is two coordinates and a
 * formula, which is a thing a tool CAN check — the boundary recipe 04 draws.
 *
 * Returns the violation, or null for "in radius or cannot judge". Every
 * failure path is fail-open: no couple town, no radius, an ungeocodable
 * town — the vendor records, and the radius judge in the eval still stands
 * behind this guard as the measure of record.
 */
export async function outsideRadius(
  vendorLocation: string,
  coupleLocation: string | undefined | null,
  maxDriveMinutes: number | undefined | null,
  geocode: Geocoder = geocodeTown,
): Promise<{ miles: number; limitMiles: number } | null> {
  if (!coupleLocation?.trim() || !maxDriveMinutes || !Number.isFinite(maxDriveMinutes)) return null;
  const limitMiles = Math.round(maxDriveMinutes * STRAIGHT_LINE_MILES_PER_DRIVE_MINUTE);
  const [vendor, couple] = await Promise.all([
    geocode(vendorLocation),
    geocode(coupleLocation),
  ]);
  if (!vendor || !couple) return null;
  const miles = distanceMiles(vendor, couple);
  return miles > limitMiles ? { miles: Math.round(miles), limitMiles } : null;
}
