import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { RecipeBody } from "../recipe-body";

export const dynamic = "force-dynamic";

/**
 * One recipe, rendered from the markdown on disk.
 *
 * The catalog used to link each card at GitHub. The repository is private, so
 * every one of those links was a 404 for everybody except its owner — a
 * cookbook nobody can open is not a cookbook. The source of truth is still the
 * markdown file; this only reads it.
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
  nextRecipe?: string;
}

function findDir(slug: string): string | null {
  try {
    return (
      readdirSync(join(process.cwd(), "cookbook"), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .find((n) => n.slice(3) === slug) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Relative links point at files in a private repository, so on the web they
 * would resolve to nothing. The path is still worth showing — it is how a
 * reader finds the code once they have the repo — so it renders as inline
 * code rather than as a link that lies.
 */
function delinkRepoPaths(md: string): string {
  return md
    .replace(/\[(`[^`]+`)\]\(\.\.[^)]*\)/g, "$1")
    .replace(/\[([^\]\n]+)\]\(\.\.[^)]*\)/g, "`$1`");
}

export default async function RecipePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dir = findDir(slug);
  if (!dir) notFound();

  let recipe: Recipe;
  let markdown: string;
  try {
    const base = join(process.cwd(), "cookbook", dir);
    recipe = JSON.parse(readFileSync(join(base, "recipe.json"), "utf8"));
    markdown = readFileSync(join(base, "README.md"), "utf8");
  } catch {
    notFound();
  }

  // The page renders its own header from recipe.json, so drop the markdown's
  // h1, tagline blockquote and arc line rather than showing them twice.
  const body = delinkRepoPaths(markdown.replace(/^[\s\S]*?(?=\n## )/, "").trimStart());

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground sm:px-6">
      <article className="mx-auto w-full max-w-3xl">
        <nav className="mb-6 text-muted-foreground text-xs">
          <Link className="hover:text-foreground" href="/cookbook">
            ← all recipes
          </Link>
        </nav>

        <header className="mb-8 border-b pb-6">
          <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="font-mono text-muted-foreground text-xs tabular-nums">
              {String(recipe.order).padStart(2, "0")}
            </span>
            <span className="font-medium text-[11px] text-primary uppercase tracking-[0.16em]">
              {recipe.eyebrow}
            </span>
            <Badge variant="outline">{recipe.difficulty}</Badge>
            <span className="text-muted-foreground text-xs tabular-nums">
              {recipe.estimatedReadingTime}
            </span>
          </div>
          <h1 className="venus-serif mb-2 text-3xl leading-tight">{recipe.title}</h1>
          <p className="text-lg text-muted-foreground leading-relaxed">{recipe.tagline}</p>
          <p className="mt-4 flex flex-wrap gap-1.5">
            {[...recipe.stack.primary, ...recipe.stack.secondary].map((s) => (
              <span
                className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                key={s}
              >
                {s}
              </span>
            ))}
          </p>
        </header>

        <RecipeBody markdown={body} />

        <footer className="mt-10 flex flex-wrap justify-between gap-4 border-t pt-6 text-muted-foreground text-xs">
          <Link className="hover:text-foreground" href="/cookbook">
            ← all recipes
          </Link>
          {recipe.nextRecipe ? (
            <Link className="hover:text-foreground" href={`/cookbook/${recipe.nextRecipe}`}>
              next recipe →
            </Link>
          ) : null}
        </footer>
      </article>
    </main>
  );
}
