import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@assistant-ui")) return "assistant-ui";
          if (id.includes("react") || id.includes("scheduler")) return "react-vendor";
          if (id.includes("@base-ui") || id.includes("lucide-react")) return "ui-vendor";
        }
      }
    }
  }
});
