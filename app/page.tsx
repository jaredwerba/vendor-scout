import { listCuratedWeddings } from "@/agent/lib/curated";
import { modelIdFor, modelRouting } from "@/agent/lib/models";
import { VenusApp } from "@/app/_components/venus-app";

export const dynamic = "force-dynamic";

/**
 * The front door. Venus is public — no access code, no sign-in — so this
 * renders for anyone with the link. The eve channel accepts every chat
 * request the same way (see agent/channels/eve.ts).
 */
export default async function Page() {
  // The landing's gallery doorway: latest curated wedding with a photo.
  let curatedPreview: { image: string | null; title: string; count: number } | null = null;
  try {
    const weddings = await listCuratedWeddings();
    if (weddings.length > 0) {
      const withImage = weddings.find((w) => w.hero_image_url) ?? weddings[0];
      curatedPreview = {
        image: withImage.hero_image_url,
        title: withImage.title,
        count: weddings.length,
      };
    }
  } catch {
    curatedPreview = null;
  }

  // What the live agent-stack panel should say about the model plane. Venus
  // runs a different model per job (agent/lib/models.ts), so the panel reports
  // the routing rather than pretending there is one model.
  const runtime = {
    model: modelIdFor("planner"),
    provider: "Nebius Token Factory",
    tracing: Boolean(process.env.LANGSMITH_API_KEY),
    project: process.env.LANGSMITH_PROJECT ?? "venus",
    roles: modelRouting().map(({ role, model, rationale }) => ({ role, model, rationale })),
  };

  return <VenusApp curatedPreview={curatedPreview} runtime={runtime} />;
}
