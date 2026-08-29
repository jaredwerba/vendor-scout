// The same Tavily-backed search the root uses (agent/tools/web_search.ts).
// Declared subagents inherit nothing, so the capability is re-exported here
// rather than duplicated — one implementation, one search budget helper.
export { default } from "../../../tools/web_search";
