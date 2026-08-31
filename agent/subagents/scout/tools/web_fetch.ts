import { disableTool } from "eve/tools";

// The scout's stated surface is two tools: search and record. The framework
// fetch slipped past that sentence — an unbudgeted retrieval path with no
// search-budget cap on it, free to hammer a site that is already blocking.
// Tavily's content is what a scout reads; fetching pages is not its job.
export default disableTool();
