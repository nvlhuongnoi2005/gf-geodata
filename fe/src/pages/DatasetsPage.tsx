import type { ReactNode } from "react";
import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import { FileUp, FolderUp, HardDrive, Plus, ShieldCheck } from "lucide-react";
import { useI18n } from "../i18n";
export function DatasetsPage() {
  const { t } = useI18n();
  return (
    <Stack spacing={3.25}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ justifyContent: "space-between", alignItems: { sm: "flex-end" } }}
      >
        <Box>
          <Typography variant="h4">{t("datasets.title")}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.7 }}>
            {t("datasets.description")}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.1}>
          <Button variant="outlined" startIcon={<FolderUp size={17} />}>
            {t("datasets.import")}
          </Button>
          <Button variant="contained" startIcon={<Plus size={17} />}>
            {t("datasets.new")}
          </Button>
        </Stack>
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: { lg: ".85fr 1.55fr" }, gap: 2 }}>
        <Paper variant="outlined" sx={{ p: 2.6 }}>
          <Stack direction="row" spacing={1.1} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                p: 1,
                borderRadius: 2,
                bgcolor: "secondary.light",
                color: "secondary.dark",
                display: "grid",
              }}
            >
              <HardDrive size={19} />
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 750 }}>{t("datasets.storage")}</Typography>
              <Typography variant="caption" color="text.secondary">
                SeaweedFS S3 / raw bucket
              </Typography>
            </Box>
          </Stack>
          <Box sx={{ mt: 2.5, p: 1.5, borderRadius: 2.5, bgcolor: "action.hover" }}>
            <Typography variant="caption" color="text.secondary">
              {t("datasets.storageNote")}
            </Typography>
          </Box>
          <Stack spacing={1.15} sx={{ mt: 2.3 }}>
            <Policy icon={<ShieldCheck size={16} />} text={t("datasets.immutable")} />
            <Policy icon={<FileUp size={16} />} text={t("datasets.audited")} />
          </Stack>
        </Paper>
        <Paper
          variant="outlined"
          sx={{
            minHeight: 350,
            display: "grid",
            placeItems: "center",
            p: 3,
            textAlign: "center",
            borderStyle: "dashed",
          }}
        >
          <Box sx={{ maxWidth: 420 }}>
            <Box
              sx={{
                mx: "auto",
                width: 66,
                height: 66,
                display: "grid",
                placeItems: "center",
                borderRadius: 4,
                bgcolor: "primary.light",
                color: "primary.main",
              }}
            >
              <FolderUp size={30} />
            </Box>
            <Typography variant="h5" sx={{ mt: 2.25 }}>
              {t("datasets.empty")}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.8, lineHeight: 1.65 }}>
              {t("datasets.emptyDescription")}
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              sx={{ mt: 2.5, justifyContent: "center", flexWrap: "wrap", rowGap: 1 }}
            >
              <Chip label="GeoTIFF" size="small" />
              <Chip label="GeoPackage" size="small" />
              <Chip label="MBTiles" size="small" />
              <Chip label="Shapefile" size="small" />
            </Stack>
            <Button variant="contained" startIcon={<Plus size={17} />} sx={{ mt: 2.7 }}>
              {t("dashboard.createDataset")}
            </Button>
          </Box>
        </Paper>
      </Box>
    </Stack>
  );
}
function Policy({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <Stack direction="row" spacing={0.8} sx={{ alignItems: "center", color: "text.secondary" }}>
      <Box sx={{ color: "secondary.main", display: "grid" }}>{icon}</Box>
      <Typography variant="caption">{text}</Typography>
    </Stack>
  );
}
