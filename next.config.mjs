/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't advertise the framework version in every response.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Clickjacking protection for the app… but public /f/[slug] forms are
        // meant to be embedded on customer sites, so they stay frameable.
        source: "/((?!f/).*)",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};

export default nextConfig;
