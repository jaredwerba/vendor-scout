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
  outsideRadius,
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

// The travel radius, against the towns the 2026-08-30 eval actually judged.
// Coordinates are real (Nominatim, fetched once and pinned) and the geocoder
// is a table, so this block needs no network and no key. The five REJECTs are
// the vendors the judge flagged; Manchester NH is the one it flagged WRONGLY
// (~23 straight-line miles from Methuen), so it must pass here — the guard is
// allowed to disagree with the judge only in the permissive direction... and
// in this one case it is simply right.
const TOWNS = {
  "methuen, ma": { lat: 42.7262, lon: -71.1909 },
  "jackson, nh": { lat: 44.1443, lon: -71.1811 },
  "tamworth, nh": { lat: 43.8603, lon: -71.2635 },
  "keene, nh": { lat: 42.9336, lon: -72.2784 },
  "gilford, nh": { lat: 43.5481, lon: -71.407 },
  "kingston, ma": { lat: 41.9945, lon: -70.7245 },
  "northborough, ma": { lat: 42.3196, lon: -71.6422 },
  "manchester, nh": { lat: 42.9956, lon: -71.4548 },
  "rowley, ma": { lat: 42.7137, lon: -70.8818 },
  "groton, ma": { lat: 42.6112, lon: -71.5745 },
  // The 2026-08-31 Fairlee run, replayed. Coordinates pinned the same way.
  "fairlee, vt": { lat: 43.9061, lon: -72.1587 },
  "white river junction, vt": { lat: 43.6489, lon: -72.3193 },
  "burlington, vt": { lat: 44.4759, lon: -73.2121 },
};
const tableGeocode = async (town) => TOWNS[town.trim().toLowerCase()] ?? null;

const RADIUS = [
  // [want, vendor town] against "Methuen, MA" at 60 minutes (= 45 straight-line miles).
  ["REJECT", "Jackson, NH"],      // ~98 mi — the White Mountains venue
  ["REJECT", "Tamworth, NH"],     // ~79 mi
  ["REJECT", "Keene, NH"],        // ~57 mi
  ["REJECT", "Gilford, NH"],      // ~58 mi
  ["REJECT", "Kingston, MA"],     // ~56 mi, and south of Boston
  ["PASS", "Manchester, NH"],     // ~23 mi — the judge's own false positive
  ["PASS", "Northborough, MA"],   // ~36 mi — borderline, survives
  ["PASS", "Rowley, MA"],
  ["PASS", "Groton, MA"],
];
for (const [want, town] of RADIUS) {
  const hit = await outsideRadius(town, "Methuen, MA", 60, tableGeocode);
  const got = hit ? `REJECT(~${hit.miles}mi > ${hit.limitMiles})` : "PASS";
  const ok = got.startsWith(want);
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} want ${want.padEnd(6)} got ${got.padEnd(20)} ${town} vs Methuen @60min`);
}
// Every way the guard cannot judge must fall open — an unlocatable town, a
// brief with no radius, a brief with no town. Rejecting on ignorance would
// throw away real vendors, the more expensive mistake (same rule as liveness).
for (const [label, hit] of [
  ["unknown town", await outsideRadius("Middle of Nowhere, ZZ", "Methuen, MA", 60, tableGeocode)],
  ["no radius", await outsideRadius("Jackson, NH", "Methuen, MA", undefined, tableGeocode)],
  ["no couple town", await outsideRadius("Jackson, NH", undefined, 60, tableGeocode)],
]) {
  const ok = hit === null;
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} want PASS   got ${ok ? "PASS(open)" : "REJECT"}${" ".repeat(11)} fail-open: ${label}`);
}

// The floor. A planner once delegated a 10-minute venue radius and a
// 25-minute catering radius for a couple who had named no number at all;
// two venues survived and the third tier re-showed the first tier's photos.
// Below 45 minutes the guard tests against 45 — White River Junction vs
// Fairlee is the real caterer that was refused at 25 minutes by one mile,
// and must pass now. A stated hour is above the floor and must not change.
const FLOOR = [
  // [want, vendor town, minutes, expected effective minutes]
  ["PASS", "White River Junction, VT", 25, null], // ~20 mi vs floored ~34-mi limit
  ["REJECT", "Burlington, VT", 10, 45],           // ~65 mi — out even at the floor
  ["REJECT", "Burlington, VT", 60, 60],           // an hour is the couple's own number
];
for (const [want, town, minutes, effective] of FLOOR) {
  const hit = await outsideRadius(town, "Fairlee, VT", minutes, tableGeocode);
  const got = hit ? `REJECT(~${hit.miles}mi > ${hit.limitMiles} @${hit.minutes}min)` : "PASS";
  const ok = got.startsWith(want) && (hit === null || hit.minutes === effective);
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} want ${want.padEnd(6)} got ${got.padEnd(26)} ${town} vs Fairlee @${minutes}min`);
}

console.log(failures === 0 ? "\nvendor guards: all cases behave as intended" : `\nvendor guards: ${failures} MISMATCHES`);
process.exit(failures === 0 ? 0 : 1);
