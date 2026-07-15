import { eveChannel } from "eve/channels/eve";
import { localDev, vercelOidc, type AuthFn } from "eve/channels/auth";

/**
 * Accept anonymous browser traffic ONLY on preview deployments.
 *
 * Preview URLs sit behind Vercel Authentication (team login) at the platform
 * layer, so "anonymous" there still means "someone who passed Vercel SSO".
 * On the public production alias this returns null, so the walk falls through
 * and eve fails closed (401) — nobody can burn model credits anonymously.
 *
 * Before a real public launch, replace this with genuine user auth
 * (e.g. Auth.js/Clerk session -> SessionAuthContext).
 */
function previewOnlyAnonymous(): AuthFn<Request> {
  return async () => {
    if (process.env.VERCEL_ENV !== "preview") return null;
    return {
      authenticator: "preview-anonymous",
      principalId: "preview-visitor",
      principalType: "user",
      attributes: {},
    };
  };
}

export default eveChannel({
  auth: [
    // Lets the eve TUI, Vercel runtime callers, and Vercel-to-Vercel reach the agent.
    vercelOidc(),
    // Open on localhost for `eve dev`; ignored everywhere else.
    localDev(),
    // Browser access for the SSO-gated preview demo only.
    previewOnlyAnonymous(),
  ],
});
