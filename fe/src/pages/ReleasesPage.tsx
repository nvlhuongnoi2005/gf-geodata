import { useState } from "react";
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
  FormControl,
  FormControlLabel,
  FormGroup,
  Checkbox,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  CheckCircle2,
  Copy,
  Eye,
  Globe,
  Layers,
  Lock,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useI18n } from "../i18n";

export type MapRelease = {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: string;
  previousVersion?: string;
  status: "published" | "draft" | "archived";
  visibility: "public" | "authenticated" | "restricted";
  basemapStyle: string;
  overlays: string[];
  updatedAt: string;
  publishedAt?: string;
  tileJsonUrl: string;
};

const initialReleases: MapRelease[] = [
  {
    id: "REL-01",
    name: "Bản đồ Nền Quốc Gia Chuẩn (Vector)",
    slug: "vietnam-national-vector",
    description:
      "Bản đồ nền vector tổng hợp toàn quốc từ OpenStreetMap kết hợp ranh giới chính thức",
    version: "v2.1",
    previousVersion: "v2.0",
    status: "published",
    visibility: "public",
    basemapStyle: "OSM Vietnam Vector (v2.1)",
    overlays: ["Ranh giới hành chính 3 cấp (v1.4)", "Hệ thống đường bộ cao tốc (v1.0)"],
    updatedAt: "10/10/2026",
    publishedAt: "10/10/2026, 14:30",
    tileJsonUrl: "/api/tiles/vietnam-national-vector/tilejson.json",
  },
  {
    id: "REL-02",
    name: "Ảnh Vệ Tinh Đô Thị Độ Phân Giải Cao",
    slug: "urban-ortho-hanoi-danang",
    description:
      "Bộ ảnh trực giao 0.5m vùng đô thị phục vụ phân tích quy hoạch và giám sát hạ tầng",
    version: "v1.3",
    previousVersion: "v1.2",
    status: "published",
    visibility: "restricted",
    basemapStyle: "Satellite Ortho Imagery (v1.3)",
    overlays: ["Lớp ranh giới thửa đất quy hoạch (v1.1)"],
    updatedAt: "08/10/2026",
    publishedAt: "08/10/2026, 09:15",
    tileJsonUrl: "/api/tiles/urban-ortho/tilejson.json",
  },
  {
    id: "REL-03",
    name: "Bản đồ Địa Hình & Mô Hình Độ Cao Hillshade",
    slug: "terrain-elevation-relief",
    description: "Mô hình số độ cao DEM dạng Hillshade Terrarium kết hợp đường đồng mức",
    version: "v1.0",
    status: "published",
    visibility: "authenticated",
    basemapStyle: "Hillshade Relief Map (v1.0)",
    overlays: ["Đường bình độ 20m (v1.0)"],
    updatedAt: "05/10/2026",
    publishedAt: "05/10/2026, 11:00",
    tileJsonUrl: "/api/tiles/terrain-elevation/tilejson.json",
  },
  {
    id: "REL-04",
    name: "Bản đồ Quy Hoạch Hạ Tầng Viễn Thông 2026",
    slug: "telecom-infrastructure-plan",
    description: "Bản đồ vị trí trạm thu phát sóng và tuyến cáp quang nội bộ bảo mật",
    version: "v1.0-draft",
    status: "draft",
    visibility: "restricted",
    basemapStyle: "Dark Canvas Basemap (v1.0)",
    overlays: ["Vị trí BTS toàn quốc (v0.9)", "Tuyến trục truyền dẫn (v0.9)"],
    updatedAt: "Hôm nay, 08:30",
    tileJsonUrl: "/api/tiles/telecom-draft/tilejson.json",
  },
];

export function ReleasesPage() {
  const { t } = useI18n();
  const [releases, setReleases] = useState<MapRelease[]>(initialReleases);
  const [searchQuery, setSearchQuery] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [openCreateModal, setOpenCreateModal] = useState(false);
  const [previewRelease, setPreviewRelease] = useState<MapRelease | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formBasemap, setFormBasemap] = useState("OSM Vietnam Vector (v2.1)");
  const [formVisibility, setFormVisibility] = useState<"public" | "authenticated" | "restricted">(
    "authenticated"
  );
  const [selectedOverlays, setSelectedOverlays] = useState<string[]>([
    "Ranh giới hành chính 3 cấp (v1.4)",
  ]);

  const handleNameChange = (name: string) => {
    setFormName(name);
    // Auto-generate slug
    const generated = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    setFormSlug(generated);
  };

  const handleCreateRelease = () => {
    if (!formName || !formSlug) return;
    const newRelease: MapRelease = {
      id: `REL-${String(releases.length + 1).padStart(2, "0")}`,
      name: formName,
      slug: formSlug,
      description: formDescription || "Bản phát hành bản đồ mới",
      version: "v1.0",
      status: "published",
      visibility: formVisibility,
      basemapStyle: formBasemap,
      overlays: selectedOverlays,
      updatedAt: "Vừa xong",
      publishedAt: new Date().toLocaleString("vi-VN"),
      tileJsonUrl: `/api/tiles/${formSlug}/tilejson.json`,
    };
    setReleases([newRelease, ...releases]);
    setOpenCreateModal(false);
    setFormName("");
    setFormSlug("");
    setFormDescription("");
  };

  const handleTogglePublish = (id: string) => {
    setReleases((prev) =>
      prev.map((r) => {
        if (r.id === id) {
          const nextStatus = r.status === "published" ? "draft" : "published";
          return {
            ...r,
            status: nextStatus,
            publishedAt:
              nextStatus === "published" ? new Date().toLocaleString("vi-VN") : undefined,
          };
        }
        return r;
      })
    );
  };

  const handleRollback = (id: string) => {
    setReleases((prev) =>
      prev.map((r) => {
        if (r.id === id && r.previousVersion) {
          return {
            ...r,
            version: r.previousVersion,
            updatedAt: "Vừa rollback",
            publishedAt: new Date().toLocaleString("vi-VN"),
          };
        }
        return r;
      })
    );
  };

  const handleCopyUrl = (url: string) => {
    void navigator.clipboard.writeText(window.location.origin + url);
    setCopySuccess(url);
    setTimeout(() => setCopySuccess(null), 2500);
  };

  const filteredReleases = releases.filter((r) => {
    const matchesVis = visibilityFilter === "all" || r.visibility === visibilityFilter;
    const matchesSearch =
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesVis && matchesSearch;
  });

  const publishedCount = releases.filter((r) => r.status === "published").length;
  const publicCount = releases.filter((r) => r.visibility === "public").length;
  const restrictedCount = releases.filter((r) => r.visibility === "restricted").length;
  const draftCount = releases.filter((r) => r.status === "draft").length;

  return (
    <Stack spacing={3}>
      {/* Header */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ justifyContent: "space-between", alignItems: { sm: "flex-end" } }}
      >
        <Box>
          <Typography variant="h4">{t("nav.releases")}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Quản lý các bản phát hành bản đồ (Map Releases), tích hợp basemap, overlays và cấp quyền
            xuất bản vào WebGIS catalog.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.2}>
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            onClick={() => setOpenCreateModal(true)}
          >
            Tạo Release mới
          </Button>
        </Stack>
      </Stack>

      {/* KPI Cards */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 2,
        }}
      >
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                p: 1.1,
                borderRadius: 2,
                bgcolor: "success.light",
                color: "success.main",
                display: "grid",
              }}
            >
              <Send size={20} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Đang Publish (Live)
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                {publishedCount} bản đồ
              </Typography>
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                p: 1.1,
                borderRadius: 2,
                bgcolor: "info.light",
                color: "info.main",
                display: "grid",
              }}
            >
              <Globe size={20} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Công khai (Public)
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                {publicCount}
              </Typography>
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                p: 1.1,
                borderRadius: 2,
                bgcolor: "warning.light",
                color: "warning.main",
                display: "grid",
              }}
            >
              <Lock size={20} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Bảo mật (Restricted ACL)
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                {restrictedCount}
              </Typography>
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                p: 1.1,
                borderRadius: 2,
                bgcolor: "action.hover",
                color: "text.secondary",
                display: "grid",
              }}
            >
              <Layers size={20} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Bản nháp (Draft)
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                {draftCount}
              </Typography>
            </Box>
          </Stack>
        </Paper>
      </Box>

      {/* Filter and Search Bar */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}
        >
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
            {[
              { key: "all", label: "Tất cả (" + releases.length + ")" },
              { key: "public", label: "Public (" + publicCount + ")" },
              { key: "authenticated", label: "Authenticated" },
              { key: "restricted", label: "Restricted (" + restrictedCount + ")" },
            ].map((f) => (
              <Chip
                key={f.key}
                label={f.label}
                clickable
                color={visibilityFilter === f.key ? "primary" : "default"}
                variant={visibilityFilter === f.key ? "filled" : "outlined"}
                onClick={() => setVisibilityFilter(f.key)}
              />
            ))}
          </Stack>

          <TextField
            size="small"
            placeholder="Tìm theo tên bản đồ, slug, mô tả..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={16} />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ width: { xs: "100%", md: 320 } }}
          />
        </Stack>
      </Paper>

      {/* Releases Table */}
      <TableContainer component={Paper} variant="outlined">
        <Table sx={{ minWidth: 800 }}>
          <TableHead>
            <TableRow>
              <TableCell>Tên Map Release & Slug</TableCell>
              <TableCell>Cấu hình Basemap & Overlays</TableCell>
              <TableCell>Phạm vi (Visibility)</TableCell>
              <TableCell>Phiên bản</TableCell>
              <TableCell>Trạng thái</TableCell>
              <TableCell align="right">Hành động</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredReleases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} sx={{ textAlign: "center", py: 5 }}>
                  <Typography color="text.secondary">Không tìm thấy Map Release nào</Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredReleases.map((release) => (
                <TableRow key={release.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {release.name}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ color: "text.secondary", fontFamily: "monospace" }}
                    >
                      slug: {release.slug}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 0.5, maxWidth: 280 }}
                    >
                      {release.description}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }}>
                      Nền: {release.basemapStyle}
                    </Typography>
                    {release.overlays.length > 0 && (
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ mt: 0.5, flexWrap: "wrap", rowGap: 0.5 }}
                      >
                        {release.overlays.map((ov, i) => (
                          <Chip
                            key={i}
                            label={ov}
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: 10 }}
                          />
                        ))}
                      </Stack>
                    )}
                  </TableCell>
                  <TableCell>
                    {release.visibility === "public" && (
                      <Chip
                        icon={<Globe size={13} />}
                        label="Public (Tự do)"
                        size="small"
                        color="success"
                        variant="outlined"
                        sx={{ fontWeight: 700 }}
                      />
                    )}
                    {release.visibility === "authenticated" && (
                      <Chip
                        icon={<Users size={13} />}
                        label="Authenticated"
                        size="small"
                        color="info"
                        variant="outlined"
                        sx={{ fontWeight: 700 }}
                      />
                    )}
                    {release.visibility === "restricted" && (
                      <Chip
                        icon={<Lock size={13} />}
                        label="Restricted (Cấp quyền)"
                        size="small"
                        color="warning"
                        sx={{ fontWeight: 700 }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {release.version}
                    </Typography>
                    {release.previousVersion && (
                      <Typography variant="caption" color="text.secondary">
                        Cũ: {release.previousVersion}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {release.status === "published" ? (
                      <Chip
                        icon={<CheckCircle2 size={13} />}
                        label="Live Published"
                        color="primary"
                        size="small"
                        sx={{ fontWeight: 700 }}
                      />
                    ) : (
                      <Chip label="Bản nháp" size="small" variant="outlined" />
                    )}
                    {release.publishedAt && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mt: 0.4 }}
                      >
                        {release.publishedAt}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.8} sx={{ justifyContent: "flex-end" }}>
                      <Tooltip title="Xem trước bản đồ">
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<Eye size={14} />}
                          onClick={() => setPreviewRelease(release)}
                        >
                          Preview
                        </Button>
                      </Tooltip>
                      <Tooltip title="Sao chép TileJSON URL">
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => handleCopyUrl(release.tileJsonUrl)}
                        >
                          <Copy size={14} />
                        </Button>
                      </Tooltip>
                      {release.previousVersion && (
                        <Tooltip
                          title={`Rollback về version ${release.previousVersion} mà không cần convert lại`}
                        >
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            startIcon={<RotateCcw size={14} />}
                            onClick={() => handleRollback(release.id)}
                          >
                            Rollback
                          </Button>
                        </Tooltip>
                      )}
                      <Button
                        size="small"
                        variant={release.status === "published" ? "outlined" : "contained"}
                        color={release.status === "published" ? "inherit" : "primary"}
                        onClick={() => handleTogglePublish(release.id)}
                      >
                        {release.status === "published" ? "Unpublish" : "Publish"}
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Copy notification */}
      {copySuccess && (
        <Alert severity="success" sx={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999 }}>
          Đã sao chép TileJSON URL vào bộ nhớ tạm!
        </Alert>
      )}

      {/* Create Release Modal */}
      <Dialog
        open={openCreateModal}
        onClose={() => setOpenCreateModal(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Tạo Map Release mới</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Alert severity="info" sx={{ fontSize: 13 }}>
              Một Map Release kết hợp 1 Basemap style và các lớp Overlays để tạo thành bản đồ hoàn
              chỉnh xuất bản vào WebGIS catalog.
            </Alert>

            <TextField
              label="Tên Map Release"
              fullWidth
              size="small"
              value={formName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Ví dụ: Bản đồ Giao thông & Quy hoạch 2026"
            />

            <TextField
              label="Slug nhận diện (URL)"
              fullWidth
              size="small"
              value={formSlug}
              onChange={(e) => setFormSlug(e.target.value)}
              helperText={`Endpoint: /api/tiles/${formSlug || "{slug}"}/tilejson.json`}
            />

            <TextField
              label="Mô tả bản đồ"
              multiline
              rows={2}
              fullWidth
              size="small"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
            />

            <FormControl fullWidth size="small">
              <InputLabel>Style Basemap chính</InputLabel>
              <Select
                value={formBasemap}
                label="Style Basemap chính"
                onChange={(e) => setFormBasemap(e.target.value)}
              >
                <MenuItem value="OSM Vietnam Vector (v2.1)">
                  OSM Vietnam Vector (v2.1) — MapLibre Vector
                </MenuItem>
                <MenuItem value="Satellite Ortho Imagery (v1.3)">
                  Satellite Ortho Imagery (v1.3) — Ảnh vệ tinh GeoTIFF
                </MenuItem>
                <MenuItem value="Dark Canvas Basemap (v1.0)">
                  Dark Canvas Basemap (v1.0) — Nền tối chuyên dụng
                </MenuItem>
                <MenuItem value="Hillshade Relief Map (v1.0)">
                  Hillshade Relief Map (v1.0) — Địa hình nổi 3D
                </MenuItem>
              </Select>
            </FormControl>

            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, display: "block", mb: 0.5 }}>
                Chọn các lớp Overlay bổ trợ:
              </Typography>
              <FormGroup>
                {[
                  "Ranh giới hành chính 3 cấp (v1.4)",
                  "Hệ thống đường bộ cao tốc (v1.0)",
                  "Lớp ranh giới thửa đất quy hoạch (v1.1)",
                  "Vị trí BTS viễn thông (v0.9)",
                ].map((overlay) => (
                  <FormControlLabel
                    key={overlay}
                    control={
                      <Checkbox
                        size="small"
                        checked={selectedOverlays.includes(overlay)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedOverlays([...selectedOverlays, overlay]);
                          } else {
                            setSelectedOverlays(selectedOverlays.filter((o) => o !== overlay));
                          }
                        }}
                      />
                    }
                    label={<Typography variant="body2">{overlay}</Typography>}
                  />
                ))}
              </FormGroup>
            </Box>

            <FormControl fullWidth size="small">
              <InputLabel>Chính sách truy cập (Visibility)</InputLabel>
              <Select
                value={formVisibility}
                label="Chính sách truy cập (Visibility)"
                onChange={(e) =>
                  setFormVisibility(e.target.value as "public" | "authenticated" | "restricted")
                }
              >
                <MenuItem value="public">
                  Public — Bất kỳ ai cũng xem được, không cần đăng nhập (FR-40)
                </MenuItem>
                <MenuItem value="authenticated">
                  Authenticated — Tất cả user đăng nhập vào WebGIS đều xem được
                </MenuItem>
                <MenuItem value="restricted">
                  Restricted — Chỉ user hoặc nhóm được cấp quyền cụ thể qua UUID (FR-31, FR-32)
                </MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="outlined" onClick={() => setOpenCreateModal(false)}>
            Hủy
          </Button>
          <Button
            variant="contained"
            disabled={!formName || !formSlug}
            onClick={handleCreateRelease}
          >
            Tạo và Xuất bản Release
          </Button>
        </DialogActions>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog
        open={Boolean(previewRelease)}
        onClose={() => setPreviewRelease(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>
          Preview: {previewRelease?.name} ({previewRelease?.version})
        </DialogTitle>
        <DialogContent dividers>
          {previewRelease && (
            <Stack spacing={2}>
              <Paper
                variant="outlined"
                sx={{
                  height: 340,
                  borderRadius: 2,
                  bgcolor: "#0f172a",
                  position: "relative",
                  display: "grid",
                  placeItems: "center",
                  overflow: "hidden",
                  backgroundImage:
                    "radial-gradient(circle at 50% 50%, rgba(20, 184, 166, 0.25) 0%, transparent 60%)",
                }}
              >
                <Stack
                  spacing={1}
                  sx={{ alignItems: "center", color: "#f8fafc", zIndex: 1, textAlign: "center" }}
                >
                  <Layers size={36} color="#14b8a6" />
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>
                    {previewRelease.basemapStyle}
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.8 }}>
                    {previewRelease.overlays.length} Lớp Overlay:{" "}
                    {previewRelease.overlays.join(", ")}
                  </Typography>
                  <Chip
                    label={`Phạm vi: ${previewRelease.visibility.toUpperCase()}`}
                    size="small"
                    color={previewRelease.visibility === "public" ? "success" : "warning"}
                    sx={{ mt: 1 }}
                  />
                </Stack>
              </Paper>

              <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 2 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }}>
                  TileJSON Endpoint:
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ fontFamily: "monospace", color: "primary.main" }}
                >
                  {window.location.origin}
                  {previewRelease.tileJsonUrl}
                </Typography>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="outlined" onClick={() => setPreviewRelease(null)}>
            Đóng Preview
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
