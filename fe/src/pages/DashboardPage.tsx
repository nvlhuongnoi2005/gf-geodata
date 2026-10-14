import type { ReactNode } from "react";
import { Box, Paper, Stack, Typography } from "@mui/material";
import { Database, HardDrive, Layers, Workflow } from "lucide-react";
import { useI18n } from "../i18n";

export function DashboardPage() {
  const { t } = useI18n();

  return (
    <Stack spacing={3}>
      {/* Page Header (26-28px, Semi-bold, operational focus) */}
      <Box>
        <Typography
          variant="h4"
          sx={{
            fontSize: { xs: 24, sm: 27 },
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "text.primary",
          }}
        >
          {t("nav.overview")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: "0.9375rem" }}>
          {t("dashboard.description")}
        </Typography>
      </Box>

      {/* 4 Overview Metric Cards (Responsive Grid, 22-24px metric value, no links/CTAs) */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 2,
        }}
      >
        <MetricCard
          icon={<Database size={20} />}
          label={t("dashboard.datasets")}
          value="0"
          subtitle={t("dashboard.datasetsDetail")}
          tone="primary"
        />
        <MetricCard
          icon={<Workflow size={20} />}
          label={t("dashboard.jobs")}
          value="0"
          subtitle={t("dashboard.jobsDetail")}
          tone="teal"
        />
        <MetricCard
          icon={<HardDrive size={20} />}
          label={t("dashboard.rawStorage")}
          value="Chưa có dữ liệu"
          subtitle={t("dashboard.rawStorageDetail")}
          tone="amber"
        />
        <MetricCard
          icon={<Layers size={20} />}
          label={t("dashboard.releases")}
          value="0"
          subtitle={t("dashboard.releasesDetail")}
          tone="slate"
        />
      </Box>

      {/* System Health Section (Section 3.3 in UI.md) */}
      <Paper variant="outlined" sx={{ p: { xs: 2.25, sm: 3 }, maxWidth: 720 }}>
        <Typography
          variant="h6"
          sx={{
            fontSize: "1.1rem",
            fontWeight: 650,
            letterSpacing: "-0.01em",
            mb: 0.5,
          }}
        >
          {t("dashboard.health")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.875rem", mb: 2.5 }}>
          Trạng thái sẽ được cập nhật khi các dịch vụ thực tế được kết nối.
        </Typography>

        <Stack spacing={2}>
          <HealthRow label={t("dashboard.mapAuth")} state="Chưa kết nối" />
          <HealthRow label={t("dashboard.storageBackend")} state="Chưa kết nối" />
          <HealthRow label={t("dashboard.tileGateway")} state="Chưa kết nối" />
        </Stack>

        <Box sx={{ mt: 3, pt: 2, borderTop: "1px solid", borderColor: "divider" }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: "0.8125rem", lineHeight: 1.6, display: "block" }}
          >
            {t("dashboard.note")}
          </Typography>
        </Box>
      </Paper>
    </Stack>
  );
}

function MetricCard({
  icon,
  label,
  value,
  subtitle,
  tone = "primary",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  subtitle: string;
  tone?: "primary" | "teal" | "amber" | "slate";
}) {
  const toneColors = {
    primary: ["rgba(211, 47, 47, 0.1)", "#d32f2f"],
    teal: ["rgba(13, 148, 136, 0.1)", "#0d9488"],
    amber: ["rgba(217, 119, 6, 0.1)", "#b45309"],
    slate: ["rgba(71, 85, 105, 0.1)", "#475569"],
  }[tone];

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Box
          sx={{
            width: 38,
            height: 38,
            borderRadius: 2,
            bgcolor: toneColors[0],
            color: toneColors[1],
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontSize: "0.8125rem", fontWeight: 600 }}
        >
          {label}
        </Typography>
      </Stack>

      {/* Metric value: 22-24px per Section 6 */}
      <Typography
        sx={{
          fontSize: "1.45rem",
          fontWeight: 700,
          lineHeight: 1.25,
          mt: 1.75,
          color: "text.primary",
        }}
      >
        {value}
      </Typography>

      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          fontSize: "0.8125rem",
          lineHeight: 1.5,
          mt: 0.75,
          display: "block",
        }}
      >
        {subtitle}
      </Typography>
    </Paper>
  );
}

function HealthRow({ label, state }: { label: string; state: string }) {
  return (
    <Stack
      direction="row"
      sx={{
        justifyContent: "space-between",
        alignItems: "center",
        py: 0.5,
      }}
    >
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            bgcolor: "text.disabled",
            boxShadow: "0 0 0 3px rgba(100, 116, 139, 0.15)",
          }}
        />
        <Typography variant="body2" sx={{ fontSize: "0.9375rem", fontWeight: 600 }}>
          {label}
        </Typography>
      </Stack>

      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          fontWeight: 700,
          fontSize: "0.8125rem",
        }}
      >
        {state}
      </Typography>
    </Stack>
  );
}
