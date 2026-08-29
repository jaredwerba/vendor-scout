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

/** The directory this URL belongs to, or null if it looks like a vendor's own site. */
export function directoryHost(url: string): string | null {
  const lower = url.toLowerCase();
  return DIRECTORY_HOSTS.find((h) => lower.includes(h)) ?? null;
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
