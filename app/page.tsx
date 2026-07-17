import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listCuratedWeddings } from "@/agent/lib/curated";
import { VenusApp } from "@/app/_components/venus-app";

export const dynamic = "force-dynamic";

/**
 * Server-side gate: no access cookie -> the unlock page. This is UX only;
 * the eve channel independently validates the cookie on every agent request
 * (middleware can't be used here — it compiles to an Edge Function, which
 * eve's Vercel service packaging rejects).
 */
export default async function Page() {
  const jar = await cookies();
  if (!jar.get("vs_code")?.value) redirect("/unlock");

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

  return <VenusApp curatedPreview={curatedPreview} />;
}
