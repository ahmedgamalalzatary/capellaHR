import path from 'node:path';

import { loadEnvConfig } from '@next/env';
import { assertFrontendEdition } from '@capella/config/edition';
import { resolveApiProxyTarget } from '@capella/config/proxy';
import type { NextConfig } from 'next';

// Single source of environment truth: the repository root .env files.
loadEnvConfig(path.resolve(__dirname, '../..'));
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
  // Workspace packages use ESM `.js` specifiers that point at `.ts` sources.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'],
  },
};

export default nextConfig;
