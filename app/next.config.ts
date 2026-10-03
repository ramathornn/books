import type { NextConfig } from "next";

// Origins allowed to embed the app in a frame (space-separated), e.g. an
// internal portal on a sibling subdomain. Unset = framing is denied outright.
const frameAncestors = (process.env.FRAME_ANCESTORS || '').trim();
const frameHeader = frameAncestors
  ? { key: 'Content-Security-Policy', value: `frame-ancestors 'self' ${frameAncestors}` }
  : { key: 'X-Frame-Options', value: 'DENY' };

const nextConfig: NextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          frameHeader,
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
