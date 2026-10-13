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
  Drawer,
  FormControl,
  InputAdornment,
  InputLabel,
  LinearProgress,
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
  Archive,
  CheckCircle2,
  Database,
  FileUp,
  FolderUp,
  Info,
  Plus,
  Search,
  ShieldCheck,
  UploadCloud,
  Workflow,
} from "lucide-react";
import { useI18n } from "../i18n";

export type DatasetItem = {
  id: string;
  name: string;
  description: string;
  format: "GeoTIFF" | "GeoPackage" | "OSM PBF" | "MBTiles" | "Shapefile";
  size: string;
  crs: string;
  bounds: string;
  layersOrBands: string;
  source: string;
  license: string;
  versionsCount: number;
  latestVersion: string;
  checksum: string;
  tags: string[];
  status: "ready" | "uploading" | "needs_check" | "archived";
  updatedAt: string;
};

const initialDatasets: DatasetItem[] = [
  {
    id: "DS-001",
    name: "Ảnh vệ tinh Hà Nội 2026 (0.5m)",
    description: "Bộ ảnh trực giao toàn bộ khu vực trung tâm và mở rộng Hà Nội độ phân giải 50cm",
    format: "GeoTIFF",
    size: "1.42 GB",
    crs: "EPSG:32648 (WGS 84 / UTM zone 48N)",
    bounds: "[105.71, 20.91, 105.93, 21.15]",
    layersOrBands: "4 bands (RGB + NIR)",
    source: "Trung tâm Dữ liệu Không gian",
    license: "Nội bộ / Sử dụng nghiệp vụ",
    versionsCount: 2,
    latestVersion: "v2.1",
    checksum: "d41d8cd98f00b204e9800998ecf8427e",
    tags: ["Vệ tinh", "Hà Nội", "Ảnh trực giao"],
    status: "ready",
    updatedAt: "Hôm nay, 10:24",
  },
  {
    id: "DS-002",
    name: "Ranh giới hành chính Việt Nam (Bộ TN&MT)",
    description:
      "Dữ liệu phân định ranh giới 3 cấp: Tỉnh/Thành phố, Quận/Huyện, Xã/Phường chuẩn quốc gia",
    format: "GeoPackage",
    size: "480 MB",
    crs: "EPSG:3405 (VN-2000 / UTM zone 48N)",
    bounds: "[102.14, 8.18, 109.46, 23.39]",
    layersOrBands: "3 layers (adm1, adm2, adm3)",
    source: "Bộ Tài nguyên & Môi trường",
    license: "Chính thức / Lưu hành nội bộ",
    versionsCount: 4,
    latestVersion: "v1.4",
    checksum: "7c222fb2927d828af22f592134e89324",
    tags: ["Ranh giới", "Toàn quốc", "Chính thức"],
    status: "ready",
    updatedAt: "08/10/2026",
  },
  {
    id: "DS-003",
    name: "Dữ liệu giao thông OpenStreetMap Vietnam PBF",
    description: "Dữ liệu vector giao thông đường bộ, thủy văn, địa danh chiết xuất từ OSM",
    format: "OSM PBF",
    size: "3.1 GB",
    crs: "EPSG:4326 (WGS 84 Geographic)",
    bounds: "[102.0, 8.0, 110.0, 24.0]",
    layersOrBands: "Toàn bộ lớp dữ liệu giao thông",
    source: "OpenStreetMap Contributors",
    license: "ODbL 1.0",
    versionsCount: 1,
    latestVersion: "v1.0",
    checksum: "9e107d9d372bb6826bd81d3542a419d6",
    tags: ["Giao thông", "Việt Nam", "Vector"],
    status: "ready",
    updatedAt: "05/10/2026",
  },
  {
    id: "DS-004",
    name: "Mô hình số độ cao DEM Tây Nguyên 30m",
    description:
      "Dữ liệu độ cao địa hình khu vực Tây Nguyên phục vụ phân tích độ dốc và tạo hillshade",
    format: "GeoTIFF",
    size: "2.8 GB",
    crs: "EPSG:4326 (WGS 84 Geographic)",
    bounds: "[107.2, 11.5, 108.9, 14.8]",
    layersOrBands: "1 band (Float32 Elevation)",
    source: "Khảo sát Địa hình Quốc gia",
    license: "Nội bộ",
    versionsCount: 1,
    latestVersion: "v1.0",
    checksum: "c33367701511b4f6020ec61ded352059",
    tags: ["Độ cao", "Địa hình", "Tây Nguyên"],
    status: "ready",
    updatedAt: "01/10/2026",
  },
];

export function DatasetsPage({ onNavigateConvert }: { onNavigateConvert?: () => void }) {
  const { t } = useI18n();
  const [datasets, setDatasets] = useState<DatasetItem[]>(initialDatasets);
  const [searchQuery, setSearchQuery] = useState("");
  const [formatFilter, setFormatFilter] = useState("all");
  const [selectedDataset, setSelectedDataset] = useState<DatasetItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Upload modal states
  const [openUploadModal, setOpenUploadModal] = useState(false);
  const [openImportModal, setOpenImportModal] = useState(false);
  const [uploadStep, setUploadStep] = useState(1);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  // Form states
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formFormat, setFormFormat] = useState<
    "GeoTIFF" | "GeoPackage" | "OSM PBF" | "MBTiles" | "Shapefile"
  >("GeoTIFF");
  const [formCrs, setFormCrs] = useState("EPSG:3857");
  const [formTags, setFormTags] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [internalPath, setInternalPath] = useState("danang_ortho_2026.tif");

  const filteredDatasets = datasets.filter((ds) => {
    const matchesFormat = formatFilter === "all" || ds.format === formatFilter;
    const matchesSearch =
      ds.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ds.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ds.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesFormat && matchesSearch;
  });

  const handleStartUpload = () => {
    setUploading(true);
    setUploadProgress(15);
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setUploading(false);
          const newDs: DatasetItem = {
            id: `DS-${String(datasets.length + 1).padStart(3, "0")}`,
            name: formName || "Dữ liệu nguồn mới",
            description: formDescription || "Dữ liệu tiếp nhận thông qua cơ chế tải lên phân đoạn",
            format: formFormat,
            size: "620 MB",
            crs: formCrs,
            bounds: "[105.80, 21.00, 105.85, 21.05]",
            layersOrBands: formFormat === "GeoTIFF" ? "3 bands (RGB)" : "1 layer",
            source: "Quản trị viên tải lên",
            license: "Nội bộ",
            versionsCount: 1,
            latestVersion: "v1.0",
            checksum: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
            tags: formTags ? formTags.split(",").map((s) => s.trim()) : ["Mới", formFormat],
            status: "ready",
            updatedAt: "Vừa xong",
          };
          setDatasets([newDs, ...datasets]);
          setTimeout(() => {
            setOpenUploadModal(false);
            setUploadStep(1);
            setUploadProgress(0);
            setSelectedFile(null);
            setFormName("");
          }, 600);
          return 100;
        }
        return prev + 25;
      });
    }, 350);
  };

  const handleInternalImport = () => {
    if (!internalPath) return;
    const imported: DatasetItem = {
      id: `DS-${String(datasets.length + 1).padStart(3, "0")}`,
      name: "Ảnh vệ tinh Đà Nẵng 2026 (Import nội bộ)",
      description: "Tiếp nhận từ hạ tầng mạng nội bộ",
      format: "GeoTIFF",
      size: "850 MB",
      crs: "EPSG:32648 (WGS 84 / UTM zone 48N)",
      bounds: "[108.15, 15.95, 108.35, 16.15]",
      layersOrBands: "4 bands (RGB + NIR)",
      source: "Hệ thống nội bộ",
      license: "Nội bộ",
      versionsCount: 1,
      latestVersion: "v1.0",
      checksum: "ff88112233445566778899aabbccddeeff",
      tags: ["Đà Nẵng", "Import nội bộ"],
      status: "ready",
      updatedAt: "Vừa xong",
    };
    setDatasets([imported, ...datasets]);
    setOpenImportModal(false);
  };

  const handleArchive = (id: string) => {
    setDatasets((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: "archived" as const } : d))
    );
  };

  const handleOpenDetail = (ds: DatasetItem) => {
    setSelectedDataset(ds);
    setDrawerOpen(true);
  };

  return (
    <Stack spacing={3}>
      {/* Header section (Section 4.1 & Section 6 Typography) */}
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
            {t("datasets.title")}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5, fontSize: "0.9375rem" }}
          >
            {t("datasets.description")}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1.2}>
          <Button
            variant="outlined"
            startIcon={<FolderUp size={16} />}
            onClick={() => setOpenImportModal(true)}
          >
            {t("datasets.import")}
          </Button>
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            onClick={() => {
              setUploadStep(1);
              setOpenUploadModal(true);
            }}
          >
            {t("datasets.new")}
          </Button>
        </Stack>
      </Stack>

      {/* Two Security / Business Badges (Section 4.3 in UI.md) */}
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      >
        <Chip
          icon={<ShieldCheck size={14} color="#0d9488" />}
          label={t("datasets.immutable")}
          size="small"
          variant="outlined"
          sx={{ fontWeight: 650, borderColor: "divider" }}
        />
        <Chip
          icon={<FileUp size={14} color="#0d9488" />}
          label={t("datasets.audited")}
          size="small"
          variant="outlined"
          sx={{ fontWeight: 650, borderColor: "divider" }}
        />
      </Stack>

      {/* Filter and Search Bar */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}
        >
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
            {[
              { key: "all", label: "Tất cả (" + datasets.length + ")" },
              { key: "GeoTIFF", label: "GeoTIFF" },
              { key: "GeoPackage", label: "GeoPackage" },
              { key: "OSM PBF", label: "OSM PBF" },
              { key: "MBTiles", label: "MBTiles" },
            ].map((f) => (
              <Chip
                key={f.key}
                label={f.label}
                clickable
                color={formatFilter === f.key ? "primary" : "default"}
                variant={formatFilter === f.key ? "filled" : "outlined"}
                onClick={() => setFormatFilter(f.key)}
              />
            ))}
          </Stack>

          <TextField
            size="small"
            placeholder="Tìm theo tên dataset, định dạng, tag..."
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

      {/* Empty State (Section 4.4 in UI.md) or Datasets Table */}
      {filteredDatasets.length === 0 ? (
        <Paper
          variant="outlined"
          sx={{
            py: 7,
            px: 3,
            textAlign: "center",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Box sx={{ maxWidth: 460 }}>
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: 3,
                bgcolor: "action.hover",
                color: "text.secondary",
                display: "grid",
                placeItems: "center",
                mx: "auto",
                mb: 2,
              }}
            >
              <Database size={28} />
            </Box>
            <Typography variant="h6" sx={{ fontSize: "1.15rem", fontWeight: 700 }}>
              {t("datasets.empty")}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.75, mb: 2.5, lineHeight: 1.6 }}
            >
              {t("datasets.emptyDescription")}
            </Typography>
            <Button
              variant="contained"
              startIcon={<Plus size={16} />}
              onClick={() => {
                setUploadStep(1);
                setOpenUploadModal(true);
              }}
            >
              {t("datasets.new")}
            </Button>
          </Box>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table sx={{ minWidth: 800 }}>
            <TableHead>
              <TableRow>
                <TableCell>Dataset</TableCell>
                <TableCell>Định dạng</TableCell>
                <TableCell>Phiên bản mới nhất</TableCell>
                <TableCell>Dung lượng</TableCell>
                <TableCell>Trạng thái</TableCell>
                <TableCell align="right">Hành động</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredDatasets.map((ds) => (
                <TableRow key={ds.id} hover>
                  {/* Dataset Name, description, tags */}
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 650, fontSize: "0.9375rem" }}>
                      {ds.name}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", fontSize: "0.8125rem", mt: 0.25 }}
                    >
                      {ds.description}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={0.6}
                      sx={{ mt: 0.75, flexWrap: "wrap", rowGap: 0.5 }}
                    >
                      {ds.tags.map((tag, i) => (
                        <Chip
                          key={i}
                          label={tag}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: "0.75rem", height: 22 }}
                        />
                      ))}
                    </Stack>
                  </TableCell>

                  {/* Format */}
                  <TableCell>
                    <Chip
                      label={ds.format}
                      size="small"
                      color="default"
                      variant="outlined"
                      sx={{ fontWeight: 650, fontSize: "0.8125rem" }}
                    />
                  </TableCell>

                  {/* Latest Version & Updated Time */}
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700, fontSize: "0.875rem" }}>
                      {ds.latestVersion}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontSize: "0.78125rem", display: "block" }}
                    >
                      {ds.updatedAt}
                    </Typography>
                  </TableCell>

                  {/* Size */}
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.875rem" }}>
                      {ds.size}
                    </Typography>
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    {ds.status === "ready" && (
                      <Chip
                        icon={<CheckCircle2 size={13} />}
                        label="Sẵn sàng"
                        size="small"
                        color="success"
                        sx={{ fontWeight: 650, fontSize: "0.75rem" }}
                      />
                    )}
                    {ds.status === "uploading" && (
                      <Chip
                        label="Đang tải lên"
                        size="small"
                        color="primary"
                        sx={{ fontWeight: 650, fontSize: "0.75rem" }}
                      />
                    )}
                    {ds.status === "archived" && (
                      <Chip
                        label="Đã lưu trữ"
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: "0.75rem" }}
                      />
                    )}
                  </TableCell>

                  {/* Actions (Section 4.3 in UI.md) */}
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.8} sx={{ justifyContent: "flex-end" }}>
                      <Tooltip title="Xem chi tiết metadata và phiên bản">
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<Info size={14} />}
                          onClick={() => handleOpenDetail(ds)}
                        >
                          Chi tiết
                        </Button>
                      </Tooltip>

                      <Tooltip title="Tạo tác vụ chuyển đổi dữ liệu">
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<Workflow size={14} />}
                          onClick={() => {
                            if (onNavigateConvert) onNavigateConvert();
                          }}
                        >
                          Chuyển đổi
                        </Button>
                      </Tooltip>

                      {ds.status !== "archived" && (
                        <Tooltip title="Lưu trữ phiên bản">
                          <Button
                            size="small"
                            variant="outlined"
                            color="inherit"
                            onClick={() => handleArchive(ds.id)}
                          >
                            <Archive size={14} />
                          </Button>
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Dataset Detail Drawer (Section 4.3 in UI.md - Business Metadata only) */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 520 }, p: 3 } } }}
      >
        {selectedDataset && (
          <Stack spacing={2.5}>
            <Stack
              direction="row"
              sx={{ justifyContent: "space-between", alignItems: "flex-start" }}
            >
              <Box>
                <Typography variant="h6" sx={{ fontSize: "1.2rem", fontWeight: 700 }}>
                  {selectedDataset.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.8125rem" }}>
                  Mã: {selectedDataset.id} · Cập nhật: {selectedDataset.updatedAt}
                </Typography>
              </Box>
              <Chip label={selectedDataset.latestVersion} color="primary" size="small" />
            </Stack>

            <Divider />

            <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
              {selectedDataset.description}
            </Typography>

            {/* Business Metadata Grid */}
            <Paper variant="outlined" sx={{ p: 2, bgcolor: "action.hover" }}>
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, fontSize: "0.8125rem", display: "block", mb: 1.5 }}
              >
                THÔNG TIN DỮ LIỆU NGUỒN
              </Typography>
              <Stack spacing={1}>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="caption" color="text.secondary">
                    Định dạng:
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {selectedDataset.format}
                  </Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="caption" color="text.secondary">
                    Dung lượng:
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {selectedDataset.size}
                  </Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="caption" color="text.secondary">
                    Hệ tọa độ (CRS):
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {selectedDataset.crs}
                  </Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="caption" color="text.secondary">
                    Phạm vi không gian (Bounds):
                  </Typography>
                  <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                    {selectedDataset.bounds}
                  </Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="caption" color="text.secondary">
                    Số Layer / Bands:
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {selectedDataset.layersOrBands}
                  </Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="caption" color="text.secondary">
                    Nguồn gốc:
                  </Typography>
                  <Typography variant="caption">{selectedDataset.source}</Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="caption" color="text.secondary">
                    Giấy phép (License):
                  </Typography>
                  <Typography variant="caption">{selectedDataset.license}</Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="caption" color="text.secondary">
                    Kiểm toán Checksum (MD5):
                  </Typography>
                  <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                    {selectedDataset.checksum}
                  </Typography>
                </Stack>
              </Stack>
            </Paper>

            {/* Version History */}
            <Box>
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, fontSize: "0.8125rem", display: "block", mb: 1 }}
              >
                LỊCH SỬ PHIÊN BẢN
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Phiên bản</TableCell>
                      <TableCell>Thời điểm</TableCell>
                      <TableCell>Dung lượng</TableCell>
                      <TableCell align="right">Trạng thái</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>
                        {selectedDataset.latestVersion}
                      </TableCell>
                      <TableCell>{selectedDataset.updatedAt}</TableCell>
                      <TableCell>{selectedDataset.size}</TableCell>
                      <TableCell align="right">
                        <Chip label="Hiện tại" size="small" color="success" />
                      </TableCell>
                    </TableRow>
                    {selectedDataset.versionsCount > 1 && (
                      <TableRow>
                        <TableCell>v1.0</TableCell>
                        <TableCell>Tháng trước</TableCell>
                        <TableCell>1.35 GB</TableCell>
                        <TableCell align="right">
                          <Chip label="Đã lưu trữ" size="small" variant="outlined" />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>

            <Stack direction="row" spacing={1.5} sx={{ justifyContent: "flex-end", mt: 2 }}>
              <Button variant="outlined" onClick={() => setDrawerOpen(false)}>
                Đóng
              </Button>
              <Button
                variant="contained"
                startIcon={<Workflow size={16} />}
                onClick={() => {
                  setDrawerOpen(false);
                  if (onNavigateConvert) onNavigateConvert();
                }}
              >
                Tạo tác vụ chuyển đổi
              </Button>
            </Stack>
          </Stack>
        )}
      </Drawer>

      {/* Upload Modal (Section 4.1 in UI.md) */}
      <Dialog
        open={openUploadModal}
        onClose={() => !uploading && setOpenUploadModal(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1.15rem" }}>
          {uploadStep === 1 ? "1. Khai báo dữ liệu nguồn" : "2. Tải lên tệp dữ liệu"}
        </DialogTitle>
        <DialogContent dividers>
          {uploadStep === 1 ? (
            <Stack spacing={2.5}>
              <Typography variant="body2" color="text.secondary">
                Tạo bản ghi dữ liệu nguồn mới và cấu hình thuộc tính trước khi chuyển đổi thành bản
                đồ.
              </Typography>

              <TextField
                label="Tên dữ liệu nguồn"
                fullWidth
                size="small"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ví dụ: Bản đồ Giao thông Cần Thơ"
              />

              <TextField
                label="Mô tả tóm tắt"
                multiline
                rows={2}
                fullWidth
                size="small"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Mô tả nguồn gốc dữ liệu, phạm vi không gian, mục đích sử dụng..."
              />

              <FormControl fullWidth size="small">
                <InputLabel>Định dạng dữ liệu</InputLabel>
                <Select
                  value={formFormat}
                  label="Định dạng dữ liệu"
                  onChange={(e) =>
                    setFormFormat(
                      e.target.value as
                        | "GeoTIFF"
                        | "GeoPackage"
                        | "OSM PBF"
                        | "MBTiles"
                        | "Shapefile"
                    )
                  }
                >
                  <MenuItem value="GeoTIFF">GeoTIFF (.tif, .tiff)</MenuItem>
                  <MenuItem value="GeoPackage">GeoPackage (.gpkg)</MenuItem>
                  <MenuItem value="OSM PBF">OSM PBF (.osm.pbf)</MenuItem>
                  <MenuItem value="MBTiles">MBTiles (.mbtiles)</MenuItem>
                  <MenuItem value="Shapefile">ESRI Shapefile (.zip)</MenuItem>
                </Select>
              </FormControl>

              <TextField
                label="Hệ quy chiếu tọa độ dự kiến (CRS)"
                fullWidth
                size="small"
                value={formCrs}
                onChange={(e) => setFormCrs(e.target.value)}
                helperText="Mặc định: EPSG:3857 hoặc EPSG:4326."
              />

              <TextField
                label="Thẻ phân loại (Tags, phân cách bằng dấu phẩy)"
                fullWidth
                size="small"
                value={formTags}
                onChange={(e) => setFormTags(e.target.value)}
                placeholder="Ví dụ: Đô thị, 2026, Cần Thơ"
              />
            </Stack>
          ) : (
            <Stack spacing={2.5}>
              <Paper
                variant="outlined"
                sx={{
                  p: 4,
                  textAlign: "center",
                  borderStyle: "dashed",
                  borderColor: selectedFile ? "primary.main" : "divider",
                  bgcolor: "action.hover",
                  cursor: "pointer",
                }}
                onClick={() => setSelectedFile("cantho_imagery_2026.tif (620 MB)")}
              >
                <UploadCloud size={40} color="#d32f2f" style={{ margin: "0 auto 12px" }} />
                <Typography variant="body1" sx={{ fontWeight: 650 }}>
                  {selectedFile ? selectedFile : "Kéo thả file vào đây hoặc bấm để chọn"}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 0.5 }}
                >
                  Hỗ trợ tải lên tệp lớn thông qua cơ chế phân đoạn an toàn (Resumable upload).
                </Typography>
              </Paper>

              {uploading && (
                <Stack spacing={1}>
                  <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                    <Typography variant="caption" color="text.secondary">
                      Đang xử lý tải lên...
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>
                      {uploadProgress}%
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={uploadProgress}
                    sx={{ height: 6, borderRadius: 3 }}
                  />
                </Stack>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          {uploadStep === 1 ? (
            <>
              <Button variant="outlined" onClick={() => setOpenUploadModal(false)}>
                Hủy
              </Button>
              <Button variant="contained" disabled={!formName} onClick={() => setUploadStep(2)}>
                Tiếp tục: Chọn file
              </Button>
            </>
          ) : (
            <>
              <Button variant="outlined" disabled={uploading} onClick={() => setUploadStep(1)}>
                Quay lại
              </Button>
              <Button
                variant="contained"
                disabled={!selectedFile || uploading}
                onClick={handleStartUpload}
              >
                {uploading ? "Đang tải lên..." : "Bắt đầu tải lên"}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* Internal Import Modal (Section 4.1 in UI.md) */}
      <Dialog
        open={openImportModal}
        onClose={() => setOpenImportModal(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1.15rem" }}>
          Tiếp nhận dữ liệu từ mạng nội bộ
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              Tiếp nhận các tệp dữ liệu dung lượng lớn đã sẵn sàng trên hạ tầng mạng nội bộ vào
              catalog dữ liệu nguồn.
            </Typography>

            <TextField
              label="Tên định danh tệp dữ liệu"
              fullWidth
              size="small"
              value={internalPath}
              onChange={(e) => setInternalPath(e.target.value)}
              placeholder="ten_tep_du_lieu.tif"
              helperText="Hệ thống sẽ xác thực tính toàn vẹn và tạo phiên bản đầu tiên."
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="outlined" onClick={() => setOpenImportModal(false)}>
            Hủy
          </Button>
          <Button variant="contained" onClick={handleInternalImport}>
            Xác nhận tiếp nhận
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
