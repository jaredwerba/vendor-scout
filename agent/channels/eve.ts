import { eveChannel } from "eve/channels/eve";
import { localDev, none, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [
    // Lets the eve TUI, Vercel runtime callers, and Vercel-to-Vercel reach the agent.
    vercelOidc(),
    // Open on localhost for `eve dev`; ignored everywhere else.
    localDev(),
    // Accept browser traffic. SAFE FOR PREVIEW DEPLOYS ONLY: previews sit behind
    // Vercel Authentication (team login), so this is not publicly reachable.
    // Before promoting to an unprotected production URL, replace with real user
    // auth (e.g. Auth.js/Clerk session -> AuthFn) or enable platform protection.
    none(),
  ],
});
