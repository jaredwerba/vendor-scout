/**
 * Does this model actually honour a JSON schema, every time?
 *
 * Accuracy sweeps answer "is it right when it answers". This answers the
 * prior question: does it answer at all in the shape it was asked for. The
 * two came apart badly here — DeepSeek-V4-Flash matched the incumbent on
 * accuracy in a single sweep and then failed 4 of 30 structured-output calls,
 * which an accuracy score alone reads as a tie.
 *
 * A failure here is not a wrong answer, it is no answer: classifyReply falls
 * back to keyword heuristics, and a misread vendor reply means follow-ups
 * chasing someone who already said yes.
 *
 *   npm run probe:schema
 *   npm run probe:schema -- deepseek-ai/DeepSeek-V4-Flash zai-org/GLM-5.3-Flash
 */
import { readFileSync } from "node:fs";
import { generateObject } from "ai";
import { replyIntelSchema } from "../agent/lib/classify.ts";
import { MODEL_ROLES } from "../agent/lib/models.ts";
import { tokenFactoryModel } from "../agent/lib/nebius.ts";
import { priceFor } from "../agent/lib/pricing.ts";

interface Case {
  vendorName: string;
  replyText: string;
}

const cases = JSON.parse(
  readFileSync(new URL("../evals/data/vendor-replies.json", import.meta.url), "utf8"),
) as Case[];

const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const models =
  args.length > 0
    ? args
    : [MODEL_ROLES.classifier.model, MODEL_ROLES.scout.model, MODEL_ROLES.judge.model];
const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 2);

for (const id of models) {
  if (!priceFor(id)) {
    console.log(`skip ${id} — not in the Token Factory price table`);
    continue;
  }
  let ok = 0;
  let fail = 0;
  const errors = new Map<string, number>();

  for (let round = 0; round < ROUNDS; round += 1) {
    for (const c of cases) {
      try {
        await generateObject({
          model: tokenFactoryModel(id),
          schema: replyIntelSchema,
          prompt: `A wedding vendor ("${c.vendorName}") replied. Classify it.\n\nREPLY:\n${c.replyText.slice(0, 6000)}`,
        });
        ok += 1;
        process.stdout.write(".");
      } catch (error) {
        fail += 1;
        process.stdout.write("x");
        const key = `${(error as Error)?.name ?? "Error"}: ${String((error as Error)?.message ?? error).slice(0, 90)}`;
        errors.set(key, (errors.get(key) ?? 0) + 1);
      }
    }
  }

  const total = ok + fail;
  const rate = total ? (fail / total) * 100 : 0;
  console.log(`\n${id}`);
  console.log(
    `  ${ok}/${total} honoured the schema · ${rate.toFixed(0)}% failure rate over ${ROUNDS} rounds`,
  );
  for (const [k, v] of errors) console.log(`   ${v}× ${k}`);
}
