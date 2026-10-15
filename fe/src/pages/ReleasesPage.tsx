import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import type { ChipProps } from "@mui/material";
import { Eye, Plus, Tag } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { ReleasePreviewDialog } from "../components/ReleasePreviewDialog";

type Artifact = {
  id: string;
  sourceName: string;
  outputFormat: "mbtiles";
  cacheStatus: "pending" | "warming" | "ready" | "failed";
  minZoom: number;
  maxZoom: number;
};
type ReleaseStatus = "draft" | "publishing" | "published" | "failed" | "archived";
type Release = {
  id: string;
  name: string;
  mapCode: string;
  version: string;
  slug: string;
  description: string;
  releaseNotes: string;
  status: ReleaseStatus;
  createdAt: string;
  updatedAt: string;
  artifactIds: string[];
};

const apiRoot = "/api/geodata/v1";

const statusColor: Record<ReleaseStatus, ChipProps["color"]> = {
  draft: "default",
  publishing: "info",
  published: "success",
  failed: "error",
  archived: "warning",
};

export function ReleasesPage() {
  const { accessToken } = useAuth();
  const { t } = useI18n();
  const [releases, setReleases] = useState<Release[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Release | null>(null);
  const [previewRelease, setPreviewRelease] = useState<Release | null>(null);
  const [name, setName] = useState("");
  const [mapCode, setMapCode] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [description, setDescription] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [artifactIDs, setArtifactIDs] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!accessToken) return;
    try {
      const headers = { Authorization: `Bearer ${accessToken}` };
      const [releaseResponse, artifactResponse] = await Promise.all([
        fetch(`${apiRoot}/releases`, { headers }),
        fetch(`${apiRoot}/artifacts`, { headers }),
      ]);
      if (!releaseResponse.ok || !artifactResponse.ok) throw new Error(t("release.errorLoad"));
      setReleases(((await releaseResponse.json()) as { items?: Release[] }).items ?? []);
      setArtifacts(((await artifactResponse.json()) as { items?: Artifact[] }).items ?? []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("release.errorLoad"));
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken]);
  const hasPublishingRelease = releases.some((release) => release.status === "publishing");
  const readyArtifacts = artifacts.filter((artifact) => artifact.cacheStatus === "ready");
  const preparingArtifacts = artifacts.filter(
    (artifact) => artifact.cacheStatus === "pending" || artifact.cacheStatus === "warming"
  );
  const failedArtifacts = artifacts.filter((artifact) => artifact.cacheStatus === "failed");
  useEffect(() => {
    // A conversion completes before its MBTiles file is registered in
    // TileServer. Keep the release page current through that short hand-off,
    // rather than leaving a user with a stale empty list.
    if (!hasPublishingRelease && !preparingArtifacts.length) return;
    const timer = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [accessToken, hasPublishingRelease, preparingArtifacts.length]);

  const maps = useMemo(() => {
    const result = new Map<string, Release>();
    for (const release of releases) {
      if (!result.has(release.mapCode)) result.set(release.mapCode, release);
    }
    return [...result.values()];
  }, [releases]);

  const request = async (path: string, options: RequestInit, message: string) => {
    if (!accessToken) return false;
    setSaving(true);
    try {
      const response = await fetch(path, {
        ...options,
        headers: { Authorization: `Bearer ${accessToken}`, ...options.headers },
      });
      if (!response.ok) {
        const detail = (await response.text()).trim();
        throw new Error(detail || message);
      }
      await load();
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const startDraft = () => {
    setName("");
    setMapCode("");
    setVersion("1.0.0");
    setDescription("");
    setReleaseNotes("");
    setArtifactIDs(readyArtifacts[0] ? [readyArtifacts[0].id] : []);
    setError("");
    setCreateOpen(true);
  };
  const selectMap = (value: string) => {
    setMapCode(value);
    if (!value) {
      setName("");
      setVersion("1.0.0");
      return;
    }
    const selected = maps.find((map) => map.mapCode === value);
    if (selected) setName(selected.name);
    setVersion(
      nextPatch(
        releases.filter((release) => release.mapCode === value).map((release) => release.version)
      )
    );
  };
  const create = async () => {
    const created = await request(
      `${apiRoot}/releases`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          mapCode,
          version,
          description: description.trim(),
          releaseNotes: releaseNotes.trim(),
          artifactIds: artifactIDs,
        }),
      },
      t("release.errorCreate")
    );
    if (created) setCreateOpen(false);
  };
  const publish = (id: string) =>
    request(`${apiRoot}/releases/${id}/publish`, { method: "POST" }, t("release.errorPublish"));
  const unpublish = (id: string) =>
    request(`${apiRoot}/releases/${id}/unpublish`, { method: "POST" }, t("release.errorUnpublish"));
  const remove = async () => {
    if (!deleteTarget) return;
    const deleted = await request(
      `${apiRoot}/releases/${deleteTarget.id}`,
      { method: "DELETE" },
      t("release.errorDelete")
    );
    if (deleted) setDeleteTarget(null);
  };

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ justifyContent: "space-between", alignItems: { sm: "flex-end" } }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 750 }}>
            {t("release.title")}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Plus size={16} />}
          disabled={!readyArtifacts.length}
          onClick={startDraft}
        >
          {t("release.create")}
        </Button>
      </Stack>
      {!artifacts.length && <Alert severity="info">{t("release.emptyArtifacts")}</Alert>}
      {!!preparingArtifacts.length && (
        <Alert severity="info">
          {t("release.artifactsPreparing", { count: preparingArtifacts.length })}
        </Alert>
      )}
      {!!failedArtifacts.length && (
        <Alert severity="warning">
          {t("release.artifactsNeedAttention", { count: failedArtifacts.length })}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined">
        <Table sx={{ minWidth: 840 }}>
          <TableHead>
            <TableRow>
              <TableCell>{t("release.mapName")}</TableCell>
              <TableCell>{t("release.mapCode")}</TableCell>
              <TableCell>{t("release.version")}</TableCell>
              <TableCell>{t("release.status")}</TableCell>
              <TableCell align="right">{t("release.actions")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!releases.length && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 5 }}>
                  {t("release.empty")}
                </TableCell>
              </TableRow>
            )}
            {releases.map((release) => (
              <TableRow key={release.id} hover>
                <TableCell>
                  <Typography sx={{ fontWeight: 700 }}>{release.name}</Typography>
                  {release.description && (
                    <Typography variant="caption" color="text.secondary">
                      {release.description}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    icon={<Tag size={13} />}
                    label={release.mapCode}
                    size="small"
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={`v${release.version}`}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={statusLabel(release.status, t)}
                    color={statusColor[release.status]}
                    variant={release.status === "draft" ? "outlined" : "filled"}
                  />
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} sx={{ justifyContent: "flex-end" }}>
                    {release.status === "draft" && (
                      <Button size="small" onClick={() => void publish(release.id)}>
                        {t("release.publish")}
                      </Button>
                    )}
                    {release.status === "published" && (
                      <>
                        <Button size="small" startIcon={<Eye size={15} />} onClick={() => setPreviewRelease(release)}>
                          {t("release.preview")}
                        </Button>
                        <Button
                          size="small"
                          color="warning"
                          onClick={() => void unpublish(release.id)}
                        >
                          {t("release.unpublish")}
                        </Button>
                      </>
                    )}
                    {(["draft", "failed", "archived"] as ReleaseStatus[]).includes(
                      release.status
                    ) && (
                      <Button size="small" color="error" onClick={() => setDeleteTarget(release)}>
                        {t("release.delete")}
                      </Button>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Dialog
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>{t("release.create")}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.25} sx={{ pt: 0.5 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t("release.existingMap")}</InputLabel>
              <Select
                value={mapCode}
                label={t("release.existingMap")}
                onChange={(event) => selectMap(event.target.value)}
              >
                <MenuItem value="">
                  <em>{t("release.newMap")}</em>
                </MenuItem>
                {maps.map((map) => (
                  <MenuItem key={map.mapCode} value={map.mapCode}>
                    {map.name} — {map.mapCode}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label={t("release.mapName")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <TextField
              label={t("release.mapCode")}
              value={mapCode}
              placeholder={t("release.mapCodeGenerated")}
              slotProps={{ input: { readOnly: true } }}
              helperText={mapCode ? undefined : t("release.mapCodeGenerated")}
            />
            <TextField
              label={t("release.version")}
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              required
            />
            <TextField
              label={t("release.description")}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              multiline
              minRows={2}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
            <TextField
              label={t("release.notes")}
              value={releaseNotes}
              onChange={(event) => setReleaseNotes(event.target.value)}
              multiline
              minRows={2}
              slotProps={{ htmlInput: { maxLength: 4000 } }}
            />
            <FormControl fullWidth size="small">
              <InputLabel>{t("release.artifacts")}</InputLabel>
              <Select
                multiple
                value={artifactIDs}
                onChange={(event) => {
                  const value = event.target.value;
                  setArtifactIDs(typeof value === "string" ? value.split(",") : value);
                }}
                input={<OutlinedInput label={t("release.artifacts")} />}
                renderValue={(ids) =>
                  ids
                    .map((id) => artifacts.find((artifact) => artifact.id === id)?.sourceName ?? id)
                    .join(", ")
                }
              >
                {readyArtifacts.map((artifact) => (
                  <MenuItem value={artifact.id} key={artifact.id}>
                    <Checkbox checked={artifactIDs.includes(artifact.id)} />
                    <ListItemText
                      primary={`${artifact.sourceName}.mbtiles`}
                      secondary={`MBTiles (z${artifact.minZoom}–${artifact.maxZoom})`}
                    />
                  </MenuItem>
                ))}
              </Select>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75 }}>
                {t("release.artifactHint")}
              </Typography>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setCreateOpen(false)} disabled={saving}>
            {t("release.cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={() => void create()}
            disabled={!name.trim() || !isSemVer(version) || artifactIDs.length === 0 || saving}
          >
            {t("release.create")}
          </Button>
        </DialogActions>
      </Dialog>

      <ReleasePreviewDialog release={previewRelease} accessToken={accessToken} onClose={() => setPreviewRelease(null)} />

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => !saving && setDeleteTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("release.confirmDelete")}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">{t("release.deleteDescription")}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={saving}>
            {t("release.cancel")}
          </Button>
          <Button color="error" variant="contained" onClick={() => void remove()} disabled={saving}>
            {t("release.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function isSemVer(value: string) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
}
function nextPatch(values: string[]) {
  const parsed = values.filter(isSemVer).map((value) => value.split(".").map(Number));
  if (!parsed.length) return "1.0.0";
  parsed.sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]);
  const [major, minor, patch] = parsed[parsed.length - 1];
  return `${major}.${minor}.${patch + 1}`;
}
function statusLabel(
  status: ReleaseStatus,
  t: (
    key:
      | "release.draft"
      | "release.publishing"
      | "release.published"
      | "release.failed"
      | "release.archived"
  ) => string
) {
  return t(`release.${status}`);
}
