import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@capella/ui', '@capella/shared', '@capella/contracts'],
};

export default nextConfig;
