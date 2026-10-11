import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dayframe — work and study",
    short_name: "Dayframe",
    description: "Your personal work and study space.",
    start_url: "/",
    display: "standalone",
    background_color: "#10151b",
    theme_color: "#10151b",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
