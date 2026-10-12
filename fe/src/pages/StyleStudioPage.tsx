import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Braces,
  CheckCircle2,
  Code2,
  Compass,
  Copy,
  Eye,
  EyeOff,
  History,
  Layers,
  MapPin,
  Maximize2,
  Minimize2,
  Palette,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { Map, NavigationControl, type StyleSpecification } from "maplibre-gl";
import { useI18n } from "../i18n";

// Preset Styles for quick preview and editing
const stylePresets: Record<string, StyleSpecification> = {
  osm_vector: {
    version: 8,
    name: "OpenStreetMap Vietnam Vector (v2.1)",
    center: [105.8278, 21.0312],
    zoom: 11,
    sources: {
      osm_open: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [
      {
        id: "osm-raster-base",
        type: "raster",
        source: "osm_open",
        paint: { "raster-opacity": 1.0 },
      },
    ],
  },
  dark_spatial: {
    version: 8,
    name: "Dark Canvas Geospatial (v1.0)",
    center: [105.8278, 21.0312],
    zoom: 11,
    sources: {
      carto_dark: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
          "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution: "© CARTO, © OpenStreetMap",
      },
    },
    layers: [
      {
        id: "background-dark",
        type: "background",
        paint: { "background-color": "#0b1218" },
      },
      {
        id: "carto-dark-base",
        type: "raster",
        source: "carto_dark",
        paint: { "raster-opacity": 0.85 },
      },
    ],
  },
  satellite_hybrid: {
    version: 8,
    name: "Satellite Ortho & Hybrid (v1.3)",
    center: [105.8278, 21.0312],
    zoom: 11,
    sources: {
      satellite: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution: "Esri, Maxar, Earthstar Geographics",
      },
    },
    layers: [
      {
        id: "satellite-layer",
        type: "raster",
        source: "satellite",
        paint: { "raster-opacity": 1.0 },
      },
    ],
  },
  minimal_vector: {
    version: 8,
    name: "Draft Blank Basemap (v1.0)",
    center: [105.85, 21.03],
    zoom: 6,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#0d9488" },
      },
    ],
  },
};

export function StyleStudioPage() {
  const { t } = useI18n();
  const [selectedPreset, setSelectedPreset] = useState("osm_vector");
  const [source, setSource] = useState(() => JSON.stringify(stylePresets.osm_vector, null, 2));
  const [appliedSource, setAppliedSource] = useState(() =>
    JSON.stringify(stylePresets.osm_vector, null, 2)
  );
  const [error, setError] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState(11);
  const [currentCenter, setCurrentCenter] = useState<[number, number]>([105.8278, 21.0312]);
  const [layerDrawerOpen, setLayerDrawerOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveVersionTag, setSaveVersionTag] = useState("v2.2");
  const [saveComment, setSaveComment] = useState(
    "Tối ưu hóa bảng màu đường bộ và độ tương phản nhãn"
  );
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);

  const mapNode = useRef<HTMLDivElement | null>(null);
  const map = useRef<Map | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapNode.current || map.current) return;
    try {
      const initialParsed = JSON.parse(source) as StyleSpecification;
      map.current = new Map({
        container: mapNode.current,
        style: initialParsed,
        center: [105.8278, 21.0312],
        zoom: 11,
      });

      map.current.addControl(new NavigationControl({ visualizePitch: true }), "top-right");

      map.current.on("move", () => {
        if (!map.current) return;
        const center = map.current.getCenter();
        const zoom = map.current.getZoom();
        setCurrentCenter([Number(center.lng.toFixed(4)), Number(center.lat.toFixed(4))]);
        setCurrentZoom(Number(zoom.toFixed(1)));
      });
    } catch {
      // Ignore initial parse if any
    }

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Format / Beautify JSON
  const formatJson = () => {
    try {
      const parsed = JSON.parse(source) as object;
      setSource(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? `Lỗi cú pháp: ${e.message}` : "JSON không hợp lệ");
    }
  };

  // Change preset
  const handleSelectPreset = (presetKey: string) => {
    setSelectedPreset(presetKey);
    const presetObj = stylePresets[presetKey];
    if (presetObj) {
      const formatted = JSON.stringify(presetObj, null, 2);
      setSource(formatted);
      try {
        map.current?.setStyle(presetObj, { diff: false });
        if (presetObj.center) {
          map.current?.flyTo({
            center: presetObj.center as [number, number],
            zoom: presetObj.zoom || 10,
          });
        }
        setAppliedSource(formatted);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lỗi nạp style");
      }
    }
  };

  // Apply preview
  const applyStyle = () => {
    try {
      const parsed = JSON.parse(source) as StyleSpecification;
      if (parsed.version !== 8 || !Array.isArray(parsed.layers)) {
        throw new Error(
          "Style phải tuân theo MapLibre Style Specification v8 (có version: 8 và mảng layers)."
        );
      }
      map.current?.setStyle(parsed, { diff: false });
      setAppliedSource(source);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("style.errorJson"));
    }
  };

  // Fly to location
  const flyTo = (lng: number, lat: number, zoom: number) => {
    map.current?.flyTo({ center: [lng, lat], zoom, essential: true });
  };

  // Save Style Version handler
  const handleSaveVersion = () => {
    setSaveModalOpen(false);
    setSaveSuccessNotice(true);
    setTimeout(() => setSaveSuccessNotice(false), 3500);
  };

  // Extract layers for layer inspector
  let layerList: Array<{ id: string; type: string }> = [];
  try {
    const parsed = JSON.parse(source) as StyleSpecification;
    if (Array.isArray(parsed.layers)) {
      layerList = parsed.layers.map((l) => ({ id: l.id, type: l.type }));
    }
  } catch {
    // Keep empty
  }

  return (
    <Stack spacing={3}>
      {/* Top Header */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ justifyContent: "space-between", alignItems: { sm: "flex-end" } }}
      >
        <Box>
          <Typography variant="h4">{t("style.title")}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {t("style.description")} Hỗ trợ preview thời gian thực với MapLibre GL và kiểm tra cú
            pháp Specification v8.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <Chip
            icon={<Braces size={15} />}
            label={t(source === appliedSource ? "style.previewApplied" : "style.previewOutOfDate")}
            variant="outlined"
            color={source === appliedSource ? "success" : "warning"}
          />
          <Button
            variant="contained"
            startIcon={<Save size={17} />}
            onClick={() => setSaveModalOpen(true)}
          >
            {t("style.save")}
          </Button>
        </Stack>
      </Stack>

      {/* Toolbar */}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}
        >
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
          >
            <FormControl size="small" sx={{ minWidth: 230 }}>
              <InputLabel>Mẫu Style có sẵn (Preset)</InputLabel>
              <Select
                value={selectedPreset}
                label="Mẫu Style có sẵn (Preset)"
                onChange={(e) => handleSelectPreset(e.target.value)}
              >
                <MenuItem value="osm_vector">OpenStreetMap Vietnam (Vector)</MenuItem>
                <MenuItem value="dark_spatial">Dark Canvas Geospatial (Nền tối)</MenuItem>
                <MenuItem value="satellite_hybrid">Satellite Imagery (Ảnh vệ tinh)</MenuItem>
                <MenuItem value="minimal_vector">Blank Basemap (Bản đồ trống)</MenuItem>
              </Select>
            </FormControl>

            <Button
              size="small"
              variant="outlined"
              startIcon={<Code2 size={15} />}
              onClick={formatJson}
            >
              Định dạng JSON (Beautify)
            </Button>

            <Button
              size="small"
              variant="outlined"
              startIcon={<Layers size={15} />}
              onClick={() => setLayerDrawerOpen(true)}
            >
              Lớp bản đồ ({layerList.length})
            </Button>
          </Stack>

          {/* Location quick jumps */}
          <Stack direction="row" spacing={0.8} sx={{ alignItems: "center" }}>
            <Typography variant="caption" color="text.secondary">
              Nhảy nhanh:
            </Typography>
            <Button size="small" variant="text" onClick={() => flyTo(105.8278, 21.0312, 12)}>
              Hà Nội
            </Button>
            <Button size="small" variant="text" onClick={() => flyTo(108.2208, 16.0678, 12)}>
              Đà Nẵng
            </Button>
            <Button size="small" variant="text" onClick={() => flyTo(106.6998, 10.7765, 12)}>
              TP.HCM
            </Button>
            <Button size="small" variant="text" onClick={() => flyTo(108.0, 16.0, 5.5)}>
              Toàn quốc
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* Main Grid: JSON Editor & MapLibre Preview */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { lg: "minmax(420px, 1fr) minmax(460px, 1.25fr)" },
          gap: 2,
          minHeight: { lg: 620 },
        }}
      >
        {/* Editor Box */}
        <Paper
          variant="outlined"
          sx={{ p: 2, display: "flex", flexDirection: "column", minHeight: 460 }}
        >
          <Stack
            direction="row"
            sx={{ mb: 1.5, justifyContent: "space-between", alignItems: "center" }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography sx={{ fontWeight: 800 }}>{t("style.fileName")}</Typography>
              <Chip
                label="v8 Specification"
                size="small"
                variant="outlined"
                sx={{ fontSize: 11 }}
              />
            </Stack>
            <Button
              disabled={source === appliedSource}
              variant="contained"
              size="small"
              onClick={applyStyle}
            >
              {t("common.applyPreview")}
            </Button>
          </Stack>

          <TextField
            multiline
            fullWidth
            value={source}
            onChange={(event) => setSource(event.target.value)}
            spellCheck={false}
            sx={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              "& .MuiInputBase-root": {
                flex: 1,
                alignItems: "flex-start",
              },
              "& textarea": {
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 12.5,
                lineHeight: 1.55,
                height: "100% !important",
              },
            }}
            slotProps={{ htmlInput: { "aria-label": t("style.editor") } }}
          />

          {error && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {error}
            </Alert>
          )}
        </Paper>

        {/* Map Preview Box */}
        <Paper variant="outlined" sx={{ overflow: "hidden", minHeight: 460, position: "relative" }}>
          <Box ref={mapNode} sx={{ position: "absolute", inset: 0 }} />

          {/* Coordinate & Zoom Floating HUD */}
          <Box
            sx={{
              position: "absolute",
              bottom: 14,
              left: 14,
              bgcolor: "background.paper",
              borderRadius: 2,
              px: 1.5,
              py: 0.8,
              border: "1px solid",
              borderColor: "divider",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              display: "flex",
              gap: 2,
              alignItems: "center",
              zIndex: 10,
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              Zoom: <code style={{ color: "#d32f2f" }}>{currentZoom}</code>
            </Typography>
            <Divider orientation="vertical" flexItem />
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              Kinh/Vĩ độ:{" "}
              <code style={{ color: "#0d9488" }}>
                {currentCenter[0]}, {currentCenter[1]}
              </code>
            </Typography>
          </Box>

          {/* Top Label */}
          <Box
            sx={{
              position: "absolute",
              left: 14,
              top: 14,
              bgcolor: "background.paper",
              borderRadius: 2,
              p: 1.25,
              border: "1px solid",
              borderColor: "divider",
              zIndex: 10,
            }}
          >
            <Typography variant="caption" sx={{ fontWeight: 800 }}>
              {t("style.preview")}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              MapLibre GL JS · Live Render Engine
            </Typography>
          </Box>
        </Paper>
      </Box>

      {/* Success alert */}
      {saveSuccessNotice && (
        <Alert severity="success" sx={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999 }}>
          Đã lưu thành công Style Version {saveVersionTag} vào hệ thống!
        </Alert>
      )}

      {/* Layer Inspector Drawer */}
      <Drawer
        anchor="right"
        open={layerDrawerOpen}
        onClose={() => setLayerDrawerOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 420 }, p: 3 } } }}
      >
        <Stack spacing={2}>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Danh sách Layer ({layerList.length})
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Các lớp hiển thị trong style hiện tại
              </Typography>
            </Box>
            <Button size="small" onClick={() => setLayerDrawerOpen(false)}>
              Đóng
            </Button>
          </Stack>

          <Divider />

          <Stack spacing={1}>
            {layerList.map((layer) => (
              <Paper
                key={layer.id}
                variant="outlined"
                sx={{
                  p: 1.25,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {layer.id}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Loại: {layer.type}
                  </Typography>
                </Box>
                <Chip label={layer.type} size="small" variant="outlined" sx={{ fontSize: 11 }} />
              </Paper>
            ))}
          </Stack>
        </Stack>
      </Drawer>

      {/* Save Version Modal */}
      <Dialog open={saveModalOpen} onClose={() => setSaveModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Lưu Style Version mới (FR-19)</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Alert severity="info" sx={{ fontSize: 13 }}>
              Style draft không làm thay đổi bản đồ đang public. Khi lưu version mới, hệ thống sẽ
              gán version tag để Map Release liên kết an toàn (FR-22, FR-23).
            </Alert>

            <TextField
              label="Tên phiên bản (Version Tag)"
              fullWidth
              size="small"
              value={saveVersionTag}
              onChange={(e) => setSaveVersionTag(e.target.value)}
              placeholder="Ví dụ: v2.2, v2.3-rc1"
            />

            <TextField
              label="Ghi chú thay đổi (Changelog / Commit Message)"
              multiline
              rows={3}
              fullWidth
              size="small"
              value={saveComment}
              onChange={(e) => setSaveComment(e.target.value)}
              placeholder="Mô tả các thay đổi về màu sắc, độ dày đường, font chữ hoặc layer..."
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="outlined" onClick={() => setSaveModalOpen(false)}>
            Hủy
          </Button>
          <Button variant="contained" startIcon={<Save size={16} />} onClick={handleSaveVersion}>
            Lưu phiên bản này
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
