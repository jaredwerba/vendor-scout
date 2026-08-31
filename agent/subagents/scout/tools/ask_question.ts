import { disableTool } from "eve/tools";

// A specialist has nobody to ask. The framework question tool parks the
// session on `input.requested` — but a child lane's question renders in no
// UI, so no one can ever answer it, and the parked child holds the whole
// fan-out hostage: the planner cannot even reach get_research's stall guard
// while a scout() call has not returned. A 10-brief load test (2026-08-31)
// ended with scouts asking "use directories, or slow down?" at minute 12,
// and a live run's music scout parked a finished plan for good the same
// hour. A scout that cannot ask decides: recover, skip, or record what it
// has and report.
export default disableTool();
