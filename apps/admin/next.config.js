/** @type {import('next').NextConfig} */
module.exports = {
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: 'http://localhost:4000/api/v1/:path*' },
    ];
  },
};
