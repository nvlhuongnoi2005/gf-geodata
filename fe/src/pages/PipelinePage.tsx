import { useState, useEffect } from "react";
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
  AlertCircle,
  CheckCircle2,
  Clock,
  Cpu,
  FileCode,
  HardDrive,
  Layers,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Terminal,
  Workflow,
  XCircle,
} from "lucide-react";
import { useI18n } from "../i18n";

export type PipelineJob = {
  id: string;
  datasetName: string;
  sourceVersion: string;
  taskType: "raster_cog" | "vector_mbtiles" | "vector_pmtiles" | "raster_mbtiles";
  taskLabel: string;
  status: "running" | "queued" | "completed" | "failed";
  progress: number;
  currentStep: string;
  duration: string;
  inputSize: string;
  outputSize: string;
  startedAt: string;
  logs: string[];
};

const initialJobs: PipelineJob[] = [
  {
    id: "JOB-2026-081",
    datasetName: "Ảnh vệ tinh Hà Nội 2026 (0.5m)",
    sourceVersion: "v2.1",
    taskType: "raster_cog",
    taskLabel: "GeoTIFF → Cloud Optimized GeoTIFF (COG)",
    status: "running",
    progress: 68,
    currentStep: "gdaladdo overviews (levels: 2 4 8 16 32)",
    duration: "1m 45s",
    inputSize: "1.42 GB",
    outputSize: "980 MB (tính toán)",
    startedAt: "Hôm nay, 10:24",
    logs: [
      "[10:24:02] [INFO] Khởi tạo worker GDAL 3.9 container id: gdal-worker-02",
      "[10:24:05] [INFO] Tải raw asset từ SeaweedFS: s3://raw-datasets/hanoi_imagery_2026_v2.tif",
      "[10:24:18] [INFO] Kiểm tra file: Driver=GTiff, Size=32400x24800, Bands=4, CRS=EPSG:32648 (WGS 84 / UTM zone 48N)",
      "[10:24:22] [EXEC] gdalwarp -s_srs EPSG:32648 -t_srs EPSG:3857 -r bilinear -co COMPRESS=DEFLATE input.tif reprojected.tif",
      "[10:24:55] [INFO] Tái chiếu CRS EPSG:3857 hoàn tất (100%)",
      "[10:25:01] [EXEC] gdaladdo -r average reprojected.tif 2 4 8 16 32",
      "[10:25:28] [INFO] Đang xử lý overview pyramids... 68% hoàn tất",
    ],
  },
  {
    id: "JOB-2026-079",
    datasetName: "Ranh giới hành chính Việt Nam (Bộ TN&MT)",
    sourceVersion: "v1.4",
    taskType: "vector_pmtiles",
    taskLabel: "GeoPackage → PMTiles Vector (z0-z14)",
    status: "completed",
    progress: 100,
    currentStep: "Hoàn tất sinh tileset & checksum MD5",
    duration: "4m 12s",
    inputSize: "480 MB",
    outputSize: "84 MB",
    startedAt: "Hôm nay, 09:15",
    logs: [
      "[09:15:00] [INFO] Worker tippecanoe-worker-01 tiếp nhận job",
      "[09:15:10] [INFO] Kiểm tra layer GeoPackage: adm1_provinces (63), adm2_districts (705), adm3_communes (10599)",
      "[09:15:35] [EXEC] tippecanoe -o vn_boundaries.pmtiles -zg --drop-densest-as-needed -l administrative input.gpkg",
      "[09:18:42] [INFO] Sinh vector tiles thành công (z0 đến z14)",
      "[09:19:02] [INFO] Upload tileset artifact sang SeaweedFS s3://derived-tilesets/vn_admin_v1.4.pmtiles",
      "[09:19:12] [SUCCESS] TileJSON đã sẵn sàng cho Map Release. Trạng thái: READY",
    ],
  },
  {
    id: "JOB-2026-078",
    datasetName: "Dữ liệu giao thông OpenStreetMap Vietnam PBF",
    sourceVersion: "v1.0",
    taskType: "vector_mbtiles",
    taskLabel: "OSM PBF → Vector Tiles (MBTiles)",
    status: "completed",
    progress: 100,
    currentStep: "Tileset đã lưu kho SeaweedFS",
    duration: "18m 30s",
    inputSize: "3.1 GB",
    outputSize: "890 MB",
    startedAt: "Hôm qua, 16:40",
    logs: [
      "[16:40:12] [INFO] Nhận file PBF osm_vietnam_extract_2026.osm.pbf",
      "[16:42:00] [INFO] Lọc các layer roads, water, buildings, poi bằng osm2pgsql",
      "[16:55:18] [INFO] Ghép tile vector z0-z15",
      "[16:58:42] [SUCCESS] Hoàn tất xuất bản tileset MBTiles",
    ],
  },
  {
    id: "JOB-2026-075",
    datasetName: "Mô hình số độ cao DEM Tây Nguyên 30m",
    sourceVersion: "v1.0",
    taskType: "raster_cog",
    taskLabel: "GeoTIFF DEM → Hillshade Terrarium PNG",
    status: "failed",
    progress: 42,
    currentStep: "Lỗi: Không đủ dung lượng RAM khi sinh hillshade",
    duration: "1m 12s",
    inputSize: "2.8 GB",
    outputSize: "--",
    startedAt: "Hôm qua, 14:10",
    logs: [
      "[14:10:05] [INFO] Nhận dữ liệu DEM GeoTIFF",
      "[14:10:45] [EXEC] gdaldem hillshade -z 1.5 -s 111120 dem_taynguyen.tif hillshade.tif",
      "[14:11:17] [ERROR] std::bad_alloc: Worker vượt quá giới hạn 4GB RAM cấu hình trong NFR-08",
      "[14:11:17] [FATAL] Job thất bại. Đề xuất: bật chế độ chunk tile hoặc tăng RAM worker.",
    ],
  },
];

export function PipelinePage() {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<PipelineJob[]>(initialJobs);
  const [selectedJob, setSelectedJob] = useState<PipelineJob | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [openCreateModal, setOpenCreateModal] = useState(false);
  const [logDrawerOpen, setLogDrawerOpen] = useState(false);

  // Form states
  const [formDataset, setFormDataset] = useState("Ảnh vệ tinh Đà Nẵng 2026 (1m)");
  const [formProfile, setFormProfile] = useState<
    "raster_cog" | "vector_mbtiles" | "vector_pmtiles"
  >("raster_cog");
  const [formTargetCrs, setFormTargetCrs] = useState("EPSG:3857 (Web Mercator)");
  const [formMinZoom, setFormMinZoom] = useState("0");
  const [formMaxZoom, setFormMaxZoom] = useState("16");

  // Simulated progress for running jobs
  useEffect(() => {
    const interval = setInterval(() => {
      setJobs((prevJobs) =>
        prevJobs.map((job) => {
          if (job.status === "running") {
            const nextProgress = Math.min(100, job.progress + 3);
            if (nextProgress === 100) {
              return {
                ...job,
                progress: 100,
                status: "completed",
                currentStep: "Hoàn tất sinh tileset & đã validate TileJSON",
                logs: [
                  ...job.logs,
                  `[${new Date().toLocaleTimeString()}] [SUCCESS] Job hoàn tất thành công 100%. Tileset sẵn sàng!`,
                ],
              };
            }
            return {
              ...job,
              progress: nextProgress,
            };
          }
          return job;
        })
      );
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const filteredJobs = jobs.filter((job) => {
    const matchesFilter = filterStatus === "all" || job.status === filterStatus;
    const matchesSearch =
      job.datasetName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.taskLabel.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const runningCount = jobs.filter((j) => j.status === "running").length;
  const queuedCount = jobs.filter((j) => j.status === "queued").length;
  const completedCount = jobs.filter((j) => j.status === "completed").length;
  const failedCount = jobs.filter((j) => j.status === "failed").length;

  const handleRetryJob = (jobId: string) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id === jobId) {
          return {
            ...j,
            status: "running",
            progress: 10,
            currentStep: "Thử lại: Khởi động worker với cấu hình tối ưu bộ nhớ...",
            logs: [
              ...j.logs,
              `[${new Date().toLocaleTimeString()}] [RETRY] Admin khởi động lại job. Tự động chia nhỏ khối xử lý.`,
            ],
          };
        }
        return j;
      })
    );
  };

  const handleCancelJob = (jobId: string) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id === jobId) {
          return {
            ...j,
            status: "failed",
            currentStep: "Đã bị quản trị viên hủy",
            logs: [
              ...j.logs,
              `[${new Date().toLocaleTimeString()}] [CANCEL] Quản trị viên hủy tiến trình.`,
            ],
          };
        }
        return j;
      })
    );
  };

  const handleCreateJob = () => {
    const newJob: PipelineJob = {
      id: `JOB-2026-${String(Math.floor(Math.random() * 900) + 100)}`,
      datasetName: formDataset,
      sourceVersion: "v1.0",
      taskType: formProfile,
      taskLabel:
        formProfile === "raster_cog"
          ? "GeoTIFF → Cloud Optimized GeoTIFF (COG)"
          : formProfile === "vector_pmtiles"
            ? `GeoPackage → PMTiles (z${formMinZoom}-z${formMaxZoom})`
            : `Vector Data → MBTiles (z${formMinZoom}-z${formMaxZoom})`,
      status: "running",
      progress: 5,
      currentStep: "Khởi tạo container GDAL và mount dữ liệu nguồn",
      duration: "0m 10s",
      inputSize: "850 MB",
      outputSize: "Đang xử lý...",
      startedAt: "Vừa xong",
      logs: [
        `[${new Date().toLocaleTimeString()}] [INIT] Tạo job xử lý cho dataset: ${formDataset}`,
        `[${new Date().toLocaleTimeString()}] [CONFIG] Target CRS: ${formTargetCrs}, Zoom: ${formMinZoom}-${formMaxZoom}`,
        `[${new Date().toLocaleTimeString()}] [WORKER] Cấp phát 2 vCPU, 4GB RAM worker pool`,
      ],
    };
    setJobs([newJob, ...jobs]);
    setOpenCreateModal(false);
  };

  const openLogs = (job: PipelineJob) => {
    setSelectedJob(job);
    setLogDrawerOpen(true);
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
          <Typography variant="h4">{t("nav.pipeline")}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Quản lý hàng đợi chuyển đổi dữ liệu GDAL (Reproject, COG, PMTiles, Overviews) và giám
            sát tiến độ xử lý offline.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.2}>
          <Button
            variant="outlined"
            startIcon={<RefreshCw size={16} />}
            onClick={() => setJobs([...jobs])}
          >
            Làm mới hàng đợi
          </Button>
          <Button
            variant="contained"
            startIcon={<Play size={16} />}
            onClick={() => setOpenCreateModal(true)}
          >
            Tạo Job xử lý mới
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
                bgcolor: "info.light",
                color: "info.main",
                display: "grid",
              }}
            >
              <Cpu size={20} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Đang xử lý (Running)
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                {runningCount}{" "}
                <Typography component="span" variant="caption">
                  / 4 slots
                </Typography>
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
              <Clock size={20} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Hàng đợi (Queued)
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                {queuedCount} job
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
                bgcolor: "success.light",
                color: "success.main",
                display: "grid",
              }}
            >
              <CheckCircle2 size={20} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Hoàn tất (Ready)
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                {completedCount} tileset
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
                bgcolor: "error.light",
                color: "error.main",
                display: "grid",
              }}
            >
              <AlertCircle size={20} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Lỗi / Cần thử lại
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                {failedCount}
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
              { key: "all", label: "Tất cả (" + jobs.length + ")" },
              { key: "running", label: "Đang chạy (" + runningCount + ")" },
              { key: "completed", label: "Hoàn tất (" + completedCount + ")" },
              { key: "failed", label: "Thất bại (" + failedCount + ")" },
            ].map((f) => (
              <Chip
                key={f.key}
                label={f.label}
                clickable
                color={filterStatus === f.key ? "primary" : "default"}
                variant={filterStatus === f.key ? "filled" : "outlined"}
                onClick={() => setFilterStatus(f.key)}
              />
            ))}
          </Stack>

          <TextField
            size="small"
            placeholder="Tìm theo ID, dataset hoặc tác vụ..."
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

      {/* Job Table */}
      <TableContainer component={Paper} variant="outlined">
        <Table sx={{ minWidth: 750 }}>
          <TableHead>
            <TableRow>
              <TableCell>Job ID & Dataset</TableCell>
              <TableCell>Tác vụ GDAL</TableCell>
              <TableCell>Tiến độ & Bước hiện tại</TableCell>
              <TableCell>Dung lượng</TableCell>
              <TableCell>Thời gian</TableCell>
              <TableCell>Trạng thái</TableCell>
              <TableCell align="right">Hành động</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredJobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ textAlign: "center", py: 5 }}>
                  <Typography color="text.secondary">Không tìm thấy job phù hợp</Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredJobs.map((job) => (
                <TableRow key={job.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {job.id}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {job.datasetName} ({job.sourceVersion})
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      icon={<FileCode size={13} />}
                      label={job.taskLabel}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: 11 }}
                    />
                  </TableCell>
                  <TableCell sx={{ minWidth: 200 }}>
                    <Stack spacing={0.6}>
                      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                          {job.currentStep}
                        </Typography>
                        <Typography variant="caption" sx={{ fontWeight: 700 }}>
                          {job.progress}%
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={job.progress}
                        color={
                          job.status === "failed"
                            ? "error"
                            : job.status === "completed"
                              ? "success"
                              : "primary"
                        }
                        sx={{ height: 6, borderRadius: 3 }}
                      />
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ display: "block" }}>
                      Vào: {job.inputSize}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Ra: {job.outputSize}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ display: "block", fontWeight: 600 }}>
                      {job.duration}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {job.startedAt}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {job.status === "running" && (
                      <Chip
                        icon={<RefreshCw size={13} className="status-pulse" />}
                        label="Đang xử lý"
                        size="small"
                        color="primary"
                        sx={{ fontWeight: 700 }}
                      />
                    )}
                    {job.status === "completed" && (
                      <Chip
                        icon={<CheckCircle2 size={13} />}
                        label="Hoàn tất"
                        size="small"
                        color="success"
                        sx={{ fontWeight: 700 }}
                      />
                    )}
                    {job.status === "failed" && (
                      <Chip
                        icon={<XCircle size={13} />}
                        label="Lỗi"
                        size="small"
                        color="error"
                        sx={{ fontWeight: 700 }}
                      />
                    )}
                    {job.status === "queued" && (
                      <Chip label="Đang chờ" size="small" variant="outlined" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.8} sx={{ justifyContent: "flex-end" }}>
                      <Tooltip title="Xem log terminal của job">
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<Terminal size={14} />}
                          onClick={() => openLogs(job)}
                        >
                          Log
                        </Button>
                      </Tooltip>
                      {job.status === "failed" && (
                        <Tooltip title="Thử lại job xử lý">
                          <Button
                            size="small"
                            variant="contained"
                            color="warning"
                            startIcon={<RotateCcw size={14} />}
                            onClick={() => handleRetryJob(job.id)}
                          >
                            Thử lại
                          </Button>
                        </Tooltip>
                      )}
                      {job.status === "running" && (
                        <Tooltip title="Hủy tiến trình">
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={() => handleCancelJob(job.id)}
                          >
                            Hủy
                          </Button>
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create Job Dialog */}
      <Dialog
        open={openCreateModal}
        onClose={() => setOpenCreateModal(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Tạo Job xử lý GDAL mới</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Alert severity="info" sx={{ fontSize: 13 }}>
              Hệ thống sẽ chạy container GDAL offline, chuyển đổi dữ liệu nguồn và xuất artifact
              tileset vào SeaweedFS mà không làm gián đoạn runtime.
            </Alert>

            <FormControl fullWidth size="small">
              <InputLabel>Dataset nguồn</InputLabel>
              <Select
                value={formDataset}
                label="Dataset nguồn"
                onChange={(e) => setFormDataset(e.target.value)}
              >
                <MenuItem value="Ảnh vệ tinh Đà Nẵng 2026 (1m)">
                  Ảnh vệ tinh Đà Nẵng 2026 (1m) — GeoTIFF (850 MB)
                </MenuItem>
                <MenuItem value="Ảnh vệ tinh Hà Nội 2026 (0.5m)">
                  Ảnh vệ tinh Hà Nội 2026 (0.5m) — GeoTIFF (1.42 GB)
                </MenuItem>
                <MenuItem value="Ranh giới hành chính Việt Nam (Bộ TN&MT)">
                  Ranh giới hành chính Việt Nam — GeoPackage (480 MB)
                </MenuItem>
                <MenuItem value="Mô hình số độ cao DEM Tây Nguyên 30m">
                  DEM Tây Nguyên 30m — GeoTIFF (2.8 GB)
                </MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel>Profile xử lý GDAL</InputLabel>
              <Select
                value={formProfile}
                label="Profile xử lý GDAL"
                onChange={(e) =>
                  setFormProfile(
                    e.target.value as "raster_cog" | "vector_mbtiles" | "vector_pmtiles"
                  )
                }
              >
                <MenuItem value="raster_cog">
                  Cloud Optimized GeoTIFF (COG) — Chuẩn raster tối ưu stream
                </MenuItem>
                <MenuItem value="vector_pmtiles">
                  Vector PMTiles (Tippecanoe) — Định dạng vector tile hiện đại
                </MenuItem>
                <MenuItem value="vector_mbtiles">
                  Vector MBTiles (SQLite) — Tương thích tiêu chuẩn Mapbox
                </MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel>Hệ tọa độ đích (Target CRS)</InputLabel>
              <Select
                value={formTargetCrs}
                label="Hệ tọa độ đích (Target CRS)"
                onChange={(e) => setFormTargetCrs(e.target.value)}
              >
                <MenuItem value="EPSG:3857 (Web Mercator)">
                  EPSG:3857 (WGS 84 / Pseudo-Mercator) — Tiêu chuẩn bản đồ web
                </MenuItem>
                <MenuItem value="EPSG:4326 (WGS 84)">EPSG:4326 (WGS 84 Geographic 2D)</MenuItem>
                <MenuItem value="EPSG:3405 (VN-2000)">EPSG:3405 (VN-2000 / UTM zone 48N)</MenuItem>
              </Select>
            </FormControl>

            <Stack direction="row" spacing={2}>
              <TextField
                label="Mức Zoom tối thiểu (Min Zoom)"
                type="number"
                size="small"
                fullWidth
                value={formMinZoom}
                onChange={(e) => setFormMinZoom(e.target.value)}
              />
              <TextField
                label="Mức Zoom tối đa (Max Zoom)"
                type="number"
                size="small"
                fullWidth
                value={formMaxZoom}
                onChange={(e) => setFormMaxZoom(e.target.value)}
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="outlined" onClick={() => setOpenCreateModal(false)}>
            Hủy
          </Button>
          <Button variant="contained" startIcon={<Play size={16} />} onClick={handleCreateJob}>
            Khởi chạy Job
          </Button>
        </DialogActions>
      </Dialog>

      {/* Log Terminal Drawer */}
      <Drawer
        anchor="right"
        open={logDrawerOpen}
        onClose={() => setLogDrawerOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 580 }, p: 3 } } }}
      >
        {selectedJob && (
          <Stack spacing={2.5}>
            <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Log Job: {selectedJob.id}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {selectedJob.datasetName}
                </Typography>
              </Box>
              <Chip
                label={selectedJob.status.toUpperCase()}
                color={
                  selectedJob.status === "completed"
                    ? "success"
                    : selectedJob.status === "failed"
                      ? "error"
                      : "primary"
                }
                size="small"
              />
            </Stack>

            <Divider />

            {/* Hardware Metrics Monitor */}
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "action.hover" }}>
              <Typography variant="caption" sx={{ fontWeight: 700, display: "block", mb: 1 }}>
                Tài nguyên Worker (NFR-08 Enforced)
              </Typography>
              <Stack direction="row" spacing={3}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    CPU Usage
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    68% (2 vCPU)
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    RAM Limit
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    2.1 GB / 4.0 GB
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Scratch Disk
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    1.2 GB / 10 GB
                  </Typography>
                </Box>
              </Stack>
            </Paper>

            {/* Terminal Stream */}
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: "block" }}>
                Terminal Output Console
              </Typography>
              <Box className="terminal-stream" sx={{ maxHeight: 420, overflowY: "auto" }}>
                {selectedJob.logs.map((logLine, index) => (
                  <div key={index} style={{ marginBottom: 4 }}>
                    {logLine}
                  </div>
                ))}
              </Box>
            </Box>

            <Stack direction="row" spacing={1.5} sx={{ justifyContent: "flex-end", mt: 2 }}>
              {selectedJob.status === "failed" && (
                <Button
                  variant="contained"
                  color="warning"
                  startIcon={<RotateCcw size={15} />}
                  onClick={() => {
                    handleRetryJob(selectedJob.id);
                    setLogDrawerOpen(false);
                  }}
                >
                  Thử lại Job này
                </Button>
              )}
              <Button variant="outlined" onClick={() => setLogDrawerOpen(false)}>
                Đóng
              </Button>
            </Stack>
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}
