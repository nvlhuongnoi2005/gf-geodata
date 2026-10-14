import { useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { Database, FileUp, ShieldCheck, UploadCloud } from "lucide-react";
import { useI18n } from "../i18n";
import { useAuth } from "../auth";

const acceptedFileTypes = ".osm.pbf,.tif,.tiff,.gpkg,.zip,.mbtiles";

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DatasetsPage() {
  const { t } = useI18n();
  const { accessToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState<"success" | "error" | null>(null);

  const openUploadPanel = () => {
    setSelectedFile(null);
    setUploadProgress(0);
    setUploadMessage(null);
    setUploadPanelOpen(true);
  };

  const startUpload = () => {
    if (!selectedFile || !accessToken || uploading) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadMessage(null);
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/geodata/v1/uploads?filename=${encodeURIComponent(selectedFile.name)}`);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      setUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploadProgress(100);
        setUploadMessage("success");
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } else {
        setUploadMessage("error");
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      setUploadMessage("error");
    };
    xhr.send(selectedFile);
  };

  return (
    <Stack spacing={3}>
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

        <Button variant="contained" startIcon={<UploadCloud size={17} />} onClick={openUploadPanel}>
          {t("datasets.new")}
        </Button>
      </Stack>

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

      <Paper
        variant="outlined"
        sx={{ py: 7, px: 3, textAlign: "center", display: "grid", placeItems: "center" }}
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
            startIcon={<UploadCloud size={16} />}
            onClick={openUploadPanel}
          >
            {t("datasets.new")}
          </Button>
        </Box>
      </Paper>

      <Dialog
        open={uploadPanelOpen}
        onClose={() => setUploadPanelOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>{t("datasets.uploadTitle")}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
              {t("datasets.uploadDescription")}
            </Typography>

            <Paper
              component="button"
              type="button"
              variant="outlined"
              onClick={() => fileInputRef.current?.click()}
              sx={{
                width: "100%",
                p: 3,
                borderStyle: "dashed",
                bgcolor: "background.default",
                color: "text.primary",
                cursor: "pointer",
                "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
              }}
            >
              <UploadCloud size={36} color="#d32f2f" />
              <Typography component="span" sx={{ display: "block", mt: 1.25, fontWeight: 700 }}>
                {selectedFile ? selectedFile.name : t("datasets.chooseFile")}
              </Typography>
              <Typography
                component="span"
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 0.5 }}
              >
                {selectedFile
                  ? `${formatFileSize(selectedFile.size)} · ${selectedFile.type || t("datasets.unknownFileType")}`
                  : t("datasets.supportedFormats")}
              </Typography>
            </Paper>
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptedFileTypes}
              hidden
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />

            {uploading && <LinearProgress variant="determinate" value={uploadProgress} />}
            {uploadMessage && (
              <Alert severity={uploadMessage === "success" ? "success" : "error"}>
                {t(
                  uploadMessage === "success" ? "datasets.uploadSucceeded" : "datasets.uploadFailed"
                )}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="outlined" disabled={uploading} onClick={() => setUploadPanelOpen(false)}>
            {t("common.close")}
          </Button>
          <Button
            variant="contained"
            disabled={!selectedFile || !accessToken || uploading}
            startIcon={<UploadCloud size={16} />}
            onClick={startUpload}
          >
            {t("datasets.startUpload")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
