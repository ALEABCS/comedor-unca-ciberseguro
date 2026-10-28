import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    watch: { ignored: ["**/*.zip"] },
    proxy: { "/trpc": "http://localhost:4000", "/auth": "http://localhost:4000", "/api": "http://localhost:4000" }
  },
  build: { outDir: "dist" }
});
