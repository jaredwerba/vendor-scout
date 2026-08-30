import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * The cookbook catalog.
 *
 * Read from the recipe.json files on disk rather than from a hand-maintained
 * list, for the same reason cookbook/README.md generates its table: a catalog
 * that drifts from the recipes it lists is the quiet kind of wrong this
 * cookbook is about.
 */

interface Recipe {
  slug: string;
  order: number;
  eyebrow: string;
  title: string;
  tagline: string;
  difficulty: string;
  estimatedReadingTime: string;
  stack: { primary: string[]; secondary: string[] };
  tags: string[];
  story: { problem: string; solution: string; outcome: string };
  dir: string;
}

const ARC = [
  "Foundation",
  "Delegation",
  "Durability",
  "Guards",
  "Governance",
  "Cost",
  "Latency",
  "Observability",
  "Evaluation",
  "Verification",
];

function loadRecipes(): Recipe[] {
  const root = join(process.cwd(), "cookbook");
  let dirs: string[] = [];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d\d-/.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
  const out: Recipe[] = [];
  for (const dir of dirs) {
    try {
      out.push({ ...JSON.parse(readFileSync(join(root, dir, "recipe.json"), "utf8")), dir });
    } catch {
      // A recipe that cannot be parsed is left out of the catalog rather than
      // crashing it — but it will fail `build-cookbook-readme.mjs --check`.
    }
  }
  return out.sort((a, b) => a.order - b.order);
}

const GH = "https://github.com/jaredwerba/vendor-scout/tree/main/cookbook";

export default function CookbookPage() {
  const recipes = loadRecipes();

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-8 flex flex-col items-center gap-2 text-center">
          <Link className="venus-script text-5xl text-primary leading-none" href="/">
            Venus
          </Link>
          <h1 className="venus-serif text-2xl">Blueprint Recipes</h1>
          <p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">
            Ten things a wedding-planning agent taught, extracted so they transfer to a domain that
            is not weddings. Each recipe is one fault the system actually hit, the change that fixed
            it, and the rule that generalizes.
          </p>
        </header>

        {/* The arc, so the sequence is visible before the cards. */}
        <div className="mb-8 overflow-x-auto">
          <div className="flex w-max min-w-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            {ARC.map((stage, i) => (
              <span className="flex items-center gap-1.5" key={stage}>
                <span className="rounded-full border px-2.5 py-1">{stage}</span>
                {i < ARC.length - 1 ? <span aria-hidden="true">→</span> : null}
              </span>
            ))}
          </div>
        </div>

        {recipes.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-muted/30 p-6 text-center text-muted-foreground text-sm">
            No recipes found on disk.
          </p>
        ) : (
          <ol className="space-y-3">
            {recipes.map((r) => (
              <li key={r.slug}>
                <a
                  className="block rounded-2xl border bg-card/70 p-5 transition-colors hover:border-primary/40 hover:bg-card"
                  href={`${GH}/${r.dir}/`}
                  rel="noreferrer"
                  target="_blank"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="font-mono text-muted-foreground text-xs tabular-nums">
                      {String(r.order).padStart(2, "0")}
                    </span>
                    <span className="font-medium text-[11px] text-primary uppercase tracking-[0.16em]">
                      {r.eyebrow}
                    </span>
                    <h2 className="venus-serif text-lg leading-snug">{r.title}</h2>
                    <span className="ml-auto flex items-center gap-2">
                      <Badge variant="outline">{r.difficulty}</Badge>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {r.estimatedReadingTime}
                      </span>
                    </span>
                  </div>

                  <p className="mt-2 text-sm leading-relaxed">{r.tagline}</p>

                  <dl className="mt-3 grid gap-2 sm:grid-cols-3">
                    {(
                      [
                        ["Problem", r.story?.problem],
                        ["Change", r.story?.solution],
                        ["Outcome", r.story?.outcome],
                      ] as Array<[string, string | undefined]>
                    ).map(([k, v]) => (
                      <div className="rounded-xl border border-border/70 bg-muted/25 p-3" key={k}>
                        <dt className="mb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                          {k}
                        </dt>
                        <dd className="text-muted-foreground text-xs leading-relaxed">{v}</dd>
                      </div>
                    ))}
                  </dl>

                  <p className="mt-3 flex flex-wrap gap-1.5">
                    {[...(r.stack?.primary ?? []), ...(r.stack?.secondary ?? [])].map((s) => (
                      <span
                        className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                        key={s}
                      >
                        {s}
                      </span>
                    ))}
                  </p>
                </a>
              </li>
            ))}
          </ol>
        )}

        <section className="mt-8 rounded-2xl border border-dashed bg-muted/30 p-5">
          <h2 className="mb-2 font-medium text-sm">Taking these somewhere else</h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            The wedding is incidental. What makes the domain interesting is structural: findings that
            must be verified before they are acted on, an irreversible action at the end, a live
            corpus with no ground truth, and a user who will walk away mid-task and expect the work
            to still be there. Any domain with those four properties hits most of these ten faults —
            a casting agent, a location scout, a grant matcher, a procurement assistant. The guards
            change shape; the failure modes do not.
          </p>
        </section>

        <footer className="mt-8 flex flex-wrap justify-center gap-4 text-muted-foreground text-xs">
          <Link className="hover:text-foreground" href="/">
            ← back to Venus
          </Link>
          <Link className="hover:text-foreground" href="/compare">
            V1 → V2
          </Link>
          <Link className="hover:text-foreground" href="/observe">
            observability
          </Link>
        </footer>
      </div>
    </main>
  );
}
