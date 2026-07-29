import type { NextConfig } from 'next';
import packageJson from "./package.json";

const nextConfig: NextConfig = {
  output: 'export',
  env: {
    NEXT_PUBLIC_APP_VERSION:
      process.env.NEXT_PUBLIC_APP_VERSION?.trim() || packageJson.version,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
