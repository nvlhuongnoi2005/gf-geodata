import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setWorkerUrl } from "maplibre-gl";
import mapLibreWorkerURL from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
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
