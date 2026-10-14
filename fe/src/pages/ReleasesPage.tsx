import { useEffect, useState } from "react";
import {
  Alert,
  Button,
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
  status: string;
};

export function ReleasesPage() {
  const { accessToken } = useAuth();
  const [releases, setReleases] = useState<Release[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [open, setOpen] = useState(false);
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
      setReleases((await releaseResponse.json()).items ?? []);
      if (artifactResponse.ok) setArtifacts((await artifactResponse.json()).items ?? []);
      else throw new Error("Không thể tải dữ liệu đầu ra MBTiles.");
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải bản phát hành.");
    }
  };

  useEffect(() => {
    void load();
  }, [accessToken]);

  const hasPublishingRelease = releases.some((release) => release.status === "publishing");

  useEffect(() => {
    if (!hasPublishingRelease) return;
    const timer = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [accessToken, hasPublishingRelease]);

  const create = async () => {
    if (!accessToken) return;
    try {
      const response = await fetch("/api/geodata/v1/releases", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug, visibility: "authenticated", artifactIds: [artifactID] }),
      });
      if (!response.ok) throw new Error("Không thể tạo bản nháp. Kiểm tra mã release và dữ liệu MBTiles đã chọn.");
      setOpen(false);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Không thể tạo bản nháp.");
    }
  };

  const publish = async (id: string) => {
    if (!accessToken) return;
    try {
      const response = await fetch(`/api/geodata/v1/releases/${id}/publish`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error("Không thể đưa bản nháp vào hàng đợi phát hành.");
      await load();
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "Không thể phát hành bản đồ.");
    }
  };

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
        <Typography variant="h4" sx={{ fontWeight: 750 }}>Bản phát hành</Typography>
        <Button
          variant="contained"
          disabled={!artifacts.length}
          onClick={() => {
            setArtifactID(artifacts[0]?.id ?? "");
            setOpen(true);
          }}
        >
          Tạo release
        </Button>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}

      <Paper>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Tên</TableCell>
              <TableCell>Phạm vi</TableCell>
              <TableCell>Trạng thái</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {!releases.length && <TableRow><TableCell colSpan={4} align="center">Chưa có bản phát hành nào.</TableCell></TableRow>}
            {releases.map((release) => (
              <TableRow key={release.id}>
                <TableCell>
                  {release.name}
                  <Typography variant="caption" sx={{ display: "block" }}>{release.slug}</Typography>
                </TableCell>
                <TableCell>{release.visibility}</TableCell>
                <TableCell>{release.status}</TableCell>
                <TableCell>
                  {release.status === "draft" && (
                    <Button onClick={() => void publish(release.id)}>Xuất bản</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>Tạo bản nháp</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Tên"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""));
              }}
            />
            <TextField label="Mã" value={slug} onChange={(event) => setSlug(event.target.value)} />
            <Select
              aria-label="Dữ liệu đầu ra MBTiles"
              value={artifactID}
              onChange={(event) => setArtifactID(event.target.value)}
            >
              {artifacts.map((artifact) => (
                <MenuItem key={artifact.id} value={artifact.id}>
                  {artifact.sourceName}.mbtiles — MBTiles (z{artifact.minZoom}–{artifact.maxZoom})
                </MenuItem>
              ))}
            </Select>
            <Typography variant="caption" color="text.secondary">
              Chỉ dữ liệu đầu ra MBTiles đã chuyển đổi thành công mới xuất hiện ở đây.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Hủy</Button>
          <Button onClick={() => void create()} disabled={!name || !slug || !artifactID}>Tạo</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
