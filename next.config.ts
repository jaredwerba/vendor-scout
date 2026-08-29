import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  async redirects() {
    // Venus is public now — old invitation links land on the front door.
    return [{ source: "/unlock", destination: "/", permanent: false }];
  },
  async headers() {
    // Nothing here is cacheable. Every page reads live agent state, and a
    // demo that serves a stale session to the next visitor is worse than a
    // slow one. The API routes are explicit about it too, but a CDN or a
    // corporate proxy only ever sees these headers.
    return [
      {
        source: "/:path((?!_next/static|_next/image|favicon).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
    ];
  },
};

export default withEve(nextConfig);
