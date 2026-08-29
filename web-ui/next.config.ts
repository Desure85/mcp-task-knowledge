import type { NextConfig } from 'next';

const config: NextConfig = {
  // Proxy API calls to the MCP HTTP transport
  async rewrites() {
    const mcpUrl = process.env.MCP_API_URL || 'http://localhost:3001';
    return [
      { source: '/api/mcp/:path*', destination: `${mcpUrl}/:path*` },
    ];
  },
};

export default config;
