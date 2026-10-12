import type { ReactNode } from "react";
import { Box, Button, Chip, LinearProgress, Paper, Stack, Typography } from "@mui/material";
import {
  ArrowRight,
  CheckCircle2,
  Database,
  HardDrive,
  ShieldCheck,
  UploadCloud,
  Workflow,
} from "lucide-react";
import { useI18n } from "../i18n";
type PageKey = "overview" | "datasets" | "pipeline" | "styles" | "releases" | "access";
export function DashboardPage({ onNavigate }: { onNavigate: (page: PageKey) => void }) {
  const { t } = useI18n();
  return (
    <Stack spacing={3.25}>
      <Paper
        sx={{
          overflow: "hidden",
          position: "relative",
          p: { xs: 2.5, sm: 4 },
          bgcolor: "#11262c",
          color: "#f1fbfa",
          backgroundImage:
            "radial-gradient(circle at 82% 35%, rgb(55 156 137 / 42%), transparent 30%), radial-gradient(circle at 32% 130%, rgb(223 23 67 / 30%), transparent 42%)",
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={3}
          sx={{ justifyContent: "space-between", alignItems: { md: "flex-end" } }}
        >
          <Box>
            <Chip
              icon={<CheckCircle2 size={14} />}
              label={t("dashboard.ready")}
              size="small"
              sx={{ bgcolor: "rgb(98 230 203 / 16%)", color: "#bffff0" }}
            />
            <Typography variant="h3" sx={{ mt: 2.2, maxWidth: 660 }}>
              {t("dashboard.title")}
            </Typography>
            <Typography
              sx={{ mt: 1.4, maxWidth: 590, color: "rgb(235 252 249 / 70%)", lineHeight: 1.7 }}
            >
              {t("dashboard.description")}
            </Typography>
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
            <Button
              variant="outlined"
              onClick={() => onNavigate("pipeline")}
              sx={{ color: "#eafff9", borderColor: "rgb(234 255 249 / 28%)" }}
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
          value="0"
          detail={t("dashboard.datasetsDetail")}
        />
        <Metric
          icon={<Workflow size={20} />}
          label={t("dashboard.jobs")}
          value="0"
          detail={t("dashboard.jobsDetail")}
          tone="teal"
        />
        <Metric
          icon={<HardDrive size={20} />}
          label={t("dashboard.rawStorage")}
          value="SeaweedFS S3"
          detail={t("dashboard.rawStorageDetail")}
          tone="amber"
        />
        <Metric
          icon={<ShieldCheck size={20} />}
          label={t("dashboard.releases")}
          value="0"
          detail={t("dashboard.releasesDetail")}
          tone="slate"
        />
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { lg: "1.45fr .9fr" }, gap: 2 }}>
        <Paper variant="outlined" sx={{ p: { xs: 2.25, sm: 3 } }}>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <Box>
              <Typography variant="h6">{t("dashboard.setup")}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.45 }}>
                {t("dashboard.setupDescription")}
              </Typography>
            </Box>
            <Chip
              label={t("dashboard.step", { current: 1, total: 3 })}
              size="small"
              color="primary"
            />
          </Stack>
          <Stack spacing={2} sx={{ mt: 3 }}>
            <SetupRow
              number="01"
              title={t("dashboard.seaweed")}
              description={t("dashboard.seaweedDescription")}
              state={t("dashboard.waiting")}
            />
            <SetupRow
              number="02"
              title={t("dashboard.createDataset")}
              description={t("dashboard.createDatasetDescription")}
              state={t("dashboard.next")}
              muted
            />
            <SetupRow
              number="03"
              title={t("dashboard.publish")}
              description={t("dashboard.publishDescription")}
              state={t("dashboard.next")}
              muted
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
        <Paper variant="outlined" sx={{ p: { xs: 2.25, sm: 3 } }}>
          <Typography variant="h6">{t("dashboard.health")}</Typography>
          <Stack spacing={2.1} sx={{ mt: 2.6 }}>
            <HealthRow
              label={t("dashboard.mapAuth")}
              value={t("dashboard.connected")}
              color="#16806e"
            />
            <HealthRow
              label={t("dashboard.storageBackend")}
              value={t("dashboard.notBootstrapped")}
              color="#a96108"
            />
            <HealthRow
              label={t("dashboard.tileGateway")}
              value={t("dashboard.notConfigured")}
              color="#87959a"
            />
          </Stack>
          <Box sx={{ mt: 3, px: 1.5, py: 1.3, borderRadius: 2.5, bgcolor: "action.hover" }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ lineHeight: 1.55, display: "block" }}
            >
              {t("dashboard.note")}
            </Typography>
          </Box>
        </Paper>
      </Box>
    </Stack>
  );
}
function Metric({
  icon,
  label,
  value,
  detail,
  tone = "red",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: "red" | "teal" | "amber" | "slate";
}) {
  const colors = {
    red: ["#fff0f3", "#b50e35"],
    teal: ["#e6f7f3", "#08776b"],
    amber: ["#fff5e8", "#9a5905"],
    slate: ["#eef3f4", "#53666c"],
  }[tone];
  return (
    <Paper variant="outlined" sx={{ p: 2.25 }}>
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
          <Typography variant="h5" sx={{ lineHeight: 1.1, mt: 0.15 }}>
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
  muted = false,
}: {
  number: string;
  title: string;
  description: string;
  state: string;
  muted?: boolean;
}) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ opacity: muted ? 0.6 : 1 }}>
      <Box
        sx={{
          width: 30,
          height: 30,
          flexShrink: 0,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          bgcolor: muted ? "action.hover" : "primary.main",
          color: muted ? "text.secondary" : "#fff",
          fontSize: 11,
          fontWeight: 800,
        }}
      >
        {number}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 750 }}>
            {title}
          </Typography>
          <Typography
            variant="caption"
            color={muted ? "text.secondary" : "primary.main"}
            sx={{ whiteSpace: "nowrap", fontWeight: 700 }}
          >
            {state}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: "block" }}>
          {description}
        </Typography>
        {!muted && (
          <LinearProgress
            value={35}
            variant="determinate"
            sx={{ mt: 1, height: 5, borderRadius: 5 }}
          />
        )}
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
