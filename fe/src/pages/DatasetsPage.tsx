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
  Download,
  FileBox,
  FileSpreadsheet,
  FileUp,
  FolderOpen,
  FolderUp,
  HardDrive,
  Info,
  Layers,
  MapPin,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Tag,
  UploadCloud,
} from "lucide-react";
import { useI18n } from "../i18n";

export type DatasetItem = {
  id: string;
  name: string;
  description: string;
  format: "GeoTIFF" | "GeoPackage" | "OSM PBF" | "MBTiles" | "Shapefile";
  category: "raster" | "vector" | "elevation";
  size: string;
  crs: string;
  bounds: string;
  layersOrBands: string;
  versionsCount: number;
  latestVersion: string;
  checksum: string;
  storageUri: string;
  tags: string[];
  status: "ready" | "processing" | "archived";
  updatedAt: string;
};

const initialDatasets: DatasetItem[] = [
  {
    id: "DS-001",
    name: "Ảnh vệ tinh Hà Nội 2026 (0.5m)",
    description: "Bộ ảnh trực giao toàn bộ khu vực trung tâm và mở rộng Hà Nội độ phân giải 50cm",
    format: "GeoTIFF",
    category: "raster",
    size: "1.42 GB",
    crs: "EPSG:32648 (WGS 84 / UTM zone 48N)",
    bounds: "[105.71, 20.91, 105.93, 21.15]",
    layersOrBands: "4 bands (RGB + NIR)",
    versionsCount: 2,
    latestVersion: "v2.1",
    checksum: "d41d8cd98f00b204e9800998ecf8427e",
    storageUri: "s3://raw-datasets/hanoi_imagery_2026_v2.1.tif",
    tags: ["Satellite", "Hà Nội", "Ortho", "High-Res"],
    status: "ready",
    updatedAt: "Hôm nay, 10:24",
  },
  {
    id: "DS-002",
    name: "Ranh giới hành chính Việt Nam (Bộ TN&MT)",
    description:
      "Dữ liệu phân định ranh giới 3 cấp: Tỉnh/Thành phố, Quận/Huyện, Xã/Phường chuẩn quốc gia",
    format: "GeoPackage",
    category: "vector",
    size: "480 MB",
    crs: "EPSG:3405 (VN-2000 / UTM zone 48N)",
    bounds: "[102.14, 8.18, 109.46, 23.39]",
    layersOrBands: "3 layers (adm1, adm2, adm3)",
    versionsCount: 4,
    latestVersion: "v1.4",
    checksum: "7c222fb2927d828af22f592134e89324",
    storageUri: "s3://raw-datasets/vn_admin_boundaries_v1.4.gpkg",
    tags: ["Boundaries", "Toàn quốc", "Official", "Vector"],
    status: "ready",
    updatedAt: "08/10/2026",
  },
  {
    id: "DS-003",
    name: "Dữ liệu giao thông OpenStreetMap Vietnam PBF",
    description: "Dữ liệu vector giao thông đường bộ, thủy văn, địa danh chiết xuất từ OSM",
    format: "OSM PBF",
    category: "vector",
    size: "3.1 GB",
    crs: "EPSG:4326 (WGS 84 Geographic)",
    bounds: "[102.0, 8.0, 110.0, 24.0]",
    layersOrBands: "Toàn bộ OSM Feature Types",
    versionsCount: 1,
    latestVersion: "v1.0",
    checksum: "9e107d9d372bb6826bd81d3542a419d6",
    storageUri: "s3://raw-datasets/osm_vietnam_extract_2026.osm.pbf",
    tags: ["OSM", "Roads", "Vietnam", "PBF"],
    status: "ready",
    updatedAt: "05/10/2026",
  },
  {
    id: "DS-004",
    name: "Mô hình số độ cao DEM Tây Nguyên 30m",
    description:
      "Dữ liệu độ cao địa hình khu vực Tây Nguyên phục vụ phân tích độ dốc và tạo hillshade",
    format: "GeoTIFF",
    category: "elevation",
    size: "2.8 GB",
    crs: "EPSG:4326 (WGS 84 Geographic)",
    bounds: "[107.2, 11.5, 108.9, 14.8]",
    layersOrBands: "1 band (Float32 Elevation)",
    versionsCount: 1,
    latestVersion: "v1.0",
    checksum: "c33367701511b4f6020ec61ded352059",
    storageUri: "s3://raw-datasets/dem_taynguyen_30m.tif",
    tags: ["DEM", "Elevation", "Tây Nguyên", "Terrain"],
    status: "ready",
    updatedAt: "01/10/2026",
  },
];

export function DatasetsPage({ onNavigatePipeline }: { onNavigatePipeline?: () => void }) {
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
  const [internalPath, setInternalPath] = useState(
    "/mnt/geodata_shared/raw/danang_imagery_2026.tif"
  );

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
    setUploadProgress(10);
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setUploading(false);
          // Add to dataset list
          const newDs: DatasetItem = {
            id: `DS-${String(datasets.length + 1).padStart(3, "0")}`,
            name: formName || "Dataset Mới Upload",
            description: formDescription || "Dữ liệu tải lên thông qua Multipart Presigned S3",
            format: formFormat,
            category: formFormat === "GeoTIFF" ? "raster" : "vector",
            size: "620 MB",
            crs: formCrs,
            bounds: "[105.80, 21.00, 105.85, 21.05]",
            layersOrBands: formFormat === "GeoTIFF" ? "3 bands (RGB)" : "1 layer",
            versionsCount: 1,
            latestVersion: "v1.0",
            checksum: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
            storageUri: `s3://raw-datasets/${formName.toLowerCase().replace(/\s+/g, "_")}_v1.0.raw`,
            tags: formTags ? formTags.split(",").map((s) => s.trim()) : ["Custom", formFormat],
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
          }, 800);
          return 100;
        }
        return prev + 25;
      });
    }, 400);
  };

  const handleInternalImport = () => {
    if (!internalPath) return;
    const imported: DatasetItem = {
      id: `DS-${String(datasets.length + 1).padStart(3, "0")}`,
      name: "Ảnh vệ tinh Đà Nẵng 2026 (Import nội bộ)",
      description: `Đã import từ đường dẫn hạ tầng: ${internalPath} (FR-08)`,
      format: "GeoTIFF",
      category: "raster",
      size: "850 MB",
      crs: "EPSG:32648 (WGS 84 / UTM zone 48N)",
      bounds: "[108.15, 15.95, 108.35, 16.15]",
      layersOrBands: "4 bands (RGB + NIR)",
      versionsCount: 1,
      latestVersion: "v1.0",
      checksum: "ff88112233445566778899aabbccddeeff",
      storageUri: "s3://raw-datasets/danang_imagery_2026.tif",
      tags: ["Đà Nẵng", "Internal-Import", "GeoTIFF"],
      status: "ready",
      updatedAt: "Vừa xong",
    };
    setDatasets([imported, ...datasets]);
    setOpenImportModal(false);
  };

  const handleOpenDetail = (ds: DatasetItem) => {
    setSelectedDataset(ds);
    setDrawerOpen(true);
  };

  return (
    <Stack spacing={3}>
      {/* Header section */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ justifyContent: "space-between", alignItems: { sm: "flex-end" } }}
      >
        <Box>
          <Typography variant="h4">{t("datasets.title")}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {t("datasets.description")}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.2}>
          <Button
            variant="outlined"
            startIcon={<FolderUp size={16} />}
            onClick={() => setOpenImportModal(true)}
          >
            {t("datasets.import")} (Mạng nội bộ)
          </Button>
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            onClick={() => {
              setUploadStep(1);
              setOpenUploadModal(true);
            }}
          >
            {t("datasets.new")} (Upload lớn)
          </Button>
        </Stack>
      </Stack>

      {/* Storage Information Banner */}
      <Paper
        variant="outlined"
        sx={{
          p: 2,
          bgcolor: "action.hover",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 2,
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Box sx={{ p: 1, borderRadius: 2, bgcolor: "secondary.light", color: "secondary.dark" }}>
            <HardDrive size={20} />
          </Box>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              Lưu trữ SeaweedFS S3 (Air-gapped Object Storage)
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Bucket: <code style={{ color: "#0d9488" }}>s3://raw-datasets</code> · Tách riêng với
              derived tilesets để bảo đảm tính bất biến (Immutable).
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Chip icon={<ShieldCheck size={14} />} label="Raw Data Immutable" size="small" />
          <Chip icon={<FileUp size={14} />} label="Audited & Versioned" size="small" />
        </Stack>
      </Paper>

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
              { key: "GeoTIFF", label: "GeoTIFF (Raster)" },
              { key: "GeoPackage", label: "GeoPackage (Vector)" },
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

      {/* Datasets Table */}
      <TableContainer component={Paper} variant="outlined">
        <Table sx={{ minWidth: 800 }}>
          <TableHead>
            <TableRow>
              <TableCell>Tên Dataset & Mã</TableCell>
              <TableCell>Định dạng</TableCell>
              <TableCell>Dung lượng</TableCell>
              <TableCell>Hệ tọa độ (CRS)</TableCell>
              <TableCell>Phiên bản</TableCell>
              <TableCell>Trạng thái</TableCell>
              <TableCell align="right">Hành động</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredDatasets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ textAlign: "center", py: 5 }}>
                  <Typography color="text.secondary">Không tìm thấy dataset nào phù hợp</Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredDatasets.map((ds) => (
                <TableRow key={ds.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {ds.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      {ds.id} · {ds.description.slice(0, 55)}...
                    </Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                      {ds.tags.map((t, i) => (
                        <Chip
                          key={i}
                          label={t}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: 10, height: 20 }}
                        />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={ds.format}
                      size="small"
                      color={ds.format === "GeoTIFF" ? "primary" : "secondary"}
                      variant="outlined"
                      sx={{ fontWeight: 700 }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {ds.size}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                      {ds.crs.split(" ")[0]}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      {ds.layersOrBands}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={ds.latestVersion} size="small" />
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 0.2 }}
                    >
                      {ds.versionsCount} version
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      icon={<CheckCircle2 size={13} />}
                      label="Sẵn sàng"
                      size="small"
                      color="success"
                      sx={{ fontWeight: 700 }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.8} sx={{ justifyContent: "flex-end" }}>
                      <Tooltip title="Xem thông tin chi tiết & lịch sử version">
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<Info size={14} />}
                          onClick={() => handleOpenDetail(ds)}
                        >
                          Chi tiết
                        </Button>
                      </Tooltip>
                      <Tooltip title="Tạo Job xử lý GDAL từ dataset này">
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<Play size={14} />}
                          onClick={() => {
                            if (onNavigatePipeline) onNavigatePipeline();
                          }}
                        >
                          GDAL Job
                        </Button>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Dataset Metadata Inspector Drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 540 }, p: 3 } } }}
      >
        {selectedDataset && (
          <Stack spacing={2.5}>
            <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  {selectedDataset.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {selectedDataset.id} · Cập nhật: {selectedDataset.updatedAt}
                </Typography>
              </Box>
              <Chip label={selectedDataset.latestVersion} color="primary" size="small" />
            </Stack>

            <Divider />

            <Typography variant="body2">{selectedDataset.description}</Typography>

            <Paper variant="outlined" sx={{ p: 2, bgcolor: "action.hover" }}>
              <Typography variant="caption" sx={{ fontWeight: 700, display: "block", mb: 1 }}>
                METADATA ĐỊA KHÔNG GIAN (FR-10)
              </Typography>
              <Stack spacing={1}>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="caption" color="text.secondary">
                    Định dạng file:
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {selectedDataset.format}
                  </Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="caption" color="text.secondary">
                    Dung lượng raw:
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
                    Ranh giới (Bounding Box):
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
                    Mã Checksum (MD5):
                  </Typography>
                  <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                    {selectedDataset.checksum}
                  </Typography>
                </Stack>
              </Stack>
            </Paper>

            <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 2 }}>
              <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }}>
                Đường dẫn Object Storage SeaweedFS (NFR-03):
              </Typography>
              <Typography
                variant="caption"
                sx={{ fontFamily: "monospace", color: "secondary.main" }}
              >
                {selectedDataset.storageUri}
              </Typography>
            </Box>

            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, display: "block", mb: 1 }}>
                LỊCH SỬ RAW ASSET VERSIONS (FR-09, FR-11)
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Phiên bản</TableCell>
                      <TableCell>Thời điểm</TableCell>
                      <TableCell>Kích thước</TableCell>
                      <TableCell align="right">Trạng thái</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>
                        {selectedDataset.latestVersion} (Hiện tại)
                      </TableCell>
                      <TableCell>{selectedDataset.updatedAt}</TableCell>
                      <TableCell>{selectedDataset.size}</TableCell>
                      <TableCell align="right">
                        <Chip label="Active" size="small" color="success" />
                      </TableCell>
                    </TableRow>
                    {selectedDataset.versionsCount > 1 && (
                      <TableRow>
                        <TableCell>v1.0 (Lưu trữ)</TableCell>
                        <TableCell>Tháng trước</TableCell>
                        <TableCell>1.35 GB</TableCell>
                        <TableCell align="right">
                          <Chip label="Archived" size="small" variant="outlined" />
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
                startIcon={<Play size={16} />}
                onClick={() => {
                  setDrawerOpen(false);
                  if (onNavigatePipeline) onNavigatePipeline();
                }}
              >
                Chuyển sang GDAL Pipeline
              </Button>
            </Stack>
          </Stack>
        )}
      </Drawer>

      {/* Multipart Presigned Upload Modal (FR-07, FR-42) */}
      <Dialog
        open={openUploadModal}
        onClose={() => !uploading && setOpenUploadModal(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>
          {uploadStep === 1
            ? "1. Khai báo Dataset mới"
            : "2. Upload file lớn (Multipart Presigned URL)"}
        </DialogTitle>
        <DialogContent dividers>
          {uploadStep === 1 ? (
            <Stack spacing={2.5}>
              <Alert severity="info" sx={{ fontSize: 13 }}>
                Browser không truy cập trực tiếp credential S3. Khi tải lên, hệ thống sẽ cấp
                presigned multipart URL tạm thời để upload dữ liệu an toàn.
              </Alert>

              <TextField
                label="Tên Dataset"
                fullWidth
                size="small"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ví dụ: Ảnh trực giao Cần Thơ 2026"
              />

              <TextField
                label="Mô tả tóm tắt"
                multiline
                rows={2}
                fullWidth
                size="small"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Mô tả nguồn gốc dữ liệu, độ phân giải, mục đích sử dụng..."
              />

              <FormControl fullWidth size="small">
                <InputLabel>Định dạng dữ liệu nguồn</InputLabel>
                <Select
                  value={formFormat}
                  label="Định dạng dữ liệu nguồn"
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
                  <MenuItem value="GeoTIFF">
                    GeoTIFF (.tif, .tiff) — Raster ảnh vệ tinh / DEM
                  </MenuItem>
                  <MenuItem value="GeoPackage">
                    GeoPackage (.gpkg) — Vector đa lớp chuẩn OGC
                  </MenuItem>
                  <MenuItem value="OSM PBF">
                    OSM PBF (.osm.pbf) — OpenStreetMap Protocolbuffer
                  </MenuItem>
                  <MenuItem value="MBTiles">
                    MBTiles (.mbtiles) — SQLite vector/raster tiles
                  </MenuItem>
                  <MenuItem value="Shapefile">ESRI Shapefile (.zip) — Vector lưu trữ nén</MenuItem>
                </Select>
              </FormControl>

              <TextField
                label="Hệ quy chiếu tọa độ dự kiến (CRS)"
                fullWidth
                size="small"
                value={formCrs}
                onChange={(e) => setFormCrs(e.target.value)}
                helperText="Mặc định: EPSG:3857 hoặc EPSG:4326. GDAL sẽ tự động đọc từ header file."
              />

              <TextField
                label="Thẻ phân loại (Tags, cách nhau bằng dấu phẩy)"
                fullWidth
                size="small"
                value={formTags}
                onChange={(e) => setFormTags(e.target.value)}
                placeholder="Ví dụ: Vệ tinh, Đô thị, 2026, Cần Thơ"
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
                onClick={() => setSelectedFile("cantho_imagery_2026_raw.tif (620 MB)")}
              >
                <UploadCloud size={40} color="#d32f2f" style={{ margin: "0 auto 12px" }} />
                <Typography variant="body1" sx={{ fontWeight: 700 }}>
                  {selectedFile
                    ? selectedFile
                    : "Kéo thả file geodata lớn vào đây hoặc bấm để chọn file"}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 0.5 }}
                >
                  Hỗ trợ file lên tới 50 GB qua cơ chế chia nhỏ chunk 20MB & tiếp tục khi mất mạng
                  (Resumable)
                </Typography>
              </Paper>

              {uploading && (
                <Stack spacing={1}>
                  <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                    <Typography variant="caption" color="text.secondary">
                      Đang tải lên SeaweedFS qua Multipart Presigned URL...
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>
                      {uploadProgress}%
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={uploadProgress}
                    sx={{ height: 8, borderRadius: 4 }}
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
                {uploading ? "Đang upload..." : "Bắt đầu tải lên"}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      {/* Internal Import Modal (FR-08) */}
      <Dialog
        open={openImportModal}
        onClose={() => setOpenImportModal(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Import dữ liệu từ mạng nội bộ (FR-08)</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Alert severity="info" sx={{ fontSize: 13 }}>
              Hỗ trợ import trực tiếp các file dung lượng cực lớn đã có sẵn trên NAS / SAN / Volume
              nội bộ mà không cần tải qua trình duyệt.
            </Alert>

            <TextField
              label="Đường dẫn file trên mạng nội bộ / Server"
              fullWidth
              size="small"
              value={internalPath}
              onChange={(e) => setInternalPath(e.target.value)}
              placeholder="/mnt/geodata_shared/raw/filename.tif"
              helperText="Hệ thống sẽ copy vào SeaweedFS bucket và tính mã checksum kiểm toán tự động."
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="outlined" onClick={() => setOpenImportModal(false)}>
            Hủy
          </Button>
          <Button variant="contained" onClick={handleInternalImport}>
            Xác nhận Import
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
