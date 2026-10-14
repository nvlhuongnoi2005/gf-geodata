import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(frontendRoot, "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, "");
  const authTarget = env.VITE_MAP_AUTH_URL || "http://localhost:3001";

  return {
    root: frontendRoot,
    envDir: workspaceRoot,
    base: env.VITE_PUBLIC_BASE_PATH || "/",
    define: {
      "import.meta.env.VITE_MAP_LOGIN_URL": JSON.stringify(
        env.VITE_MAP_LOGIN_URL || "http://webgis.localhost/login"
      )
    },
    plugins: [react()],
    optimizeDeps: { exclude: ["maplibre-gl"] },
    server: {
      proxy: {
        "/auth": { target: authTarget, changeOrigin: true }
      }
    }
  };
});

