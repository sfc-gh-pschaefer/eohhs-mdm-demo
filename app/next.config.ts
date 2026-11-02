import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Snowflake App Runtime build and run.
 *
 * `output: 'standalone'`: the App Runtime builder packages a standalone
 * server and prunes node_modules from the runtime image, so the template's
 * original `next start` failed at launch with "next: not found". app.yml copies
 * .next/static into the standalone directory and runs server.js on port 8080.
 *
 * `outputFileTracingRoot` is pinned here so Next does not walk up to a parent
 * lockfile and re-root the trace, which ships a broken standalone tree.
 *
 * `snowflake-sdk` is a native Node module and must not be bundled by webpack,
 * or its binary bindings are lost. Standalone tracing still copies it into
 * .next/standalone/node_modules.
 */
const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  reactStrictMode: true,
  serverExternalPackages: ['snowflake-sdk'],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
