import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root to THIS project. A stray lockfile higher up
  // (C:\Users\GGPC\package-lock.json) makes Next infer the wrong root, which
  // can destabilize Server Action IDs ("Failed to find Server Action").
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
