/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pdfkit -> fontkit ships an ESM build that Turbopack's bundler chokes on
  // (a stale @swc/helpers export name, unrelated to this app's code).
  // Marking it external skips bundling entirely and lets Node's own
  // require() resolve it at runtime instead.
  serverExternalPackages: ["pdfkit", "fontkit"],
};

module.exports = nextConfig;
