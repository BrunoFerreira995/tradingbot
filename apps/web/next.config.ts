import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  transpilePackages: ['@trade/shared'],
  output: 'standalone',
};
export default nextConfig;
