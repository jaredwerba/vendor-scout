import { disableTool } from "eve/tools";

// A scout has one category and a search budget. It used two round trips per
// run keeping a to-do list, and a round trip here costs 10-30 seconds of
// model time — measured at 166s of one scout's 220s spent deciding what to
// call next. The list bought nothing that the budget does not already give.
export default disableTool();
