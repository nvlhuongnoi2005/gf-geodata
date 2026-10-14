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
};

export function ReleasesPage() {
  const { t } = useI18n();
  const [releases] = useState<MapRelease[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [openCreateModal, setOpenCreateModal] = useState(false);
  const [previewRelease, setPreviewRelease] = useState<MapRelease | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formBasemap, setFormBasemap] = useState("");
  const [formVisibility, setFormVisibility] = useState<"public" | "authenticated" | "restricted">(
    "authenticated"
  );
  const [selectedOverlays, setSelectedOverlays] = useState<string[]>([]);

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
    setOpenCreateModal(false);
  };

  const handleTogglePublish = (_id: string) => undefined;
  const handleRollback = (_id: string) => undefined;

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
          <Typography
            variant="h4"
            sx={{ fontSize: { xs: 24, sm: 27 }, fontWeight: 700, letterSpacing: "-0.02em" }}
          >
            {t("nav.releases")}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5, fontSize: "0.9375rem" }}
          >
            Quản lý các bản phát hành bản đồ, tích hợp basemap, overlays và cấp quyền xuất bản
            catalog.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.2}>
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            disabled
          >
            Tạo bản phát hành mới
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
                <TableCell>{t("release.nameSlug")}</TableCell>
                <TableCell>{t("release.basemapOverlays")}</TableCell>
                <TableCell>{t("release.visibility")}</TableCell>
                <TableCell>{t("release.version")}</TableCell>
                <TableCell>{t("release.status")}</TableCell>
                <TableCell align="right">{t("release.actions")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredReleases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} sx={{ textAlign: "center", py: 5 }}>
                  <Typography color="text.secondary">{t("release.empty")}</Typography>
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

      {/* Create Release Modal */}
      <Dialog
        open={openCreateModal}
        onClose={() => setOpenCreateModal(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>{t("release.createTitle")}</DialogTitle>
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
              label={t("release.identifier")}
              fullWidth
              size="small"
              value={formSlug}
              onChange={(e) => setFormSlug(e.target.value)}
              helperText={t("release.identifierHelp")}
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
              <InputLabel>{t("release.basemap")}</InputLabel>
              <Select
                value={formBasemap}
                label="Style Basemap chính"
                onChange={(e) => setFormBasemap(e.target.value)}
              >
                <MenuItem value="" disabled>
                  Chưa có style basemap.
                </MenuItem>
              </Select>
            </FormControl>

            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, display: "block", mb: 0.5 }}>
                Chọn các lớp Overlay bổ trợ:
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Chưa có overlay để lựa chọn.
              </Typography>
            </Box>

            <FormControl fullWidth size="small">
              <InputLabel>{t("release.accessPolicyLabel")}</InputLabel>
              <Select
                value={formVisibility}
                label={t("release.accessPolicyLabel")}
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
                  Giới hạn — Chỉ người dùng hoặc nhóm được cấp quyền mới xem được
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
