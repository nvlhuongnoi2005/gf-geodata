import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setWorkerUrl } from "maplibre-gl";
// `?url` only copies this module and drops its relative maplibre-gl-shared.mjs
// import. Treat it as a Vite worker instead so its dependency graph is bundled
// and every generated module is emitted under /assets with a hashed URL.
import mapLibreWorkerURL from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";
import App from "./App";

// Vite fingerprints the worker asset. Explicitly pass that generated URL to
// MapLibre so production nginx never falls back to index.html for the worker.
setWorkerUrl(mapLibreWorkerURL);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
