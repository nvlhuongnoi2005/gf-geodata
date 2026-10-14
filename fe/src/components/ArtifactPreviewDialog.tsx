import { useEffect, useRef, useState } from "react";
import { Alert, Box, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Stack, Typography } from "@mui/material";
import { X } from "lucide-react";
import { Map, NavigationControl, type StyleSpecification } from "maplibre-gl";
import { useI18n } from "../i18n";

type TileJSON = {
  name: string; format: string; bounds: [number, number, number, number]; minzoom: number; maxzoom: number;
  vector_layers?: Array<{ id: string }>;
};

function previewStyle(tileJSONURL: string, tileJSON: TileJSON): StyleSpecification {
  const isVector = tileJSON.format === "pbf" || tileJSON.format === "mvt";
  const source = isVector
    ? { type: "vector" as const, url: tileJSONURL }
    : { type: "raster" as const, url: tileJSONURL, tileSize: 256 };
  if (!isVector) {
    return { version: 8, sources: { artifact: source }, layers: [{ id: "background", type: "background", paint: { "background-color": "#edf2f7" } }, { id: "artifact", type: "raster", source: "artifact" }] };
  }
  const layers: StyleSpecification["layers"] = [{ id: "background", type: "background", paint: { "background-color": "#f8fafc" } }];
  for (const layer of tileJSON.vector_layers ?? []) {
    layers.push(
      { id: `${layer.id}-fill`, type: "fill", source: "artifact", "source-layer": layer.id, paint: { "fill-color": "#3b82f6", "fill-opacity": 0.28 } },
      { id: `${layer.id}-line`, type: "line", source: "artifact", "source-layer": layer.id, paint: { "line-color": "#1d4ed8", "line-width": 1.2 } },
      { id: `${layer.id}-circle`, type: "circle", source: "artifact", "source-layer": layer.id, paint: { "circle-color": "#dc2626", "circle-radius": 3 } },
    );
  }
  return { version: 8, sources: { artifact: source }, layers };
}

export function ArtifactPreviewDialog({ artifactID, accessToken, onClose }: { artifactID: string | null; accessToken: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const [mapNode, setMapNode] = useState<HTMLDivElement | null>(null);
  const map = useRef<Map | null>(null);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!artifactID || !accessToken || !mapNode) return;
    let disposed = false;
    setError(false); setReady(false);
    const tileJSONURL = `/api/geodata/v1/artifacts/${artifactID}/tilejson`;
    void (async () => {
      try {
        const response = await fetch(tileJSONURL, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!response.ok) throw new Error("preview unavailable");
        const tileJSON = await response.json() as TileJSON;
        if (disposed) return;
        const instance = new Map({
          container: mapNode,
          style: previewStyle(tileJSONURL, tileJSON),
          bounds: tileJSON.bounds,
          fitBoundsOptions: { padding: 44, maxZoom: Math.min(tileJSON.maxzoom, 14) },
          transformRequest: (url) => url.startsWith("/api/geodata/") ? { url, headers: { Authorization: `Bearer ${accessToken}` } } : { url },
        });
        instance.addControl(new NavigationControl(), "top-right");
        // `load` waits until every source tile has settled. An initial artifact
        // cache download or one unavailable tile can therefore leave the dialog
        // covered by its spinner indefinitely. The style is ready as soon as
        // MapLibre has created the map; tiles continue streaming afterwards.
        instance.once("style.load", () => { if (!disposed) setReady(true); });
        instance.once("error", () => {
          if (!disposed) {
            setReady(false);
            setError(true);
          }
        });
        map.current = instance;
      } catch {
        if (!disposed) setError(true);
      }
    })();
    return () => { disposed = true; map.current?.remove(); map.current = null; };
  }, [artifactID, accessToken, mapNode]);

  return <Dialog open={Boolean(artifactID)} onClose={onClose} maxWidth="xl" fullWidth slotProps={{ paper: { sx: { height: "min(82vh, 760px)" } } }}>
    <DialogTitle sx={{ fontWeight: 750, pr: 7 }}>{t("preview.title")}<IconButton onClick={onClose} sx={{ position: "absolute", right: 12, top: 10 }} aria-label={t("common.close")}><X size={18} /></IconButton></DialogTitle>
    <DialogContent dividers sx={{ p: 0, position: "relative" }}>
      <Box ref={setMapNode} sx={{ position: "absolute", inset: 0 }} />
      {!ready && !error && <Stack sx={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", bgcolor: "background.paper" }} spacing={1}><CircularProgress size={28} /><Typography variant="body2" color="text.secondary">{t("preview.loading")}</Typography></Stack>}
      {error && <Alert severity="error" sx={{ m: 2 }}>{t("preview.failed")}</Alert>}
    </DialogContent>
  </Dialog>;
}
