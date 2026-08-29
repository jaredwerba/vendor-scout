/**
 * Retrieval governance.
 *
 * An unbounded search loop is the classic way an agent burns an afternoon and
 * a budget without converging — a specialist that keeps refining its query
 * looks busy and produces nothing. eve's durable state gives each session its
 * own counter, so the cap is per agent: a specialist gets a research budget,
 * the root gets a larger one for the occasional lookup between conversations.
 *
 * Hitting the cap is not an error. The tool returns `cap_reached` and the
 * model is told to work with what it has — which is exactly what a good
 * researcher does when the clock runs out.
 */
import { defineState } from "eve/context";

export const SPECIALIST_SEARCH_CAP = 25;
export const ROOT_SEARCH_CAP = 40;

const searches = defineState("venus.search", () => ({ count: 0 }));

export function searchCapFor(isSpecialist: boolean): number {
  return isSpecialist ? SPECIALIST_SEARCH_CAP : ROOT_SEARCH_CAP;
}

/** Returns the state of the budget AFTER counting this search. */
export function countSearch(cap: number): { used: number; cap: number; exhausted: boolean } {
  const next = searches.get().count + 1;
  searches.update(() => ({ count: next }));
  return { used: next, cap, exhausted: next > cap };
}

export function searchesUsed(): number {
  return searches.get().count;
}
