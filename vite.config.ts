import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  server: {
    host: true,
    port: 3001,
    strictPort: false,
    proxy: {
      "/api/astro": {
        target: "https://myastrosutra.online",
        changeOrigin: true,
        secure: true,
      },
      "/api/ws": {
        target: "https://myastrosutra.online",
        changeOrigin: true,
        secure: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
