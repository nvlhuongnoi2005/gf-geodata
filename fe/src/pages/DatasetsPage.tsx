import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { Database, FileUp, ShieldCheck, UploadCloud } from "lucide-react";
import { useI18n, type TranslationKey } from "../i18n";
import { useAuth } from "../auth";

const acceptedFileTypes = ".osm.pbf,.tif,.tiff,.gpkg,.zip,.mbtiles";
const dataTypes = ["street", "satellite", "administrative", "topographic", "land_use", "hydrology", "other"] as const;
type DataType = (typeof dataTypes)[number];
const dataTypeLabels: Record<DataType, TranslationKey> = {
  street: "datasets.type.street",
  satellite: "datasets.type.satellite",
  administrative: "datasets.type.administrative",
  topographic: "datasets.type.topographic",
  land_use: "datasets.type.land_use",
  hydrology: "datasets.type.hydrology",
  other: "datasets.type.other",
};
const statusLabels: Record<string, TranslationKey> = {
  uploaded: "datasets.status.uploaded",
  rejected: "datasets.status.rejected",
  archived: "datasets.status.archived",
};

type RawUpload = {
  id: string;
  name: string;
  dataType: string;
  fileName: string;
  format: string;
  byteSize: number;
  status: string;
  createdAt: string;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSourceFormat(format: string): string {
  const labels: Record<string, string> = {
    osm_pbf: "OSM PBF",
    geotiff: "GeoTIFF",
    geopackage: "GeoPackage",
    shapefile_zip: "Shapefile",
    mbtiles: "MBTiles",
  };
  return labels[format] ?? format;
}

function suggestedName(fileName: string): string {
  return fileName.replace(/\.(osm\.pbf|tiff?|gpkg|zip|mbtiles)$/i, "");
}

export function DatasetsPage() {
  const { t } = useI18n();
  const { accessToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dataName, setDataName] = useState("");
  const [dataType, setDataType] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState<"success" | "error" | null>(null);
  const [items, setItems] = useState<RawUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadUploads = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch("/api/geodata/v1/uploads?limit=100", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error("Could not load source data");
      const body = (await response.json()) as { items?: RawUpload[] };
      setItems(body.items ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadUploads();
  }, [loadUploads]);

  const openUploadPanel = () => {
    setSelectedFile(null);
    setDataName("");
    setDataType("");
    setUploadProgress(0);
    setUploadMessage(null);
    setUploadPanelOpen(true);
  };

  const startUpload = () => {
    if (!selectedFile || !dataName.trim() || !dataType || !accessToken || uploading) return;
    const file = selectedFile;
    setUploading(true);
    setUploadProgress(0);
    setUploadMessage(null);
    const params = new URLSearchParams({ filename: file.name, name: dataName.trim(), dataType });
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/geodata/v1/uploads?${params.toString()}`);
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
        setDataName("");
        setDataType("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        void loadUploads();
      } else {
        setUploadMessage("error");
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      setUploadMessage("error");
    };
    xhr.send(file);
  };

  const dataTypeLabel = (value: string) => t(dataTypeLabels[value as DataType] ?? "datasets.type.other");

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { sm: "flex-end" } }}>
        <Box>
          <Typography variant="h4" sx={{ fontSize: { xs: 24, sm: 27 }, fontWeight: 700, letterSpacing: "-0.02em" }}>
            {t("datasets.title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontSize: "0.9375rem" }}>
            {t("datasets.description")}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<UploadCloud size={17} />} onClick={openUploadPanel}>
          {t("datasets.new")}
        </Button>
      </Stack>

      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
        <Chip icon={<ShieldCheck size={14} color="#0d9488" />} label={t("datasets.immutable")} size="small" variant="outlined" sx={{ fontWeight: 650, borderColor: "divider" }} />
        <Chip icon={<FileUp size={14} color="#0d9488" />} label={t("datasets.audited")} size="small" variant="outlined" sx={{ fontWeight: 650, borderColor: "divider" }} />
      </Stack>

      {loading ? (
        <Paper variant="outlined" sx={{ py: 7, display: "grid", placeItems: "center" }}>
          <CircularProgress size={28} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{t("datasets.loading")}</Typography>
        </Paper>
      ) : loadError ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void loadUploads()}>{t("datasets.retry")}</Button>}>
          {t("datasets.loadFailed")}
        </Alert>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ py: 7, px: 3, textAlign: "center", display: "grid", placeItems: "center" }}>
          <Box sx={{ maxWidth: 460 }}>
            <Box sx={{ width: 56, height: 56, borderRadius: 3, bgcolor: "action.hover", color: "text.secondary", display: "grid", placeItems: "center", mx: "auto", mb: 2 }}><Database size={28} /></Box>
            <Typography variant="h6" sx={{ fontSize: "1.15rem", fontWeight: 700 }}>{t("datasets.empty")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, mb: 2.5, lineHeight: 1.6 }}>{t("datasets.emptyDescription")}</Typography>
            <Button variant="contained" startIcon={<UploadCloud size={16} />} onClick={openUploadPanel}>{t("datasets.new")}</Button>
          </Box>
        </Paper>
      ) : (
        <Paper variant="outlined">
          <Box sx={{ px: 2.5, py: 2, borderBottom: 1, borderColor: "divider" }}>
            <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 750 }}>{t("datasets.listTitle")}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{t("datasets.listDescription")}</Typography>
          </Box>
          <TableContainer>
            <Table size="small" aria-label={t("datasets.listTitle")}>
              <TableHead><TableRow>
                <TableCell>{t("datasets.columnName")}</TableCell>
                <TableCell>{t("datasets.columnType")}</TableCell>
                <TableCell>{t("datasets.columnFormat")}</TableCell>
                <TableCell align="right">{t("datasets.columnSize")}</TableCell>
                <TableCell>{t("datasets.columnUploadedAt")}</TableCell>
                <TableCell>{t("datasets.columnStatus")}</TableCell>
              </TableRow></TableHead>
              <TableBody>{items.map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell><Typography sx={{ fontWeight: 650 }}>{item.name}</Typography><Typography variant="caption" color="text.secondary">{item.fileName}</Typography></TableCell>
                  <TableCell>{dataTypeLabel(item.dataType)}</TableCell>
                  <TableCell>{formatSourceFormat(item.format)}</TableCell>
                  <TableCell align="right">{formatFileSize(item.byteSize)}</TableCell>
                  <TableCell>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</TableCell>
                  <TableCell><Chip size="small" color="success" variant="outlined" label={t(statusLabels[item.status] ?? "datasets.status.uploaded")} /></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <Dialog open={uploadPanelOpen} onClose={() => !uploading && setUploadPanelOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>{t("datasets.uploadTitle")}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>{t("datasets.uploadDescription")}</Typography>
            <TextField label={t("datasets.dataName")} value={dataName} onChange={(event) => setDataName(event.target.value)} required fullWidth slotProps={{ htmlInput: { maxLength: 200 } }} />
            <TextField select label={t("datasets.dataType")} value={dataType} onChange={(event) => setDataType(event.target.value)} required fullWidth>
              <MenuItem value="" disabled>{t("datasets.dataTypePlaceholder")}</MenuItem>
              {dataTypes.map((value) => <MenuItem key={value} value={value}>{dataTypeLabel(value)}</MenuItem>)}
            </TextField>
            <Paper component="button" type="button" variant="outlined" onClick={() => fileInputRef.current?.click()} sx={{ width: "100%", p: 3, borderStyle: "dashed", bgcolor: "background.default", color: "text.primary", cursor: "pointer", "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" } }}>
              <UploadCloud size={36} color="#d32f2f" />
              <Typography component="span" sx={{ display: "block", mt: 1.25, fontWeight: 700 }}>{selectedFile ? selectedFile.name : t("datasets.chooseFile")}</Typography>
              <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>{selectedFile ? `${formatFileSize(selectedFile.size)} · ${selectedFile.type || t("datasets.unknownFileType")}` : t("datasets.supportedFormats")}</Typography>
            </Paper>
            <input ref={fileInputRef} type="file" accept={acceptedFileTypes} hidden onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setSelectedFile(file);
              if (file && !dataName.trim()) setDataName(suggestedName(file.name));
            }} />
            {uploading && <Box><LinearProgress variant="determinate" value={uploadProgress} /><Typography variant="caption" color="text.secondary">{t("datasets.uploading", { progress: uploadProgress })}</Typography></Box>}
            {uploadMessage === "success" && <Alert severity="success">{t("datasets.uploadSucceeded")}</Alert>}
            {uploadMessage === "error" && <Alert severity="error">{t("datasets.uploadFailed")}</Alert>}
            {!accessToken && <Alert severity="warning">{t("datasets.uploadApiRequired")}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setUploadPanelOpen(false)} disabled={uploading}>{t("common.close")}</Button>
          <Button variant="contained" onClick={startUpload} disabled={!selectedFile || !dataName.trim() || !dataType || !accessToken || uploading} startIcon={<UploadCloud size={16} />}>{t("datasets.startUpload")}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
