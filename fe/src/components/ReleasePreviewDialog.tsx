import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { X } from "lucide-react";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

type TileJSON = {
  name: string;
  format: string;
  bounds?: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  vector_layers?: Array<{ id: string }>;
};

export type PreviewRelease = {
  name: string;
  slug: string;
  version: string;
  artifactIds: string[];
  styleVersionId?: string;
};

function styleForRelease(tileJSONs: TileJSON[]): StyleSpecification {
  const sources: StyleSpecification["sources"] = {};
  const layers: StyleSpecification["layers"] = [
    { id: "background", type: "background", paint: { "background-color": "#f8fafc" } },
  ];
  for (const [index, tileJSON] of tileJSONs.entries()) {
    const sourceID = `artifact-${index}`;
    const isVector = tileJSON.format === "pbf" || tileJSON.format === "mvt";
    sources[sourceID] = isVector
      ? { type: "vector", url: (tileJSON as TileJSON & { url: string }).url }
      : { type: "raster", url: (tileJSON as TileJSON & { url: string }).url, tileSize: 256 };
    if (!isVector) {
      layers.push({ id: `${sourceID}-raster`, type: "raster", source: sourceID });
      continue;
    }
    for (const vectorLayer of tileJSON.vector_layers ?? []) {
      layers.push(
        {
          id: `${sourceID}-${vectorLayer.id}-fill`,
          type: "fill",
          source: sourceID,
          "source-layer": vectorLayer.id,
          paint: { "fill-color": "#3b82f6", "fill-opacity": 0.28 },
        },
        {
          id: `${sourceID}-${vectorLayer.id}-line`,
          type: "line",
          source: sourceID,
          "source-layer": vectorLayer.id,
          paint: { "line-color": "#1d4ed8", "line-width": 1.2 },
        },
        {
          id: `${sourceID}-${vectorLayer.id}-circle`,
          type: "circle",
          source: sourceID,
          "source-layer": vectorLayer.id,
          paint: { "circle-color": "#dc2626", "circle-radius": 3 },
        }
      );
    }
  }
  return { version: 8, sources, layers };
}

function previewBounds(tileJSONs: TileJSON[]): [number, number, number, number] {
  const bounds = tileJSONs
    .map((item) => item.bounds)
    .filter(
      (item): item is [number, number, number, number] =>
        Boolean(item) && item!.every(Number.isFinite) && item![0] < item![2] && item![1] < item![3]
    );
  if (!bounds.length) return [-180, -85.051129, 180, 85.051129];
  return [
    Math.min(...bounds.map((item) => item[0])),
    Math.min(...bounds.map((item) => item[1])),
    Math.max(...bounds.map((item) => item[2])),
    Math.max(...bounds.map((item) => item[3])),
  ];
}

export function ReleasePreviewDialog({
  release,
  accessToken,
  onClose,
}: {
  release: PreviewRelease | null;
  accessToken: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { authenticatedFetch } = useAuth();
  const [mapNode, setMapNode] = useState<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [error, setError] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!release || !accessToken || !mapNode) return;
    let disposed = false;
    setError(false);
    setReady(false);
    void (async () => {
      try {
        if (!release.artifactIds.length) throw new Error("release has no artifacts");
        const tileJSONs = await Promise.all(
          release.artifactIds.map(async (artifactID) => {
            const url = `/tiles/v1/releases/${release.slug}/tilejson/${artifactID}`;
            const response = await authenticatedFetch(url);
            if (!response.ok) throw new Error("preview unavailable");
            return { ...((await response.json()) as TileJSON), url };
          })
        );
        let releaseStyle: StyleSpecification | undefined;
        if (release.styleVersionId) {
          const response = await authenticatedFetch(
            `/tiles/v1/releases/${release.slug}/style.json`
          );
          if (!response.ok) throw new Error("release style unavailable");
          releaseStyle = (await response.json()) as StyleSpecification;
        }
        if (disposed) return;
        const { Map, NavigationControl } = await import("maplibre-gl");
        if (disposed) return;
        const instance = new Map({
          container: mapNode,
          style: releaseStyle ?? styleForRelease(tileJSONs),
          bounds: previewBounds(tileJSONs),
          fitBoundsOptions: {
            padding: 44,
            maxZoom: Math.min(...tileJSONs.map((item) => item.maxzoom), 14),
          },
          transformRequest: (url) =>
            url.startsWith("/tiles/")
              ? { url, headers: { Authorization: `Bearer ${accessToken}` } }
              : { url },
        });
        instance.addControl(new NavigationControl(), "top-right");
        instance.once("style.load", () => {
          if (!disposed) setReady(true);
        });
        map.current = instance;
      } catch {
        if (!disposed) setError(true);
      }
    })();
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
  }, [release, accessToken, authenticatedFetch, mapNode]);

  return (
    <Dialog
      open={Boolean(release)}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      slotProps={{ paper: { sx: { height: "min(82vh, 760px)" } } }}
    >
      <DialogTitle sx={{ fontWeight: 750, pr: 7 }}>
        {release ? `${release.name} · v${release.version}` : t("preview.title")}
        <IconButton
          onClick={onClose}
          sx={{ position: "absolute", right: 12, top: 10 }}
          aria-label={t("common.close")}
        >
          <X size={18} />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, position: "relative" }}>
        <Box ref={setMapNode} sx={{ position: "absolute", inset: 0 }} />
        {!ready && !error && (
          <Stack
            sx={{
              position: "absolute",
              inset: 0,
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "background.paper",
            }}
            spacing={1}
          >
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">
              {t("preview.loading")}
            </Typography>
          </Stack>
        )}
        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {t("preview.failed")}
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}
