import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
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
  Typography,
} from "@mui/material";
import { Building2, Globe2, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

type PrincipalType = "user" | "organization";
type AccessMode = "public" | "restricted";
type DirectorySubject = {
  id: string;
  type: PrincipalType;
  name: string;
  organization?: string;
  detail?: string;
};
type Grant = {
  id: string;
  principalType: PrincipalType | "public";
  subjectName?: string;
  organization?: string;
  releaseId: string;
  releaseName: string;
  note?: string;
  status: "active" | "revoked";
  createdAt: string;
};
type Release = { id: string; name: string; status: string };

const apiRoot = "/api/geodata/v1";

export function AccessPage() {
  const { accessToken } = useAuth();
  const { language, t } = useI18n();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"unavailable" | "error" | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [accessMode, setAccessMode] = useState<AccessMode>("restricted");
  const [principalType, setPrincipalType] = useState<PrincipalType>("user");
  const [subjectQuery, setSubjectQuery] = useState("");
  const [subjects, setSubjects] = useState<DirectorySubject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<DirectorySubject | null>(null);
  const [releaseID, setReleaseID] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<Grant | null>(null);

  const headers = useMemo(
    () => (accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined),
    [accessToken]
  );

  const load = async () => {
    if (!headers) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [grantResponse, releaseResponse] = await Promise.all([
        fetch(`${apiRoot}/access/grants`, { headers }),
        fetch(`${apiRoot}/releases`, { headers }),
      ]);
      if (grantResponse.status === 503) {
        setLoadError("unavailable");
        return;
      }
      if (!grantResponse.ok || !releaseResponse.ok) throw new Error("load access grants");
      const grantPayload = (await grantResponse.json()) as { items?: Grant[] };
      const releasePayload = (await releaseResponse.json()) as { items?: Release[] };
      setGrants(grantPayload.items ?? []);
      setReleases(releasePayload.items ?? []);
    } catch {
      setLoadError("error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken]);

  useEffect(() => {
    if (!dialogOpen || accessMode !== "restricted" || !headers) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const parameters = new URLSearchParams({
            type: principalType,
            q: subjectQuery,
            limit: "25",
          });
          const response = await fetch(`${apiRoot}/access/subjects?${parameters}`, { headers });
          if (!response.ok) throw new Error("search directory");
          const payload = (await response.json()) as { items?: DirectorySubject[] };
          setSubjects(payload.items ?? []);
        } catch {
          setSubjects([]);
        }
      })();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [dialogOpen, accessMode, headers, principalType, subjectQuery]);

  const activeUserCount = grants.filter(
    (grant) => grant.status === "active" && grant.principalType === "user"
  ).length;
  const activeOrganizationCount = grants.filter(
    (grant) => grant.status === "active" && grant.principalType === "organization"
  ).length;
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [language]
  );

  const openGrantDialog = () => {
    setAccessMode("restricted");
    setPrincipalType("user");
    setSubjectQuery("");
    setSelectedSubject(null);
    setReleaseID("");
    setNote("");
    setSaveError(false);
    setDialogOpen(true);
  };
  const createGrant = async () => {
    if (!headers || !releaseID || (accessMode === "restricted" && !selectedSubject)) return;
    setSaving(true);
    setSaveError(false);
    try {
      const response = await fetch(`${apiRoot}/access/grants`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          principalType: accessMode === "public" ? "public" : principalType,
          principalId: accessMode === "public" ? "" : selectedSubject?.id,
          releaseId: releaseID,
          scope: "view",
          note: note.trim(),
        }),
      });
      if (!response.ok) throw new Error("create grant");
      setDialogOpen(false);
      await load();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };
  const revoke = async () => {
    if (!headers || !revokeTarget) return;
    setSaving(true);
    setSaveError(false);
    try {
      const response = await fetch(
        `${apiRoot}/access/grants/${encodeURIComponent(revokeTarget.id)}/revoke`,
        { method: "POST", headers }
      );
      if (!response.ok) throw new Error("revoke grant");
      setRevokeTarget(null);
      await load();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
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
            {t("nav.access")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t("access.description")}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Plus size={16} />}
          onClick={openGrantDialog}
          disabled={!accessToken || loading || loadError !== null}
        >
          {t("access.grantNew")}
        </Button>
      </Stack>

      {loadError && (
        <Alert severity={loadError === "unavailable" ? "warning" : "error"}>
          {t(loadError === "unavailable" ? "access.unavailable" : "access.loadError")}
        </Alert>
      )}
      {saveError && (
        <Alert severity="error" onClose={() => setSaveError(false)}>
          {t("access.saveError")}
        </Alert>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 2,
        }}
      >
        <Metric icon={<UserRound size={20} />} label={t("access.user")} value={activeUserCount} />
        <Metric
          icon={<Building2 size={20} />}
          label={t("access.organization")}
          value={activeOrganizationCount}
        />
        <Metric
          icon={<ShieldCheck size={20} />}
          label={t("access.status")}
          value={grants.filter((grant) => grant.status === "active").length}
        />
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table sx={{ minWidth: 650 }}>
          <TableHead>
            <TableRow>
              <TableCell>{t("access.subject")}</TableCell>
              <TableCell>{t("access.department")}</TableCell>
              <TableCell>{t("access.releases")}</TableCell>
              <TableCell>{t("access.status")}</TableCell>
              <TableCell>{t("access.grantedBy")}</TableCell>
              <TableCell align="right">{t("access.actions")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <EmptyRow message={t("access.loading")} />
            ) : grants.length === 0 ? (
              <EmptyRow message={t("access.empty")} />
            ) : (
              grants.map((grant) => (
                <TableRow key={grant.id} hover>
                  <TableCell>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      {grant.principalType === "public" ? (
                        <Globe2 size={16} />
                      ) : grant.principalType === "user" ? (
                        <UserRound size={16} />
                      ) : (
                        <Building2 size={16} />
                      )}
                      <Typography sx={{ fontWeight: 700 }}>
                        {grant.principalType === "public" ? t("access.public") : grant.subjectName || "—"}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {grant.principalType === "public"
                      ? "—"
                      : grant.principalType === "organization"
                      ? grant.subjectName
                      : grant.organization || "—"}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={grant.releaseName}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={grant.status === "active" ? t("access.active") : t("access.revoked")}
                      color={grant.status === "active" ? "success" : "default"}
                      size="small"
                      variant={grant.status === "active" ? "filled" : "outlined"}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {dateFormatter.format(new Date(grant.createdAt))}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    {grant.status === "active" && (
                      <Button
                        size="small"
                        color="error"
                        startIcon={<Trash2 size={14} />}
                        onClick={() => setRevokeTarget(grant)}
                      >
                        {t("access.revoke")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog
        open={dialogOpen}
        onClose={() => !saving && setDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>{t("access.grantTitle")}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5} sx={{ pt: 0.5 }}>
            <Alert severity="info">{t("access.releaseHint")}</Alert>
            <FormControl fullWidth size="small">
              <InputLabel>{t("access.policy")}</InputLabel>
              <Select
                value={accessMode}
                label={t("access.policy")}
                onChange={(event) => {
                  setAccessMode(event.target.value as AccessMode);
                  setSelectedSubject(null);
                  setSubjects([]);
                }}
              >
                <MenuItem value="public">{t("access.public")}</MenuItem>
                <MenuItem value="restricted">{t("access.recipients")}</MenuItem>
              </Select>
            </FormControl>
            {accessMode === "public" ? <Alert severity="info">{t("access.publicHint")}</Alert> : <>
            <FormControl fullWidth size="small">
              <InputLabel>{t("access.type")}</InputLabel>
              <Select
                value={principalType}
                label={t("access.type")}
                onChange={(event) => {
                  setPrincipalType(event.target.value as PrincipalType);
                  setSelectedSubject(null);
                  setSubjects([]);
                }}
              >
                <MenuItem value="user">{t("access.user")}</MenuItem>
                <MenuItem value="organization">{t("access.organization")}</MenuItem>
              </Select>
            </FormControl>
            <Autocomplete
              options={subjects}
              value={selectedSubject}
              onChange={(_, value) => setSelectedSubject(value)}
              onInputChange={(_, value) => setSubjectQuery(value)}
              getOptionLabel={(option) => option.name}
              noOptionsText={t("access.noRecipients")}
              renderOption={(props, option) => (
                <li {...props} key={option.id}>
                  <Stack>
                    <Typography variant="body2">{option.name}</Typography>
                    {option.detail && (
                      <Typography variant="caption" color="text.secondary">
                        {option.detail}
                      </Typography>
                    )}
                  </Stack>
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t("access.recipient")}
                  placeholder={t("access.searchRecipient")}
                />
              )}
            />
            </>}
            <FormControl fullWidth size="small">
              <InputLabel>{t("access.chooseRelease")}</InputLabel>
              <Select
                value={releaseID}
                label={t("access.chooseRelease")}
                onChange={(event) => setReleaseID(event.target.value)}
              >
                <MenuItem value="" disabled>
                  {t("access.chooseRelease")}
                </MenuItem>
                {releases
                  .filter((release) => release.status !== "archived")
                  .map((release) => (
                    <MenuItem value={release.id} key={release.id}>
                      {release.name}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
            <TextField
              value={note}
              onChange={(event) => setNote(event.target.value)}
              label={t("access.note")}
              multiline
              minRows={2}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            {t("access.cancel")}
          </Button>
          <Button
            variant="contained"
            onClick={() => void createGrant()}
            disabled={!releaseID || (accessMode === "restricted" && !selectedSubject) || saving}
          >
            {t("access.grant")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(revokeTarget)}
        onClose={() => !saving && setRevokeTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("access.revokeTitle")}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">{t("access.revokeDescription")}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeTarget(null)} disabled={saving}>
            {t("access.cancel")}
          </Button>
          <Button color="error" variant="contained" onClick={() => void revoke()} disabled={saving}>
            {t("access.revoke")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Box
          sx={{
            p: 1.1,
            borderRadius: 2,
            bgcolor: "primary.light",
            color: "primary.main",
            display: "grid",
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            {value}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={6} sx={{ py: 5, textAlign: "center" }}>
        <Typography color="text.secondary">{message}</Typography>
      </TableCell>
    </TableRow>
  );
}
