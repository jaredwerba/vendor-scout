import type { NextConfig } from "next";
import { withEve } from "eve/next";

const nextConfig: NextConfig = {
  async redirects() {
    // Venus is public now — old invitation links land on the front door.
    return [{ source: "/unlock", destination: "/", permanent: false }];
  },
};

export default withEve(nextConfig);
