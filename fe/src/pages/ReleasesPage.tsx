import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
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
import { useAuth } from "../auth";

type Artifact = {
  id: string;
  sourceName: string;
  outputFormat: "mbtiles";
  minZoom: number;
  maxZoom: number;
};

type Release = {
  id: string;
  name: string;
  slug: string;
  visibility: string;
  status: "draft" | "publishing" | "published" | "failed" | "archived";
};

const releaseStatus: Record<Release["status"], { label: string; color: ChipProps["color"] }> = {
  draft: { label: "Bản nháp", color: "default" },
  publishing: { label: "Đang xuất bản", color: "info" },
  published: { label: "Đã xuất bản", color: "success" },
  failed: { label: "Xuất bản lỗi", color: "error" },
  archived: { label: "Đã thu hồi", color: "warning" },
};

export function ReleasesPage() {
  const { accessToken } = useAuth();
  const [releases, setReleases] = useState<Release[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Release | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [artifactID, setArtifactID] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    if (!accessToken) return;
    try {
      const headers = { Authorization: `Bearer ${accessToken}` };
      const [releaseResponse, artifactResponse] = await Promise.all([
        fetch("/api/geodata/v1/releases", { headers }),
        fetch("/api/geodata/v1/artifacts", { headers }),
      ]);
      if (!releaseResponse.ok) throw new Error("Không thể tải danh sách bản phát hành.");
      if (!artifactResponse.ok) throw new Error("Không thể tải dữ liệu đầu ra MBTiles.");
      setReleases((await releaseResponse.json()).items ?? []);
      setArtifacts((await artifactResponse.json()).items ?? []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải bản phát hành.");
    }
  };

  useEffect(() => { void load(); }, [accessToken]);

  const hasPublishingRelease = releases.some((release) => release.status === "publishing");
  useEffect(() => {
    if (!hasPublishingRelease) return;
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [accessToken, hasPublishingRelease]);

  const request = async (path: string, options: RequestInit, message: string) => {
    if (!accessToken) return false;
    try {
      const response = await fetch(path, {
        ...options,
        headers: { Authorization: `Bearer ${accessToken}`, ...options.headers },
      });
      if (!response.ok) throw new Error(message);
      await load();
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : message);
      return false;
    }
  };

  const create = async () => {
    const created = await request("/api/geodata/v1/releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, slug, visibility: "authenticated", artifactIds: [artifactID] }),
    }, "Không thể tạo bản nháp. Kiểm tra mã release và dữ liệu MBTiles đã chọn.");
    if (created) setCreateOpen(false);
  };

  const publish = (id: string) => request(
    `/api/geodata/v1/releases/${id}/publish`,
    { method: "POST" },
    "Không thể đưa bản nháp vào hàng đợi xuất bản.",
  );

  const unpublish = (id: string) => request(
    `/api/geodata/v1/releases/${id}/unpublish`,
    { method: "POST" },
    "Không thể thu hồi bản phát hành.",
  );

  const remove = async () => {
    if (!deleteTarget) return;
    const deleted = await request(
      `/api/geodata/v1/releases/${deleteTarget.id}`,
      { method: "DELETE" },
      "Chỉ có thể xóa bản nháp, release lỗi hoặc release đã thu hồi.",
    );
    if (deleted) setDeleteTarget(null);
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
        <Typography variant="h4" sx={{ fontWeight: 750 }}>Bản phát hành</Typography>
        <Button variant="contained" disabled={!artifacts.length} onClick={() => {
          setArtifactID(artifacts[0]?.id ?? "");
          setCreateOpen(true);
        }}>
          Tạo release
        </Button>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}

      <Paper>
        <Table>
          <TableHead><TableRow>
            <TableCell>Tên</TableCell>
            <TableCell>Phạm vi</TableCell>
            <TableCell>Trạng thái</TableCell>
            <TableCell align="right">Hành động</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {!releases.length && <TableRow><TableCell colSpan={4} align="center">Chưa có bản phát hành nào.</TableCell></TableRow>}
            {releases.map((release) => {
              const status = releaseStatus[release.status] ?? { label: release.status, color: "default" as const };
              return <TableRow key={release.id}>
                <TableCell>
                  {release.name}
                  <Typography variant="caption" sx={{ display: "block" }}>{release.slug}</Typography>
                </TableCell>
                <TableCell>{release.visibility}</TableCell>
                <TableCell><Chip size="small" label={status.label} color={status.color} variant={release.status === "draft" ? "outlined" : "filled"} /></TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                    {release.status === "draft" && <Button size="small" onClick={() => void publish(release.id)}>Xuất bản</Button>}
                    {release.status === "published" && <Button size="small" color="warning" onClick={() => void unpublish(release.id)}>Thu hồi</Button>}
                    {(release.status === "draft" || release.status === "failed" || release.status === "archived") && <Button size="small" color="error" onClick={() => setDeleteTarget(release)}>Xóa</Button>}
                  </Stack>
                </TableCell>
              </TableRow>;
            })}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogTitle>Tạo bản nháp</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Tên" value={name} onChange={(event) => {
            setName(event.target.value);
            setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
          }} />
          <TextField label="Mã" value={slug} onChange={(event) => setSlug(event.target.value)} />
          <Select aria-label="Dữ liệu đầu ra MBTiles" value={artifactID} onChange={(event) => setArtifactID(event.target.value)}>
            {artifacts.map((artifact) => <MenuItem key={artifact.id} value={artifact.id}>
              {artifact.sourceName}.mbtiles — MBTiles (z{artifact.minZoom}–{artifact.maxZoom})
            </MenuItem>)}
          </Select>
          <Typography variant="caption" color="text.secondary">Chỉ dữ liệu đầu ra MBTiles đã chuyển đổi thành công mới xuất hiện ở đây.</Typography>
        </Stack></DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Hủy</Button>
          <Button onClick={() => void create()} disabled={!name || !slug || !artifactID}>Tạo</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Xóa bản phát hành?</DialogTitle>
        <DialogContent>
          <Typography>Bản phát hành “{deleteTarget?.name}” sẽ bị xóa khỏi catalog và không thể khôi phục.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Hủy</Button>
          <Button color="error" variant="contained" onClick={() => void remove()}>Xóa</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
