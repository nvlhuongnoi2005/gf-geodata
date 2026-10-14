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

const emptyStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#f8fafc" } }],
};

export function StyleStudioPage() {
  const { t } = useI18n();
  const [selectedPreset, setSelectedPreset] = useState("empty");
  const [source, setSource] = useState(() => JSON.stringify(emptyStyle, null, 2));
  const [appliedSource, setAppliedSource] = useState(() =>
    JSON.stringify(emptyStyle, null, 2)
  );
  const [error, setError] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState(0);
  const [currentCenter, setCurrentCenter] = useState<[number, number]>([0, 0]);
  const [layerDrawerOpen, setLayerDrawerOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveVersionTag, setSaveVersionTag] = useState("");
  const [saveComment, setSaveComment] = useState("");
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
        center: [0, 0],
        zoom: 0,
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

  const handleSelectPreset = () => {
    const formatted = JSON.stringify(emptyStyle, null, 2);
    setSelectedPreset("empty");
    setSource(formatted);
    map.current?.setStyle(emptyStyle, { diff: false });
    setAppliedSource(formatted);
    setError(null);
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
          <Typography
            variant="h4"
            sx={{ fontSize: { xs: 24, sm: 27 }, fontWeight: 700, letterSpacing: "-0.02em" }}
          >
            {t("style.title")}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5, fontSize: "0.9375rem" }}
          >
            {t("style.description")}
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
            disabled
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
              <InputLabel>{t("style.presetLabel")}</InputLabel>
              <Select
                value={selectedPreset}
                label={t("style.presetLabel")}
                onChange={handleSelectPreset}
              >
                <MenuItem value="empty">{t("style.emptyPreset")}</MenuItem>
              </Select>
            </FormControl>

            <Button
              size="small"
              variant="outlined"
              startIcon={<Code2 size={15} />}
              onClick={formatJson}
            >
              {t("style.formatJson")}
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
                {t("style.layerList")} ({layerList.length})
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Các lớp hiển thị trong style hiện tại
              </Typography>
            </Box>
            <Button size="small" onClick={() => setLayerDrawerOpen(false)}>
              {t("style.close")}
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
        <DialogTitle sx={{ fontWeight: 800 }}>{t("style.saveTitle")}</DialogTitle>
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
            {t("style.close")}
          </Button>
          <Button variant="contained" startIcon={<Save size={16} />} onClick={handleSaveVersion}>
            Lưu phiên bản này
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
