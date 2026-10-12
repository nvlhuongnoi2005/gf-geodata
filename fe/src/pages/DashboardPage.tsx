import { useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  HardDrive,
  Layers,
  Paintbrush,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  UploadCloud,
  Workflow,
  Zap,
} from "lucide-react";
import { useI18n } from "../i18n";

type PageKey = "overview" | "datasets" | "pipeline" | "styles" | "releases" | "access";

export function DashboardPage({ onNavigate }: { onNavigate: (page: PageKey) => void }) {
  const { t } = useI18n();
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [healthStatus, setHealthStatus] = useState<"ok" | "pending">("ok");

  const handleRecheckHealth = () => {
    setCheckingHealth(true);
    setTimeout(() => {
      setCheckingHealth(false);
      setHealthStatus("ok");
    }, 1200);
  };

  return (
    <Stack spacing={3.25}>
      {/* Hero Welcome Banner */}
      <Paper
        sx={{
          overflow: "hidden",
          position: "relative",
          p: { xs: 2.5, sm: 4 },
          bgcolor: "#0b141a",
          color: "#f1fbfa",
          borderRadius: 3,
          backgroundImage:
            "radial-gradient(circle at 85% 30%, rgba(20, 184, 166, 0.35), transparent 45%), radial-gradient(circle at 20% 120%, rgba(211, 47, 47, 0.28), transparent 45%)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={3}
          sx={{ justifyContent: "space-between", alignItems: { md: "flex-end" } }}
        >
          <Box>
            <Chip
              icon={<Zap size={14} color="#14b8a6" />}
              label="Hệ thống Quản trị Geodata · Sẵn sàng vận hành"
              size="small"
              sx={{ bgcolor: "rgba(20, 184, 166, 0.15)", color: "#5eead4", fontWeight: 700 }}
            />
            <Typography variant="h3" sx={{ mt: 2.2, maxWidth: 680, fontWeight: 800 }}>
              {t("dashboard.title")}
            </Typography>
            <Typography
              sx={{ mt: 1.4, maxWidth: 620, color: "rgba(241, 245, 249, 0.75)", lineHeight: 1.7 }}
            >
              {t("dashboard.description")}
            </Typography>
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
            <Button
              variant="outlined"
              onClick={() => onNavigate("pipeline")}
              sx={{ color: "#f8fafc", borderColor: "rgba(255, 255, 255, 0.3)" }}
              startIcon={<Workflow size={16} />}
            >
              {t("dashboard.viewPipeline")}
            </Button>
            <Button
              variant="contained"
              startIcon={<UploadCloud size={18} />}
              onClick={() => onNavigate("datasets")}
            >
              {t("dashboard.addDataset")}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* Quick Actions Shortcuts */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 1.75,
        }}
      >
        <QuickActionButton
          icon={<Database size={18} />}
          title="Nạp Dataset mới"
          subtitle="Tải file GeoTIFF, GeoPackage"
          onClick={() => onNavigate("datasets")}
        />
        <QuickActionButton
          icon={<Play size={18} />}
          title="Tạo Job GDAL"
          subtitle="Chuyển đổi COG, PMTiles"
          onClick={() => onNavigate("pipeline")}
        />
        <QuickActionButton
          icon={<Paintbrush size={18} />}
          title="Thiết kế Style"
          subtitle="Chỉnh sửa MapLibre v8"
          onClick={() => onNavigate("styles")}
        />
        <QuickActionButton
          icon={<Send size={18} />}
          title="Phát hành Map Release"
          subtitle="Xuất bản Catalog WebGIS"
          onClick={() => onNavigate("releases")}
        />
      </Box>

      {/* Primary KPI Metrics */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 2,
        }}
      >
        <Metric
          icon={<Database size={20} />}
          label={t("dashboard.datasets")}
          value="4 datasets"
          detail="7.8 GB dữ liệu raw lưu trữ trong SeaweedFS"
          tone="red"
          onClick={() => onNavigate("datasets")}
        />
        <Metric
          icon={<Workflow size={20} />}
          label={t("dashboard.jobs")}
          value="1 đang chạy / 4"
          detail="Worker pool GDAL 3.9 đang hoạt động ổn định"
          tone="teal"
          onClick={() => onNavigate("pipeline")}
        />
        <Metric
          icon={<HardDrive size={20} />}
          label={t("dashboard.rawStorage")}
          value="SeaweedFS S3"
          detail="Air-gapped private cluster, 2 buckets active"
          tone="amber"
          onClick={() => onNavigate("datasets")}
        />
        <Metric
          icon={<ShieldCheck size={20} />}
          label={t("dashboard.releases")}
          value="3 Live Releases"
          detail="Catalog WebGIS đồng bộ qua JWT claims"
          tone="slate"
          onClick={() => onNavigate("releases")}
        />
      </Box>

      {/* Workflow Guidance & System Health */}
      <Box sx={{ display: "grid", gridTemplateColumns: { lg: "1.4fr 1fr" }, gap: 2 }}>
        {/* Setup & Onboarding Progress */}
        <Paper variant="outlined" sx={{ p: { xs: 2.25, sm: 3 } }}>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <Box>
              <Typography variant="h6">{t("dashboard.setup")}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.45 }}>
                {t("dashboard.setupDescription")}
              </Typography>
            </Box>
            <Chip label="Hoàn tất 3 / 3 bước" size="small" color="success" variant="outlined" />
          </Stack>

          <Stack spacing={2} sx={{ mt: 3 }}>
            <SetupRow
              number="01"
              title="Khởi tạo SeaweedFS S3 & Raw Bucket"
              description="Đã gắn s3://raw-datasets và s3://derived-tilesets trên persistent volume"
              state="Đã sẵn sàng"
              isDone
              onClick={() => onNavigate("datasets")}
            />
            <SetupRow
              number="02"
              title="Tiếp nhận và chuyển đổi dữ liệu nguồn"
              description="Nạp dữ liệu GeoTIFF/GeoPackage và cấu hình pipeline GDAL"
              state="Hoạt động"
              isDone
              onClick={() => onNavigate("pipeline")}
            />
            <SetupRow
              number="03"
              title="Xuất bản Map Release & Phân quyền ACL"
              description="Liên kết style version và cấp quyền truy cập theo UUID sub"
              state="Sẵn sàng"
              isDone
              onClick={() => onNavigate("releases")}
            />
          </Stack>

          <Button
            sx={{ mt: 2.4 }}
            endIcon={<ArrowRight size={16} />}
            onClick={() => onNavigate("datasets")}
          >
            {t("dashboard.openDatasets")}
          </Button>
        </Paper>

        {/* System Health Monitor */}
        <Paper variant="outlined" sx={{ p: { xs: 2.25, sm: 3 } }}>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
            <Box>
              <Typography variant="h6">{t("dashboard.health")}</Typography>
              <Typography variant="caption" color="text.secondary">
                Giám sát tình trạng hạ tầng offline
              </Typography>
            </Box>
            <Button
              size="small"
              variant="outlined"
              startIcon={<RefreshCw size={14} className={checkingHealth ? "status-pulse" : ""} />}
              onClick={handleRecheckHealth}
              disabled={checkingHealth}
            >
              {checkingHealth ? "Đang kiểm tra..." : "Kiểm tra lại"}
            </Button>
          </Stack>

          <Stack spacing={2.1} sx={{ mt: 2.8 }}>
            <HealthRow
              label="Dịch vụ Xác thực WebGIS (db-auth)"
              value={healthStatus === "ok" ? "Sẵn sàng (JWT Auth)" : "Đang kiểm tra"}
              color="#16a34a"
            />
            <HealthRow
              label="Hạ tầng lưu trữ SeaweedFS S3"
              value={healthStatus === "ok" ? "Online (100% Volume)" : "Đang kết nối"}
              color="#16a34a"
            />
            <HealthRow
              label="Worker Pool GDAL 3.9"
              value={healthStatus === "ok" ? "4 Workers Available" : "Khởi động"}
              color="#16a34a"
            />
            <HealthRow
              label="Tile Gateway & Cache Policy"
              value={healthStatus === "ok" ? "Không share cache restricted" : "Chờ"}
              color="#0284c7"
            />
          </Stack>

          <Box sx={{ mt: 3, px: 1.5, py: 1.3, borderRadius: 2.5, bgcolor: "action.hover" }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ lineHeight: 1.55, display: "block" }}
            >
              {t("dashboard.note")} Hệ thống kiểm tra quyền hạn ngay tại thời điểm phục vụ TileJSON,
              sprite và vector tiles (FR-35).
            </Typography>
          </Box>
        </Paper>
      </Box>

      {/* Recent Pipeline Activity Stream */}
      <Paper variant="outlined" sx={{ p: { xs: 2.25, sm: 3 } }}>
        <Stack
          direction="row"
          sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Activity size={18} color="#d32f2f" />
            <Typography variant="h6">Hoạt động & Tiến trình Xử lý Gần đây</Typography>
          </Stack>
          <Button size="small" onClick={() => onNavigate("pipeline")}>
            Xem toàn bộ hàng đợi
          </Button>
        </Stack>

        <Stack spacing={1.5}>
          <ActivityRow
            badge="GDAL PIPELINE"
            badgeColor="primary"
            title="Job JOB-2026-081: Đang tạo overviews cho Ảnh vệ tinh Hà Nội (0.5m)"
            time="Đang chạy (68%)"
            detail="Tác vụ: gdaladdo 2 4 8 16 32 — Worker: gdal-worker-02"
          />
          <ActivityRow
            badge="MAP RELEASE"
            badgeColor="success"
            title="Xuất bản thành công: Bản đồ Nền Quốc Gia Chuẩn (Vector v2.1)"
            time="Hôm nay, 10:10"
            detail="Đã cập nhật catalog tương thích WebGIS (/api/tile-catalog)"
          />
          <ActivityRow
            badge="ACCESS CONTROL"
            badgeColor="info"
            title="Cấp quyền xem cho kỹ sư Nguyễn Văn Trung (usr-9f2a-...)"
            time="Hôm nay, 09:30"
            detail="Gán quyền truy cập Map Release Ảnh Vệ Tinh Đô Thị"
          />
        </Stack>
      </Paper>
    </Stack>
  );
}

function QuickActionButton({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 2,
        cursor: "pointer",
        transition: "all 0.15s ease",
        "&:hover": {
          borderColor: "primary.main",
          bgcolor: "action.hover",
          transform: "translateY(-2px)",
        },
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Box sx={{ p: 1, borderRadius: 2, bgcolor: "primary.light", color: "primary.main" }}>
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
            {subtitle}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
  tone = "red",
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: "red" | "teal" | "amber" | "slate";
  onClick?: () => void;
}) {
  const colors = {
    red: ["rgba(211, 47, 47, 0.12)", "#d32f2f"],
    teal: ["rgba(20, 184, 166, 0.12)", "#0f766e"],
    amber: ["rgba(217, 119, 6, 0.12)", "#b45309"],
    slate: ["rgba(71, 85, 105, 0.12)", "#334155"],
  }[tone];

  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 2.25,
        cursor: onClick ? "pointer" : "default",
        transition: "border-color 0.15s ease",
        "&:hover": onClick ? { borderColor: "primary.main" } : {},
      }}
    >
      <Stack direction="row" spacing={1.35} sx={{ alignItems: "center" }}>
        <Box
          sx={{
            p: 1.05,
            borderRadius: 2.25,
            bgcolor: colors[0],
            color: colors[1],
            display: "grid",
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h5" sx={{ lineHeight: 1.1, mt: 0.15, fontWeight: 800 }}>
            {value}
          </Typography>
        </Box>
      </Stack>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ mt: 1.45, display: "block", lineHeight: 1.45 }}
      >
        {detail}
      </Typography>
    </Paper>
  );
}

function SetupRow({
  number,
  title,
  description,
  state,
  isDone = false,
  onClick,
}: {
  number: string;
  title: string;
  description: string;
  state: string;
  isDone?: boolean;
  onClick?: () => void;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      onClick={onClick}
      sx={{
        cursor: onClick ? "pointer" : "default",
        p: 1,
        borderRadius: 2,
        "&:hover": onClick ? { bgcolor: "action.hover" } : {},
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          flexShrink: 0,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          bgcolor: isDone ? "success.main" : "primary.main",
          color: "#fff",
          fontSize: 12,
          fontWeight: 800,
        }}
      >
        {isDone ? <CheckCircle2 size={16} /> : number}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          <Typography
            variant="caption"
            color={isDone ? "success.main" : "primary.main"}
            sx={{ whiteSpace: "nowrap", fontWeight: 700 }}
          >
            {state}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: "block" }}>
          {description}
        </Typography>
      </Box>
    </Stack>
  );
}

function HealthRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: color }} />
        <Typography variant="body2">{label}</Typography>
      </Stack>
      <Typography variant="caption" sx={{ color, fontWeight: 800 }}>
        {value}
      </Typography>
    </Stack>
  );
}

function ActivityRow({
  badge,
  badgeColor,
  title,
  time,
  detail,
}: {
  badge: string;
  badgeColor: "primary" | "success" | "info";
  title: string;
  time: string;
  detail: string;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "action.hover" }}>
      <Stack
        direction="row"
        sx={{ justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Chip
            label={badge}
            size="small"
            color={badgeColor}
            sx={{ fontSize: 10, height: 20, fontWeight: 800 }}
          />
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
          {time}
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
        {detail}
      </Typography>
    </Paper>
  );
}
