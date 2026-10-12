import type { ReactNode } from "react";
import { Chip, Paper, Stack, Typography } from "@mui/material";
import { useI18n } from "../i18n";

export function PlaceholderPage({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  const { t } = useI18n();
  return (
    <Paper variant="outlined" sx={{ minHeight: 360, display: "grid", placeItems: "center", p: 4 }}>
      <Stack spacing={1.5} sx={{ maxWidth: 440, textAlign: "center", alignItems: "center" }}>
        <span>{icon}</span>
        <Chip label={t("common.comingSoon")} size="small" color="primary" variant="outlined" />
        <Typography variant="h4">{title}</Typography>
        <Typography color="text.secondary">{description}</Typography>
      </Stack>
    </Paper>
  );
}
