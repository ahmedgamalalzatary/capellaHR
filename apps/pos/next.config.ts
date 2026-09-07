import path from 'node:path';

import { loadEnvConfig } from '@next/env';
import { assertFrontendEdition } from '@capella/config/edition';
import { resolveApiProxyTarget } from '@capella/config/proxy';
import type { NextConfig } from 'next';

// Next already cached an env load from apps/pos. Reload from the workspace root
// before checking the edition, using the same development/production mode.
loadEnvConfig(path.resolve(__dirname, '../..'), process.env.NODE_ENV === 'development', console, true);
assertFrontendEdition(process.env.EDITION, 'pos');
const apiProxyTarget = resolveApiProxyTarget();

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  transpilePackages: ['@capella/ui', '@capella/shared', '@capella/contracts'],
  rewrites: async () => [{
    source: '/api/:path*',
    destination: `${apiProxyTarget}/api/:path*`,
  }],
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'],
  },
};

export default nextConfig;
