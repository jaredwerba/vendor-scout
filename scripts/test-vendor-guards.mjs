/**
 * Unit test for the record_vendor guards, using real rows from a production
 * research run: the two the scout eval caught, and nine legitimate findings
 * that must keep passing (including free-mail addresses and contact-form-only).
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/test-vendor-guards.mjs
 */
import {
  directoryHost,
  emailLooksForeign,
  isContactFormOnly,
  sourceIsMissing,
} from "../agent/lib/vendor-guards.ts";

const cases = [
  // Caught by the scout eval (2026-08-29) — must be rejected.
  ["REJECT", "American BBQ Catering", "https://www.yelp.com/biz/american-bbq-catering-rowley", "info@caseyjs.com", null],
  ["REJECT", "Vinwood Caterers", "https://www.weddingwire.com/biz/barn-at-bradstreet-farm-rowley/db2f55d", "inquiries@hideseekmedia.com", null],
  ["REJECT", "Sydney Smith Designs", "https://zola.com/wedding-vendors/wedding-florists/sydney-smith-designs", "contact form only", null],
  // Real findings from the same run — must still pass.
  ["PASS", "Off the Vine Catering", "https://offthevinecatering.com/norwood-off-the-vine-catering-weddings", "info@offthevinecatering.com", "https://offthevinecatering.com"],
  ["PASS", "The Barn at Gibbet Hill", "https://www.barnatgibbethill.com/", "barn@gibbethill.com", "https://www.barnatgibbethill.com"],
  ["PASS", "Willowdale Estate", "https://www.willowdaleestate.com/weddings/pricing", "info@willowdaleestate.com", "https://www.willowdaleestate.com"],
  ["PASS", "Silver + Salt Photo", "https://www.silverandsaltphoto.com", "silverandsaltphoto@gmail.com", "https://www.silverandsaltphoto.com"],
  ["PASS", "Kreative Expressions", "https://kexpressions.com", "kreativeexpressions101@gmail.com", "https://kexpressions.com"],
  ["PASS", "The Sulls", "https://thesullsmusic.com/services/weddings/", "contact@thesullsmusic.com", "https://thesullsmusic.com"],
  ["PASS", "Susanne's Weddings Floral Design Studio", "https://www.susannesweddings.com", "Laurie@susannesweddings.com", "https://www.susannesweddings.com"],
  ["PASS", "Peppers Artful Events", "https://www.peppersartfulevents.com/events/weddings", "EventInquiry@peppersartfulevents.com", "https://www.peppersartfulevents.com"],
  ["PASS", "Copper Penny Flowers", "https://www.copperpennyflowers.com", "contact form only", "https://www.copperpennyflowers.com"],
  // A vendor's own domain that merely CONTAINS a directory pattern. Substring
  // matching rejected all four, silently, with no way for the scout to appeal.
  ["PASS", "Luxe Wedding Co", "https://luxewedding.com/portfolio", "hello@luxewedding.com", "https://luxewedding.com"],
  ["PASS", "Sarah Brides Bridal", "https://sarahbrides.com/about", "sarah@sarahbrides.com", "https://sarahbrides.com"],
  ["PASS", "Skylark Farm", "https://skylark.com/weddings", "events@skylark.com", "https://skylark.com"],
  ["PASS", "Notyelp Studio", "https://notyelp.com/wedding-photography", "hi@notyelp.com", "https://notyelp.com"],
  // A share link in the query string is not a listing.
  ["PASS", "Gibbet Hill Gallery", "https://www.barnatgibbethill.com/gallery?share=facebook.com/x", "barn@gibbethill.com", "https://www.barnatgibbethill.com"],
  // Still directories, on a label boundary — these must keep failing.
  ["REJECT", "Real Knot Listing", "https://www.theknot.com/marketplace/some-venue", "info@example.com", null],
  ["REJECT", "Real Wedding.com Listing", "https://www.wedding.com/vendors/some-florist", "info@example.com", null],
  ["REJECT", "Real Maps Listing", "https://www.google.com/maps/place/some-venue", "info@example.com", null],
];

// Caught by the scout eval (2026-08-29): a real florist in the right town,
// recorded against a page on their own domain that simply does not exist.
const LIVENESS = [
  ["MISSING", "Flowers by Jamie Lynn", "https://flowersbyjamielynn.com/weddings-events"],
  ["PRESENT", "Les Fleurs", "https://lesfleurs.com/wedding-florals"],
  ["PRESENT", "LW Blooms", "https://www.lwblooms.com"],
];

let failures = 0;
for (const [want, name, source, email, website] of cases) {
  const dir = directoryHost(source);
  const foreign = email && !isContactFormOnly(email) && emailLooksForeign(email, website, name);
  const got = dir ? "REJECT(directory)" : foreign ? "REJECT(email)" : "PASS";
  const ok = got.startsWith(want);
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} want ${want.padEnd(6)} got ${got.padEnd(18)} ${name}`);
}
for (const [want, name, url] of LIVENESS) {
  const gone = await sourceIsMissing(url);
  const got = gone ? "MISSING" : "PRESENT";
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} want ${want.padEnd(7)} got ${got.padEnd(7)} ${name}`);
}

console.log(failures === 0 ? "\nvendor guards: all cases behave as intended" : `\nvendor guards: ${failures} MISMATCHES`);
process.exit(failures === 0 ? 0 : 1);
