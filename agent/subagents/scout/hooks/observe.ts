// Declared subagents inherit no hooks, and a specialist that is invisible to
// the trace store is a specialist nobody can watch. Re-export the root's
// observer so every child session writes its own summary and is linked to
// its root through ctx.session.parent.
export { default } from "../../../hooks/observe";
