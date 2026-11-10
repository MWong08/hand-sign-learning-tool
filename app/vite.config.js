import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  base: "./", // relative asset URLs: the build works from any folder (e.g. GitHub Pages)
});
