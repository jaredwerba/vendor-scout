import { NewSession } from "./new-session";

export const dynamic = "force-dynamic";

/**
 * A shareable "start clean" link. Handing someone `/new` guarantees they see
 * Venus from the beginning rather than resuming whatever session that browser
 * happens to be holding.
 */
export default function Page() {
  return <NewSession />;
}
