import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// One IIFE bundle; React + JSX runtime come from the host globals.
export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: "src/plugin.tsx", name: "TrawlDevicesPlugin", formats: ["iife"], fileName: () => "plugin.js" },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
      output: {
        globals: { react: "React", "react-dom": "ReactDOM", "react/jsx-runtime": "ReactJSXRuntime" },
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
  },
});
