import nextra from "nextra";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
if (basePath && (!basePath.startsWith("/") || basePath.endsWith("/"))) {
  throw new Error("NEXT_PUBLIC_BASE_PATH must start with / and have no trailing slash");
}
const withNextra = nextra({ contentDirBasePath: "/" });
export default withNextra({
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
});
