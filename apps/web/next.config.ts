import path from 'node:path';

import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Single source of environment truth: the repository root .env files.
loadEnvConfig(path.resolve(__dirname, '../..'));

const nextConfig: NextConfig = {
  transpilePackages: ['@capella/ui', '@capella/shared', '@capella/contracts'],
};

export default nextConfig;
