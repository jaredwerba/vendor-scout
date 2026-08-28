import { defineEval } from "eve/evals";

/**
 * The front door. A couple arrives with only a budget; Venus must confirm it,
 * ask for names and the signature question, and NOT start researching or
 * emailing anyone yet.
 */
export default defineEval({
  description: "Opener: confirms the budget, asks the signature question, sends nothing.",
  tags: ["fast", "onboarding"],
  async test(t) {
    await t.send("Hi Venus! Our budget is around $28,000 — plan our wedding for us.");
    t.succeeded();
    t.messageIncludes(/28[,.]?000|28k/i);
    t.messageIncludes(/close your eyes/i);
    t.notCalledTool("send_outreach");
    t.notCalledTool("web_search");
    t.notCalledTool("save_wedding_plan");
    t.maxToolCalls(1); // at most one ask_question — the brief is an open question
  },
});
