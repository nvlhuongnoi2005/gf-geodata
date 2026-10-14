import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  CheckCircle2,
  Clock,
  History,
  KeyRound,
  Lock,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { useI18n } from "../i18n";

export type PrincipalAcl = {
  id: string;
  principalType: "user" | "group";
  principalName: string;
  principalSub: string;
  department?: string;
  grantedReleases: string[];
  scope: "view_only" | "view_and_export";
  grantedBy: string;
  grantedAt: string;
  status: "active" | "revoked";
};

export type AuditLogEntry = {
  id: string;
  timestamp: string;
  actor: string;
  action: "GRANT" | "REVOKE" | "ACCESS_DENIED";
  targetPrincipal: string;
  resource: string;
  details: string;
};

export function AccessPage() {
  const { t } = useI18n();
  const [tabIndex, setTabIndex] = useState(0);
  const [acls] = useState<PrincipalAcl[]>([]);
  const [auditLogs] = useState<AuditLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [openGrantModal, setOpenGrantModal] = useState(false);

  // Form states
  const [formType, setFormType] = useState<"user" | "group">("user");
  const [formName, setFormName] = useState("");
  const [formSub, setFormSub] = useState("");
  const [formDepartment, setFormDepartment] = useState("");
  const [formRelease, setFormRelease] = useState("");
  const [formScope, setFormScope] = useState<"view_only" | "view_and_export">("view_only");
  const [formNote, setFormNote] = useState("");

  const handleGrantAccess = () => {
    setOpenGrantModal(false);
  };

  const handleRevoke = (_id: string) => undefined;

  const filteredAcls = acls.filter((a) => {
    const matchesTab =
      tabIndex === 0
        ? a.principalType === "user"
        : tabIndex === 1
          ? a.principalType === "group"
          : true;
    const matchesSearch =
      a.principalName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.principalSub.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.department && a.department.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesTab && matchesSearch;
  });

  const activeUsersCount = acls.filter(
    (a) => a.principalType === "user" && a.status === "active"
  ).length;
  const activeGroupsCount = acls.filter(
    (a) => a.principalType === "group" && a.status === "active"
  ).length;

  return (
    <Stack spacing={3}>
      {/* Header */}
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
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5, fontSize: "0.9375rem" }}
          >
            Quản lý chính sách xem bản đồ, phân quyền truy cập an toàn cho người dùng và các nhóm
            đơn vị.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.2}>
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            disabled
          >
            Cấp quyền truy cập mới
          </Button>
        </Stack>
      </Stack>

      {/* KPI Cards */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 2,
        }}
      >
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                p: 1.1,
                borderRadius: 2,
                bgcolor: "info.light",
                color: "info.main",
                display: "grid",
              }}
            >
              <UserCheck size={20} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Người dùng đã cấp quyền
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                {activeUsersCount} tài khoản
              </Typography>
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                p: 1.1,
                borderRadius: 2,
                bgcolor: "secondary.light",
                color: "secondary.dark",
                display: "grid",
              }}
            >
              <Users size={20} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Nhóm & Đơn vị
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                {activeGroupsCount} nhóm
              </Typography>
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                p: 1.1,
                borderRadius: 2,
                bgcolor: "success.light",
                color: "success.main",
                display: "grid",
              }}
            >
              <ShieldCheck size={20} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Cơ chế bảo vệ
              </Typography>
              <Typography sx={{ fontSize: "1.25rem", fontWeight: 700 }}>
                Kiểm soát tập trung
              </Typography>
            </Box>
          </Stack>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                p: 1.1,
                borderRadius: 2,
                bgcolor: "action.hover",
                color: "text.secondary",
                display: "grid",
              }}
            >
              <History size={20} />
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Nhật ký kiểm toán
              </Typography>
              <Typography sx={{ fontSize: "1.45rem", fontWeight: 700 }}>
                {auditLogs.length} sự kiện
              </Typography>
            </Box>
          </Stack>
        </Paper>
      </Box>

      {/* Tabs & Search */}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ justifyContent: "space-between", alignItems: { md: "center" } }}
        >
          <Tabs value={tabIndex} onChange={(_, val) => setTabIndex(val)}>
            <Tab label={`Theo Người dùng (${activeUsersCount})`} />
            <Tab label={`Theo Nhóm / Đơn vị (${activeGroupsCount})`} />
            <Tab label="Nhật ký Kiểm toán (Audit Log)" />
          </Tabs>

          {tabIndex !== 2 && (
            <TextField
              size="small"
              placeholder="Tìm theo tên, email, sub, đơn vị..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search size={16} />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ width: { xs: "100%", md: 320 } }}
            />
          )}
        </Stack>
      </Paper>

      {/* Content depending on Tab */}
      {tabIndex === 0 || tabIndex === 1 ? (
        <TableContainer component={Paper} variant="outlined">
          <Table sx={{ minWidth: 800 }}>
            <TableHead>
              <TableRow>
                <TableCell>Đối tượng (Principal & UUID `sub`)</TableCell>
                <TableCell>Đơn vị / Phòng ban</TableCell>
                <TableCell>Map Releases được cấp quyền</TableCell>
                <TableCell>Phạm vi quyền</TableCell>
                <TableCell>Người cấp & Thời điểm</TableCell>
                <TableCell>Trạng thái</TableCell>
                <TableCell align="right">Hành động</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredAcls.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} sx={{ textAlign: "center", py: 5 }}>
                    <Typography color="text.secondary">Chưa có phân quyền nào</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredAcls.map((acl) => (
                  <TableRow key={acl.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {acl.principalName}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: "text.secondary", fontFamily: "monospace" }}
                      >
                        {acl.principalSub}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{acl.department || "--"}</Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
                        {acl.grantedReleases.map((rel, idx) => (
                          <Chip
                            key={idx}
                            label={rel}
                            size="small"
                            color="primary"
                            variant="outlined"
                            sx={{ fontSize: 11 }}
                          />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip
                        icon={<KeyRound size={13} />}
                        label={
                          acl.scope === "view_and_export" ? "Xem & Tải tile" : "Chỉ xem (View only)"
                        }
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ display: "block", fontWeight: 600 }}>
                        {acl.grantedBy}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {acl.grantedAt}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {acl.status === "active" ? (
                        <Chip
                          label="Đang hiệu lực"
                          size="small"
                          color="success"
                          sx={{ fontWeight: 700 }}
                        />
                      ) : (
                        <Chip label="Đã thu hồi" size="small" color="error" variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {acl.status === "active" ? (
                        <Tooltip title="Thu hồi quyền ngay lập tức (FR-36)">
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            startIcon={<Trash2 size={14} />}
                            onClick={() => handleRevoke(acl.id)}
                          >
                            Thu hồi
                          </Button>
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          Không khả dụng
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        /* Tab 2: Audit Logs */
        <TableContainer component={Paper} variant="outlined">
          <Table sx={{ minWidth: 800 }}>
            <TableHead>
              <TableRow>
                <TableCell>Thời gian</TableCell>
                <TableCell>Tác tử thực hiện (Actor)</TableCell>
                <TableCell>Hành động</TableCell>
                <TableCell>Đối tượng tác động</TableCell>
                <TableCell>Tài nguyên</TableCell>
                <TableCell>Chi tiết kiểm toán (Audit detail)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {auditLogs.map((log) => (
                <TableRow key={log.id} hover>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                      {log.timestamp}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {log.actor}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {log.action === "GRANT" && (
                      <Chip
                        label="CẤP QUYỀN"
                        size="small"
                        color="success"
                        sx={{ fontWeight: 800, fontSize: 10 }}
                      />
                    )}
                    {log.action === "REVOKE" && (
                      <Chip
                        label="THU HỒI"
                        size="small"
                        color="error"
                        sx={{ fontWeight: 800, fontSize: 10 }}
                      />
                    )}
                    {log.action === "ACCESS_DENIED" && (
                      <Chip
                        label="TỪ CHỐI 403"
                        size="small"
                        color="warning"
                        sx={{ fontWeight: 800, fontSize: 10 }}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {log.targetPrincipal}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" color="text.secondary">
                      {log.resource}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">{log.details}</Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Grant Access Modal */}
      <Dialog
        open={openGrantModal}
        onClose={() => setOpenGrantModal(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Cấp quyền truy cập Geodata (ACL)</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.5}>
            <Alert severity="info" sx={{ fontSize: 13 }}>
              Quyền xem bản đồ được gắn trực tiếp với định danh `sub` từ `db-auth`. User không có
              quyền sẽ không thể tải tile hoặc style.
            </Alert>

            <FormControl fullWidth size="small">
              <InputLabel>Loại đối tượng</InputLabel>
              <Select
                value={formType}
                label="Loại đối tượng"
                onChange={(e) => setFormType(e.target.value as "user" | "group")}
              >
                <MenuItem value="user">Người dùng cụ thể (User UUID)</MenuItem>
                <MenuItem value="group">Nhóm / Đơn vị tổ chức (Group / Org)</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label={formType === "user" ? "Họ tên người dùng" : "Tên nhóm / Đơn vị"}
              fullWidth
              size="small"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Ví dụ: Hoàng Hải Nam (Kỹ sư dữ liệu)"
            />

            <TextField
              label={
                formType === "user"
                  ? "Mã định danh User sub (db-auth UUID)"
                  : "Mã định danh Group ID"
              }
              fullWidth
              size="small"
              value={formSub}
              onChange={(e) => setFormSub(e.target.value)}
              placeholder="Ví dụ: usr-8a1f-4421-bc39-a9902c"
              helperText="Được trích xuất từ JWT claim sub của auth service WebGIS (FR-32)"
            />

            <TextField
              label="Phòng ban / Đơn vị công tác"
              fullWidth
              size="small"
              value={formDepartment}
              onChange={(e) => setFormDepartment(e.target.value)}
              placeholder="Ví dụ: Trung tâm Vận hành Khai thác Mạng"
            />

            <FormControl fullWidth size="small">
              <InputLabel>Chọn Map Release cần cấp quyền</InputLabel>
              <Select
                value={formRelease}
                label="Chọn Map Release cần cấp quyền"
                onChange={(e) => setFormRelease(e.target.value)}
              >
                <MenuItem value="" disabled>
                  Chưa có Map Release để cấp quyền.
                </MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel>Phạm vi quyền (Scope)</InputLabel>
              <Select
                value={formScope}
                label="Phạm vi quyền (Scope)"
                onChange={(e) => setFormScope(e.target.value as "view_only" | "view_and_export")}
              >
                <MenuItem value="view_only">Chỉ xem bản đồ (Render vector/raster tiles)</MenuItem>
                <MenuItem value="view_and_export">Xem bản đồ & Cho phép tải raw tileset</MenuItem>
              </Select>
            </FormControl>

            <TextField
              label="Lý do cấp quyền (Ghi chú kiểm toán audit)"
              multiline
              rows={2}
              fullWidth
              size="small"
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              placeholder="Ghi chú số quyết định, dự án hoặc yêu cầu công việc..."
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="outlined" onClick={() => setOpenGrantModal(false)}>
            Hủy
          </Button>
          <Button variant="contained" disabled={!formName || !formSub} onClick={handleGrantAccess}>
            Cấp quyền ngay
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
