/** @type {import('next').NextConfig} */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';
module.exports = {
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${API_PROXY_TARGET}/api/v1/:path*` },
    ];
  },
};