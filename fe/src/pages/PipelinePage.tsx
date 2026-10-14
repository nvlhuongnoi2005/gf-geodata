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
  AlertCircle,
  CheckCircle2,
  Clock,
  Cpu,
  FileCode,
  Layers,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Workflow,
  XCircle,
} from "lucide-react";
import { useI18n } from "../i18n";

export type ConversionTask = {
  id: string;
  datasetName: string;
  sourceVersion: string;
  configLabel: string;
  status: "running" | "queued" | "completed" | "needs_check";
  progress: number;
  currentStep: string;
  duration: string;
  inputSize: string;
  outputSize: string;
  startedAt: string;
  stepsHistory: Array<{
    timestamp: string;
    label: string;
    status: "done" | "in_progress" | "error";
  }>;
};

export function PipelinePage() {
  const { t } = useI18n();
  const [tasks] = useState<ConversionTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<ConversionTask | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [openCreateModal, setOpenCreateModal] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Form states
  const [formDataset, setFormDataset] = useState("");
  const [formConfig, setFormConfig] = useState("raster_stream");
  const [formTargetCrs, setFormTargetCrs] = useState("EPSG:3857 (Chuẩn Web)");
  const [formMinZoom, setFormMinZoom] = useState("0");
  const [formMaxZoom, setFormMaxZoom] = useState("16");

  const filteredTasks = tasks.filter((item) => {
    const matchesFilter = filterStatus === "all" || item.status === filterStatus;
    const matchesSearch =
      item.datasetName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.configLabel.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const runningCount = tasks.filter((t) => t.status === "running").length;
  const queuedCount = tasks.filter((t) => t.status === "queued").length;
  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const needsCheckCount = tasks.filter((t) => t.status === "needs_check").length;

  // Task mutations will be supplied by the pipeline API.
  const handleRetryTask = (_id: string) => undefined;
  const handleCancelTask = (_id: string) => undefined;

  const handleCreateTask = () => {
    setOpenCreateModal(false);
  };

  const openDetail = (task: ConversionTask) => {
    setSelectedTask(task);
    setDrawerOpen(true);
  };

  return (
    <Stack spacing={3}>
      {/* Header section (Section 5 & Section 6 in UI.md) */}
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
            {t("nav.pipeline")}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5, fontSize: "0.9375rem" }}
          >
            Quản lý các tác vụ chuyển đổi dữ liệu nguồn thành bản đồ, tối ưu hóa hiển thị và các mức
            tỷ lệ.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.2}>
          <Button
            variant="outlined"
            startIcon={<RefreshCw size={16} />}
          >
            {t("pipeline.refresh")}
          </Button>
          <Button
            variant="contained"
            startIcon={<Play size={16} />}
            disabled
          >
            {t("pipeline.create")}
          </Button>
        </Stack>
      </Stack>

      {/* Overview Cards (22-24px metric value, Section 6) */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 2,
        }}
      >
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {t("pipeline.running")}
          </Typography>
          <Typography sx={{ fontSize: "1.45rem", fontWeight: 700, mt: 0.5, color: "text.primary" }}>
            {runningCount} tác vụ
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
            Hệ thống chuyển đổi đang hoạt động
          </Typography>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {t("pipeline.queued")}
          </Typography>
          <Typography sx={{ fontSize: "1.45rem", fontWeight: 700, mt: 0.5, color: "text.primary" }}>
            {queuedCount} tác vụ
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
            Không có tác vụ tồn đọng
          </Typography>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {t("pipeline.completed")}
          </Typography>
          <Typography sx={{ fontSize: "1.45rem", fontWeight: 700, mt: 0.5, color: "success.main" }}>
            {completedCount} tác vụ
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
            Sản phẩm đã sẵn sàng xuất bản
          </Typography>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {t("pipeline.needsCheck")}
          </Typography>
          <Typography sx={{ fontSize: "1.45rem", fontWeight: 700, mt: 0.5, color: "warning.main" }}>
            {needsCheckCount} tác vụ
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25 }}>
            Có thể thử lại với cấu hình tối ưu
          </Typography>
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
              { key: "all", label: "Tất cả (" + tasks.length + ")" },
              { key: "running", label: "Đang xử lý (" + runningCount + ")" },
              { key: "completed", label: "Hoàn tất (" + completedCount + ")" },
              { key: "needs_check", label: "Cần kiểm tra (" + needsCheckCount + ")" },
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
              placeholder={t("pipeline.search")}
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

      {/* Task Table (Section 5 in UI.md) */}
      <TableContainer component={Paper} variant="outlined">
        <Table sx={{ minWidth: 780 }}>
          <TableHead>
            <TableRow>
              <TableCell>{t("pipeline.source")}</TableCell>
              <TableCell>{t("pipeline.output")}</TableCell>
              <TableCell>{t("pipeline.progress")}</TableCell>
              <TableCell>{t("pipeline.duration")}</TableCell>
              <TableCell>{t("pipeline.time")}</TableCell>
              <TableCell>{t("pipeline.status")}</TableCell>
              <TableCell align="right">{t("pipeline.actions")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredTasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ textAlign: "center", py: 5 }}>
                  <Typography color="text.secondary">
                    {t("pipeline.empty")}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              filteredTasks.map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {item.id}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.datasetName} ({item.sourceVersion})
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      icon={<FileCode size={13} />}
                      label={item.configLabel}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: 11 }}
                    />
                  </TableCell>
                  <TableCell sx={{ minWidth: 220 }}>
                    <Stack spacing={0.6}>
                      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                          {item.currentStep}
                        </Typography>
                        <Typography variant="caption" sx={{ fontWeight: 700 }}>
                          {item.progress}%
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={item.progress}
                        color={
                          item.status === "needs_check"
                            ? "warning"
                            : item.status === "completed"
                              ? "success"
                              : "primary"
                        }
                        sx={{ height: 6, borderRadius: 3 }}
                      />
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ display: "block" }}>
                      {t("pipeline.source")}: {item.inputSize}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t("pipeline.output")}: {item.outputSize}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ display: "block", fontWeight: 600 }}>
                      {item.duration}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.startedAt}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {item.status === "running" && (
                      <Chip
                        label={t("pipeline.running")}
                        size="small"
                        color="primary"
                        sx={{ fontWeight: 700 }}
                      />
                    )}
                    {item.status === "completed" && (
                      <Chip
                        icon={<CheckCircle2 size={13} />}
                        label="Hoàn tất"
                        size="small"
                        color="success"
                        sx={{ fontWeight: 700 }}
                      />
                    )}
                    {item.status === "needs_check" && (
                      <Chip
                        icon={<AlertCircle size={13} />}
                        label={t("pipeline.needsCheck")}
                        size="small"
                        color="warning"
                        sx={{ fontWeight: 700 }}
                      />
                    )}
                    {item.status === "queued" && (
                      <Chip label={t("pipeline.queued")} size="small" variant="outlined" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.8} sx={{ justifyContent: "flex-end" }}>
                      <Button size="small" variant="outlined" onClick={() => openDetail(item)}>
                        Tiến trình
                      </Button>
                      {item.status === "needs_check" && (
                        <Button
                          size="small"
                          variant="contained"
                          color="warning"
                          startIcon={<RotateCcw size={14} />}
                          onClick={() => handleRetryTask(item.id)}
                        >
                          {t("pipeline.retry")}
                        </Button>
                      )}
                      {item.status === "running" && (
                        <Button
                          size="small"
                          variant="outlined"
                          color="inherit"
                          onClick={() => handleCancelTask(item.id)}
                        >
                          {t("pipeline.cancel")}
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create Conversion Task Modal (Section 5 in UI.md) */}
      <Dialog
        open={openCreateModal}
        onClose={() => setOpenCreateModal(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1.15rem" }}>
          {t("pipeline.create")}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              Chọn phiên bản dữ liệu nguồn và cấu hình sản phẩm đầu ra (định dạng, phạm vi, mức tỷ
              lệ zoom).
            </Typography>

            <FormControl fullWidth size="small">
              <InputLabel>{t("pipeline.sourceData")}</InputLabel>
              <Select
                value={formDataset}
                label={t("pipeline.sourceData")}
                onChange={(e) => setFormDataset(e.target.value)}
              >
                <MenuItem value="" disabled>
                  Chưa có dữ liệu nguồn. Hãy tải dữ liệu lên trước.
                </MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel>{t("pipeline.outputConfig")}</InputLabel>
              <Select
                value={formConfig}
                label={t("pipeline.outputConfig")}
                onChange={(e) => setFormConfig(e.target.value)}
              >
                <MenuItem value="raster_stream">
                  Bản đồ Raster tối ưu hóa stream (Cloud-Ready Pyramids)
                </MenuItem>
                <MenuItem value="vector_multi">
                  Bản đồ Vector nhiều mức tỷ lệ (Vector Tiles)
                </MenuItem>
                <MenuItem value="offline_package">
                  Gói bản đồ ngoại tuyến (Offline Package)
                </MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel>{t("pipeline.targetCrs")}</InputLabel>
              <Select
                value={formTargetCrs}
                label={t("pipeline.targetCrs")}
                onChange={(e) => setFormTargetCrs(e.target.value)}
              >
                <MenuItem value="EPSG:3857 (Chuẩn Web)">
                  EPSG:3857 (WGS 84 / Web Mercator) — Tiêu chuẩn bản đồ web
                </MenuItem>
                <MenuItem value="EPSG:4326 (WGS 84)">EPSG:4326 (WGS 84 Geographic)</MenuItem>
                <MenuItem value="EPSG:3405 (VN-2000)">EPSG:3405 (VN-2000 / UTM zone 48N)</MenuItem>
              </Select>
            </FormControl>

            <Stack direction="row" spacing={2}>
              <TextField
                label={t("pipeline.minZoom")}
                type="number"
                size="small"
                fullWidth
                value={formMinZoom}
                onChange={(e) => setFormMinZoom(e.target.value)}
              />
              <TextField
                label={t("pipeline.maxZoom")}
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
            {t("pipeline.cancelDialog")}
          </Button>
          <Button
            variant="contained"
            startIcon={<Play size={16} />}
            disabled={!formDataset}
            onClick={handleCreateTask}
          >
            {t("pipeline.start")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Task Details Drawer (Operational Summary - Safe Production) */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 520 }, p: 3 } } }}
      >
        {selectedTask && (
          <Stack spacing={2.5}>
            <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, fontSize: "1.2rem" }}>
                  Tác vụ: {selectedTask.id}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {selectedTask.datasetName} ({selectedTask.sourceVersion})
                </Typography>
              </Box>
              <Chip
                label={
                  selectedTask.status === "completed"
                    ? "HOÀN TẤT"
                    : selectedTask.status === "running"
                      ? "ĐANG XỬ LÝ"
                      : "CẦN KIỂM TRA"
                }
                color={
                  selectedTask.status === "completed"
                    ? "success"
                    : selectedTask.status === "needs_check"
                      ? "warning"
                      : "primary"
                }
                size="small"
              />
            </Stack>

            <Divider />

            {/* Operational Summary */}
            <Paper variant="outlined" sx={{ p: 2, bgcolor: "action.hover" }}>
              <Typography variant="caption" sx={{ fontWeight: 700, display: "block", mb: 1.5 }}>
                THÔNG TIN TIẾN TRÌNH
              </Typography>
              <Stack spacing={1}>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="caption" color="text.secondary">
                    Cấu hình:
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {selectedTask.configLabel}
                  </Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="caption" color="text.secondary">
                    Dung lượng nguồn:
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {selectedTask.inputSize}
                  </Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="caption" color="text.secondary">
                    Dung lượng sản phẩm:
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {selectedTask.outputSize}
                  </Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                  <Typography variant="caption" color="text.secondary">
                    Thời gian xử lý:
                  </Typography>
                  <Typography variant="caption">{selectedTask.duration}</Typography>
                </Stack>
              </Stack>
            </Paper>

            {/* Milestones History (Safe business steps) */}
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, display: "block", mb: 1.5 }}>
                CÁC BƯỚC THỰC HIỆN
              </Typography>
              <Stack spacing={1.5}>
                {selectedTask.stepsHistory.map((step, idx) => (
                  <Paper key={idx} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack
                      direction="row"
                      sx={{ justifyContent: "space-between", alignItems: "center" }}
                    >
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        {step.status === "done" && <CheckCircle2 size={16} color="#16a34a" />}
                        {step.status === "in_progress" && <Clock size={16} color="#0284c7" />}
                        {step.status === "error" && <AlertCircle size={16} color="#d97706" />}
                        <Typography variant="body2" sx={{ fontSize: "0.875rem", fontWeight: 600 }}>
                          {step.label}
                        </Typography>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {step.timestamp}
                      </Typography>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </Box>

            <Stack direction="row" spacing={1.5} sx={{ justifyContent: "flex-end", mt: 2 }}>
              {selectedTask.status === "needs_check" && (
                <Button
                  variant="contained"
                  color="warning"
                  startIcon={<RotateCcw size={15} />}
                  onClick={() => {
                    handleRetryTask(selectedTask.id);
                    setDrawerOpen(false);
                  }}
                >
                  {t("pipeline.retry")}
                </Button>
              )}
              <Button variant="outlined" onClick={() => setDrawerOpen(false)}>
                Đóng
              </Button>
            </Stack>
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}
