import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, IconButton, InputLabel, LinearProgress, MenuItem, Paper, Select, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
  Tooltip,
} from "@mui/material";
import { CheckCircle2, Clock3, Play, RefreshCw, Square, Trash2, Workflow, XCircle } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n, type TranslationKey } from "../i18n";

type RawUpload = { id: string; name: string; fileName: string; format: string; status: string };
type ConversionJob = {
  id: string; rawUploadId: string; sourceName: string; sourceFileName: string; sourceFormat: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  minZoom: number; maxZoom: number; layerName?: string; progress: number; currentStep: string;
  createdAt: string;
};
type JobAction = { kind: "cancel" | "delete"; job: ConversionJob };

const sourceStatusLabels: Record<string, TranslationKey> = {
  uploaded: "datasets.status.uploaded", converting: "datasets.status.converting",
  converted: "datasets.status.converted", failed: "datasets.status.failed",
};
const jobStatusLabels: Record<ConversionJob["status"], TranslationKey> = {
  queued: "pipeline.status.queued", running: "pipeline.status.running", succeeded: "pipeline.status.succeeded",
  failed: "pipeline.status.failed", canceled: "pipeline.status.canceled",
};
const jobStepLabels: Record<string, TranslationKey> = {
  queued: "pipeline.step.queued", downloading: "pipeline.step.downloading", converting: "pipeline.step.converting",
  publishing: "pipeline.step.publishing", succeeded: "pipeline.step.succeeded", failed: "pipeline.step.failed", canceled: "pipeline.step.canceled",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function formatName(format: string): string {
  return ({ osm_pbf: "OSM PBF", geotiff: "GeoTIFF", geopackage: "GeoPackage", shapefile_zip: "Shapefile", mbtiles: "MBTiles" } as Record<string, string>)[format] ?? format;
}

export function PipelinePage() {
  const { t } = useI18n();
  const { accessToken } = useAuth();
  const [sources, setSources] = useState<RawUpload[]>([]);
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sourceID, setSourceID] = useState("");
  const [minZoom, setMinZoom] = useState("0");
  const [maxZoom, setMaxZoom] = useState("14");
  const [layerName, setLayerName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(false);
  const [pendingAction, setPendingAction] = useState<JobAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(false);

  const readySources = useMemo(() => sources.filter((source) => ["uploaded", "failed", "converted"].includes(source.status)), [sources]);
  const loadData = useCallback(async () => {
    if (!accessToken) { setLoading(false); return; }
    setLoadError(false);
    try {
      const headers = { Authorization: `Bearer ${accessToken}` };
      const [sourceResponse, jobResponse] = await Promise.all([
        fetch("/api/geodata/v1/uploads?limit=100", { headers }),
        fetch("/api/geodata/v1/jobs?limit=100", { headers }),
      ]);
      if (!sourceResponse.ok || !jobResponse.ok) throw new Error("Could not load conversion data");
      const sourceBody = await sourceResponse.json() as { items?: RawUpload[] };
      const jobBody = await jobResponse.json() as { items?: ConversionJob[] };
      setSources(sourceBody.items ?? []);
      setJobs(jobBody.items ?? []);
    } catch { setLoadError(true); } finally { setLoading(false); }
  }, [accessToken]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => {
    const timer = window.setInterval(() => void loadData(), 10_000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  const openCreateDialog = () => {
    const firstSource = readySources[0];
    if (!firstSource) return;
    setSourceID(firstSource.id); setMinZoom("0"); setMaxZoom("14"); setLayerName(""); setCreateError(false); setDialogOpen(true);
  };
  const createJob = async () => {
    const min = Number(minZoom); const max = Number(maxZoom);
    if (!accessToken || !sourceID || !Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 24 || min > max) { setCreateError(true); return; }
    setCreating(true); setCreateError(false);
    try {
      const response = await fetch("/api/geodata/v1/jobs", {
        method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ rawUploadId: sourceID, minZoom: min, maxZoom: max, layerName: layerName.trim() }),
      });
      if (!response.ok) throw new Error("Could not queue conversion");
      setDialogOpen(false); await loadData();
    } catch { setCreateError(true); } finally { setCreating(false); }
  };
  const performAction = async () => {
    if (!accessToken || !pendingAction) return;
    setActionBusy(true); setActionError(false);
    try {
      const { kind, job } = pendingAction;
      const response = await fetch(kind === "cancel" ? `/api/geodata/v1/jobs/${job.id}/cancel` : `/api/geodata/v1/jobs/${job.id}`, {
        method: kind === "cancel" ? "POST" : "DELETE", headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error("Could not update conversion task");
      setPendingAction(null); await loadData();
    } catch { setActionError(true); } finally { setActionBusy(false); }
  };

  const counts = {
    queued: jobs.filter((job) => job.status === "queued").length,
    running: jobs.filter((job) => job.status === "running").length,
    succeeded: jobs.filter((job) => job.status === "succeeded").length,
    failed: jobs.filter((job) => job.status === "failed").length,
  };
  return <Stack spacing={3}>
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { sm: "flex-end" } }}>
      <Box><Typography variant="h4" sx={{ fontSize: { xs: 24, sm: 27 }, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("nav.pipeline")}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{t("pipeline.description")}</Typography></Box>
      <Stack direction="row" spacing={1}><Button variant="outlined" startIcon={<RefreshCw size={16} />} onClick={() => void loadData()} disabled={loading}>{t("pipeline.refresh")}</Button><Button variant="contained" startIcon={<Play size={16} />} onClick={openCreateDialog} disabled={readySources.length === 0 || !accessToken}>{t("pipeline.create")}</Button></Stack>
    </Stack>
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 2 }}>
      {([ ["queued", counts.queued], ["running", counts.running], ["succeeded", counts.succeeded], ["failed", counts.failed] ] as const).map(([status, count]) => <Paper key={status} variant="outlined" sx={{ p: 2 }}><Typography variant="caption" color="text.secondary">{t(jobStatusLabels[status])}</Typography><Typography sx={{ fontSize: "1.5rem", fontWeight: 750, mt: 0.5 }}>{count}</Typography></Paper>)}
    </Box>
    {loadError && <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void loadData()}>{t("datasets.retry")}</Button>}>{t("pipeline.loadFailed")}</Alert>}
    {!loadError && readySources.length === 0 && !loading && <Alert severity="info">{t("pipeline.noReadySource")}</Alert>}
    <TableContainer component={Paper} variant="outlined"><Table size="small" aria-label={t("nav.pipeline")}><TableHead><TableRow><TableCell>{t("pipeline.source")}</TableCell><TableCell>{t("pipeline.output")}</TableCell><TableCell>{t("pipeline.progress")}</TableCell><TableCell>{t("pipeline.time")}</TableCell><TableCell>{t("pipeline.status")}</TableCell></TableRow></TableHead><TableBody>
      {jobs.length === 0 ? <TableRow><TableCell colSpan={5} sx={{ py: 5, textAlign: "center" }}><Typography color="text.secondary">{t("pipeline.empty")}</Typography></TableCell></TableRow> : jobs.map((job) => <TableRow key={job.id} hover>
        <TableCell><Typography sx={{ fontWeight: 650 }}>{job.sourceName}</Typography><Typography variant="caption" color="text.secondary">{job.sourceFileName} · {formatName(job.sourceFormat)}</Typography></TableCell>
        <TableCell><Typography variant="body2">MBTiles</Typography><Typography variant="caption" color="text.secondary">{t("pipeline.zoomRange", { min: job.minZoom, max: job.maxZoom })}</Typography></TableCell>
        <TableCell sx={{ minWidth: 180 }}><Stack spacing={0.6}><LinearProgress variant="determinate" value={job.progress} color={job.status === "failed" ? "error" : job.status === "succeeded" ? "success" : "primary"} /><Typography variant="caption" color="text.secondary">{t(jobStepLabels[job.currentStep] ?? "pipeline.step.queued")} · {job.progress}%</Typography></Stack></TableCell>
        <TableCell><Typography variant="caption">{formatDate(job.createdAt)}</Typography></TableCell>
        <TableCell><Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}><Chip size="small" color={job.status === "failed" ? "error" : job.status === "succeeded" ? "success" : job.status === "running" ? "primary" : "default"} icon={job.status === "succeeded" ? <CheckCircle2 size={13} /> : job.status === "failed" ? <XCircle size={13} /> : <Clock3 size={13} />} label={t(jobStatusLabels[job.status])} />{["queued", "running"].includes(job.status) ? <Tooltip title={t("pipeline.stop")}><IconButton size="small" color="error" onClick={() => { setActionError(false); setPendingAction({ kind: "cancel", job }); }} aria-label={t("pipeline.stop")}><Square size={16} /></IconButton></Tooltip> : <Tooltip title={t("pipeline.delete")}><IconButton size="small" color="error" onClick={() => { setActionError(false); setPendingAction({ kind: "delete", job }); }} aria-label={t("pipeline.delete")}><Trash2 size={16} /></IconButton></Tooltip>}</Stack></TableCell>
      </TableRow>)}
    </TableBody></Table></TableContainer>
    <Dialog open={dialogOpen} onClose={() => !creating && setDialogOpen(false)} maxWidth="sm" fullWidth><DialogTitle sx={{ fontWeight: 750 }}>{t("pipeline.create")}</DialogTitle><DialogContent dividers><Stack spacing={2.5}>
      <Alert severity="info" icon={<Workflow size={18} />}>{t("pipeline.defaultSchema")}</Alert>
      <FormControl fullWidth><InputLabel>{t("pipeline.sourceData")}</InputLabel><Select value={sourceID} label={t("pipeline.sourceData")} onChange={(event) => setSourceID(event.target.value)}>{readySources.map((source) => <MenuItem key={source.id} value={source.id}>{source.name} — {source.fileName} ({t(sourceStatusLabels[source.status] ?? "datasets.status.uploaded")})</MenuItem>)}</Select></FormControl>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}><TextField fullWidth type="number" label={t("pipeline.minZoom")} value={minZoom} onChange={(event) => setMinZoom(event.target.value)} slotProps={{ htmlInput: { min: 0, max: 24 } }} /><TextField fullWidth type="number" label={t("pipeline.maxZoom")} value={maxZoom} onChange={(event) => setMaxZoom(event.target.value)} slotProps={{ htmlInput: { min: 0, max: 24 } }} /></Stack>
      <TextField fullWidth label={t("pipeline.layerName")} value={layerName} onChange={(event) => setLayerName(event.target.value)} slotProps={{ htmlInput: { maxLength: 120 } }} helperText={t("pipeline.layerNameHelp")} />
      {createError && <Alert severity="error">{t("pipeline.createFailed")}</Alert>}
    </Stack></DialogContent><DialogActions sx={{ p: 2 }}><Button onClick={() => setDialogOpen(false)} disabled={creating}>{t("pipeline.cancelDialog")}</Button><Button variant="contained" startIcon={<Play size={16} />} onClick={() => void createJob()} disabled={creating || !sourceID}>{t("pipeline.start")}</Button></DialogActions></Dialog>
    <Dialog open={pendingAction !== null} onClose={() => !actionBusy && setPendingAction(null)} maxWidth="xs" fullWidth><DialogTitle sx={{ fontWeight: 750 }}>{pendingAction?.kind === "cancel" ? t("pipeline.stopTitle") : t("pipeline.deleteTitle")}</DialogTitle><DialogContent dividers><Stack spacing={2}><Typography>{pendingAction?.kind === "cancel" ? t("pipeline.stopDescription", { name: pendingAction.job.sourceName }) : t("pipeline.deleteDescription", { name: pendingAction?.job.sourceName ?? "" })}</Typography>{pendingAction?.kind === "cancel" && <Alert severity="warning">{t("pipeline.stopWarning")}</Alert>}{actionError && <Alert severity="error">{t("pipeline.actionFailed")}</Alert>}</Stack></DialogContent><DialogActions sx={{ p: 2 }}><Button onClick={() => setPendingAction(null)} disabled={actionBusy}>{t("pipeline.cancelDialog")}</Button><Button color="error" variant="contained" onClick={() => void performAction()} disabled={actionBusy}>{pendingAction?.kind === "cancel" ? t("pipeline.stop") : t("pipeline.delete")}</Button></DialogActions></Dialog>
  </Stack>;
}
