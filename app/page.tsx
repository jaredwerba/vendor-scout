import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { VenusApp } from "@/app/_components/venus-app";

/**
 * Server-side gate: no access cookie -> the unlock page. This is UX only;
 * the eve channel independently validates the cookie on every agent request
 * (middleware can't be used here — it compiles to an Edge Function, which
 * eve's Vercel service packaging rejects).
 */
export default async function Page() {
  const jar = await cookies();
  if (!jar.get("vs_code")?.value) redirect("/unlock");
  return <VenusApp />;
}
