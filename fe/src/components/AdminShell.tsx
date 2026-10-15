import { useState, type FormEvent, type ReactNode } from "react";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Bell,
  CheckCircle2,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  Gauge,
  HelpCircle,
  Layers3,
  LockKeyhole,
  LogOut,
  Mail,
  MapPinned,
  Menu as MenuIcon,
  Paintbrush,
  Send,
  ShieldCheck,
  Sparkles,
  User,
  Workflow,
} from "lucide-react";
import { useAuth, type LoginFailureReason } from "../auth";
import { useI18n, type TranslationKey } from "../i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeModeSwitcher } from "./AppearanceControls";
import { DashboardPage } from "../pages/DashboardPage";
import { DatasetsPage } from "../pages/DatasetsPage";
import { PipelinePage } from "../pages/PipelinePage";
import { ReleasesPage } from "../pages/ReleasesPage";
import { AccessPage } from "../pages/AccessPage";

const drawerWidth = 278;
type PageKey = "overview" | "datasets" | "pipeline" | "styles" | "releases" | "access";
const mapLoginUrl = import.meta.env.VITE_MAP_LOGIN_URL || "http://webgis.localhost/login";
const mapUrl = import.meta.env.VITE_WEBGIS_MAP_URL || "http://webgis.localhost/map";

const loginErrorKey: Record<LoginFailureReason, TranslationKey> = {
  invalidCredentials: "login.errorInvalid",
  notAdmin: "login.errorNotAdmin",
  connection: "login.errorConnection",
};

const nav = [
  { key: "overview", label: "nav.overview", caption: "nav.overviewCaption", icon: Gauge },
  { key: "datasets", label: "nav.datasets", caption: "nav.datasetsCaption", icon: Database },
  { key: "pipeline", label: "nav.pipeline", caption: "nav.pipelineCaption", icon: Workflow },
  { key: "releases", label: "nav.releases", caption: "nav.releasesCaption", icon: Send },
  { key: "access", label: "nav.access", caption: "nav.accessCaption", icon: ShieldCheck },
  { key: "styles", label: "nav.styles", caption: "nav.stylesCaption", icon: Paintbrush },
] as const;

function BrandMark({ size = 42 }: { size?: number }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        display: "grid",
        placeItems: "center",
        borderRadius: `${Math.round(size * 0.3)}px`,
        bgcolor: "primary.main",
        boxShadow: "0 4px 12px rgba(211, 47, 47, 0.3)",
      }}
    >
      <Layers3 size={Math.round(size * 0.52)} color="#fff" />
    </Box>
  );
}

function Signal({ label }: { label: string }) {
  return (
    <Stack direction="row" spacing={0.8} sx={{ alignItems: "center" }}>
      <Box
        className="status-pulse"
        sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "#14b8a6" }}
      />
      <Typography variant="caption" sx={{ color: "rgba(241, 245, 249, 0.8)", fontWeight: 600 }}>
        {label}
      </Typography>
    </Stack>
  );
}

function LoginMapArtwork() {
  const { t } = useI18n();
  return (
    <Box
      className="login-map-surface"
      sx={{
        display: { xs: "none", md: "flex" },
        minHeight: "100dvh",
        color: "#f8fafc",
        position: "relative",
        overflow: "hidden",
        p: { md: 5, lg: 7 },
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <Stack direction="row" spacing={1.4} sx={{ alignItems: "center", zIndex: 1 }}>
        <BrandMark />
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 18 }}>GeoForge</Typography>
          <Typography variant="caption" sx={{ opacity: 0.75, display: "block" }}>
            Hệ thống Quản trị Bản đồ & Dữ liệu Không gian
          </Typography>
        </Box>
      </Stack>

      <Box sx={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.85 }}>
        <svg viewBox="0 0 800 650" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
          <path
            className="login-route"
            d="M-60 490 C120 290, 200 540, 350 370 S570 260, 870 160"
            fill="none"
            stroke="rgba(20, 184, 166, 0.6)"
            strokeWidth="2.5"
          />
          <path
            d="M-60 180 C140 300, 250 100, 460 250 S690 480, 870 350"
            fill="none"
            stroke="rgba(255, 255, 255, 0.2)"
            strokeWidth="1.5"
          />
        </svg>
      </Box>

      <Box sx={{ position: "relative", maxWidth: 520, zIndex: 1 }}>
        <Chip
          icon={<Sparkles size={14} color="#5eead4" />}
          label={t("brand.geospatialOperations")}
          size="small"
          sx={{ color: "#5eead4", bgcolor: "rgba(20, 184, 166, 0.15)", fontWeight: 700 }}
        />
        <Typography variant="h3" sx={{ mt: 2.5, maxWidth: 480, lineHeight: 1.15, fontWeight: 800 }}>
          {t("login.artworkTitle")}
        </Typography>
        <Typography
          sx={{ mt: 2, color: "rgba(241, 245, 249, 0.75)", lineHeight: 1.75, maxWidth: 460 }}
        >
          {t("login.artworkDescription")}
        </Typography>
      </Box>

      <Stack direction="row" spacing={3} sx={{ position: "relative", zIndex: 1 }}>
        <Signal label={t("brand.offlineReady")} />
        <Signal label="Lưu trữ dữ liệu riêng tư" />
        <Signal label="Xác thực tập trung" />
      </Stack>
    </Box>
  );
}

function SessionGate({ children }: { children: ReactNode }) {
  const { isLoading, login, logout, user } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    const result = await login(email, password);
    setIsSubmitting(false);
    if (!result.ok) setError(loginErrorKey[result.reason]);
  };

  if (isLoading)
    return (
      <Box
        sx={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          bgcolor: "background.default",
        }}
      >
        <CircularProgress aria-label={t("common.loading")} />
      </Box>
    );

  if (!user)
    return (
      <Box
        sx={{
          minHeight: "100dvh",
          display: "grid",
          gridTemplateColumns: { md: "minmax(440px, 1.1fr) minmax(480px, 0.9fr)" },
        }}
      >
        <LoginMapArtwork />
        <Box
          sx={{
            display: "grid",
            placeItems: "center",
            p: { xs: 2.5, sm: 5, md: 6 },
            bgcolor: "background.paper",
          }}
        >
          <Paper
            component="form"
            onSubmit={(event) => void signIn(event)}
            elevation={0}
            sx={{ width: "100%", maxWidth: 420, p: { xs: 0, sm: 1 }, bgcolor: "transparent" }}
          >
            <Stack spacing={3}>
              <Box sx={{ display: { md: "none" } }}>
                <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
                  <BrandMark size={38} />
                  <Typography sx={{ fontWeight: 800, fontSize: 18 }}>GeoForge</Typography>
                </Stack>
              </Box>
              <Box>
                <Typography
                  variant="overline"
                  color="primary"
                  sx={{ fontWeight: 800, letterSpacing: "0.1em" }}
                >
                  {t("login.adminAccess")}
                </Typography>
                <Typography variant="h4" sx={{ mt: 0.25, fontWeight: 800 }}>
                  {t("login.welcome")}
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 1, lineHeight: 1.65 }}>
                  {t("login.description")}
                </Typography>
              </Box>

              <Stack spacing={2}>
                <TextField
                  autoComplete="email"
                  label={t("login.email")}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@vht.com.vn"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <Mail size={18} />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
                <TextField
                  autoComplete="current-password"
                  label={t("login.password")}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <LockKeyhole size={18} />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            size="small"
                            onClick={() => setShowPassword(!showPassword)}
                            edge="end"
                          >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />

                {error && (
                  <Box
                    sx={{
                      px: 2,
                      py: 1.5,
                      borderRadius: 2,
                      bgcolor: "error.light",
                      color: "error.dark",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {t(error)}
                  </Box>
                )}
              </Stack>

              <Button variant="contained" type="submit" size="large" disabled={isSubmitting}>
                {isSubmitting ? t("login.signingIn") : t("login.signIn")}
              </Button>

              <Divider>
                <Typography variant="caption" color="text.secondary">
                  {t("login.or")}
                </Typography>
              </Divider>

              <Button
                component="a"
                href={mapLoginUrl}
                variant="text"
                startIcon={<MapPinned size={17} />}
              >
                {t("login.openWebgisLogin")}
              </Button>

              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: "center", lineHeight: 1.6 }}
              >
                {t("login.adminOnly")}
              </Typography>
            </Stack>
          </Paper>
        </Box>
      </Box>
    );

  if (user.role !== "admin")
    return (
      <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", p: 3 }}>
        <Paper sx={{ maxWidth: 460, p: 4, textAlign: "center" }}>
          <ShieldCheck size={38} color="#d32f2f" style={{ margin: "0 auto" }} />
          <Typography variant="h5" sx={{ mt: 2, fontWeight: 800 }}>
            {t("login.noAccess")}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t("login.noAccessDescription")}
          </Typography>
          <Button sx={{ mt: 2.5 }} variant="outlined" onClick={() => void logout()}>
            {t("login.useDifferentAccount")}
          </Button>
        </Paper>
      </Box>
    );

  return <>{children}</>;
}

export function AdminShell() {
  const [activePage, setActivePage] = useState<PageKey>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const { logout, user } = useAuth();
  const { t } = useI18n();

  // Header popovers
  const [notificationAnchor, setNotificationAnchor] = useState<null | HTMLElement>(null);
  const [userMenuAnchor, setUserMenuAnchor] = useState<null | HTMLElement>(null);

  const active = nav.find((item) => item.key === activePage)!;

  const drawer = (
    <Box
      className="app-drawer"
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        color: "text.primary",
      }}
    >
      <Box sx={{ px: 2.25, pt: 2.5, pb: 2.25 }}>
        <Stack direction="row" spacing={1.2} sx={{ alignItems: "center" }}>
          <BrandMark size={38} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: 16 }}>GeoForge</Typography>
            <Typography variant="caption" color="text.secondary">
              Vận hành dữ liệu bản đồ
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Divider />

      <Typography
        variant="overline"
        sx={{
          px: 2.4,
          pt: 2.5,
          pb: 0.8,
          color: "text.secondary",
          fontWeight: 800,
          letterSpacing: ".12em",
          fontSize: 10,
        }}
      >
        {t("brand.workspace")}
      </Typography>

      <List sx={{ px: 1.15, py: 0 }}>
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <ListItemButton
              key={item.key}
              selected={activePage === item.key}
              onClick={() => {
                setActivePage(item.key);
                setMobileOpen(false);
              }}
              sx={{ mb: 0.45, borderRadius: 2, py: 1.05 }}
            >
              <ListItemIcon sx={{ minWidth: 38 }}>
                <Icon size={19} />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>{t(item.label)}</Typography>
                }
                secondary={
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                    {t(item.caption)}
                  </Typography>
                }
              />
            </ListItemButton>
          );
        })}
      </List>
      <Box sx={{ px: 1.25, pb: 1.25 }}>
        <Button
          fullWidth
          variant="outlined"
          color="inherit"
          startIcon={<LogOut size={16} />}
          onClick={() => void logout()}
        >
          {t("common.logout")}
        </Button>
      </Box>
    </Box>
  );

  return (
    <SessionGate>
      <Box sx={{ display: "flex", minHeight: "100dvh", bgcolor: "background.default" }}>
        {/* Navigation Sidebar Drawer */}
        <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{
              display: { xs: "block", md: "none" },
              "& .MuiDrawer-paper": { width: drawerWidth },
            }}
          >
            {drawer}
          </Drawer>
          <Drawer
            variant="permanent"
            open
            sx={{
              display: { xs: "none", md: "block" },
              "& .MuiDrawer-paper": { width: drawerWidth, boxSizing: "border-box", border: 0 },
            }}
          >
            {drawer}
          </Drawer>
        </Box>

        {/* Main Content Area */}
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
          <AppBar
            position="sticky"
            elevation={3}
            sx={{
              backgroundColor: "#d32f2f",
              color: "#fff",
              borderBottom: "none",
            }}
          >
            <Toolbar
              sx={{
                minHeight: "70px !important",
                justifyContent: "space-between",
                px: { xs: 2, sm: 3.5 },
              }}
            >
              <Stack direction="row" spacing={1.3} sx={{ alignItems: "center" }}>
                <IconButton
                  aria-label={t("common.openNavigation")}
                  onClick={() => setMobileOpen(true)}
                  sx={{ display: { md: "none" }, color: "rgba(255,255,255,0.9)" }}
                >
                  <MenuIcon />
                </IconButton>
                <Box>
                  <Typography
                    variant="caption"
                    sx={{ display: "block", lineHeight: 1.1, color: "rgba(255,255,255,0.65)" }}
                  >
                    {t("brand.workspace")}
                  </Typography>
                  <Typography sx={{ fontWeight: 800, fontSize: 16, color: "#fff" }}>
                    {t(active.label)}
                  </Typography>
                </Box>
              </Stack>

              <Stack direction="row" spacing={1.2} sx={{ alignItems: "center" }}>
                <LanguageSwitcher />
                <ThemeModeSwitcher />

                {/* Notifications Bell */}
                <Tooltip title="Thông báo hệ thống">
                  <IconButton
                    size="small"
                    onClick={(e) => setNotificationAnchor(e.currentTarget)}
                    sx={{
                      border: "1px solid rgba(255,255,255,0.35)",
                      color: "rgba(255,255,255,0.9)",
                      "&:hover": { bgcolor: "rgba(255,255,255,0.12)" },
                    }}
                  >
                    <Bell size={18} />
                  </IconButton>
                </Tooltip>

                {/* Open WebGIS Client button */}
                <Button
                  component="a"
                  href={mapUrl}
                  target="_blank"
                  rel="noreferrer"
                  variant="outlined"
                  size="small"
                  startIcon={<ExternalLink size={15} />}
                  sx={{
                    display: { xs: "none", sm: "inline-flex" },
                    color: "#fff",
                    borderColor: "rgba(255,255,255,0.5)",
                    "&:hover": {
                      borderColor: "#fff",
                      bgcolor: "rgba(255,255,255,0.12)",
                    },
                  }}
                >
                  {t("common.openWebgis")}
                </Button>

                {/* User Avatar Menu Trigger */}
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{
                    alignItems: "center",
                    pl: 0.5,
                    cursor: "pointer",
                    borderRadius: 2,
                    px: 1,
                    py: 0.5,
                    "&:hover": { bgcolor: "rgba(255,255,255,0.12)" },
                    transition: "background 0.2s",
                  }}
                  onClick={(e) => setUserMenuAnchor(e.currentTarget)}
                >
                  <Avatar
                    sx={{
                      width: 36,
                      height: 36,
                      bgcolor: "rgba(255,255,255,0.22)",
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: 800,
                      border: "2px solid rgba(255,255,255,0.5)",
                    }}
                  >
                    {user?.name.slice(0, 1).toUpperCase()}
                  </Avatar>
                  <Box sx={{ display: { xs: "none", sm: "block" } }}>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 750, lineHeight: 1.15, color: "#fff" }}
                    >
                      {user?.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.65)" }}>
                      {t("account.webgisAdmin")}
                    </Typography>
                  </Box>
                </Stack>
              </Stack>
            </Toolbar>
          </AppBar>

          {/* Notifications Popover */}
          <Popover
            open={Boolean(notificationAnchor)}
            anchorEl={notificationAnchor}
            onClose={() => setNotificationAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{ paper: { sx: { width: 340, p: 2, borderRadius: 2.5 } } }}
          >
            <Stack spacing={0.75}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                Thông báo hệ thống
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Chưa có thông báo.
              </Typography>
            </Stack>
          </Popover>

          {/* User Profile Popover */}
          <Popover
            open={Boolean(userMenuAnchor)}
            anchorEl={userMenuAnchor}
            onClose={() => setUserMenuAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{ paper: { sx: { width: 280, p: 2, borderRadius: 2.5 } } }}
          >
            <Stack spacing={1.5}>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                  {user?.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {user?.email}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
                <Chip label="Quản trị viên" size="small" color="primary" sx={{ fontSize: 11 }} />
                <Chip label="Đã xác thực" size="small" variant="outlined" sx={{ fontSize: 11 }} />
              </Stack>
              <Divider />
              <Button
                variant="outlined"
                color="error"
                size="small"
                startIcon={<LogOut size={15} />}
                onClick={() => {
                  setUserMenuAnchor(null);
                  void logout();
                }}
              >
                {t("common.logout")}
              </Button>
            </Stack>
          </Popover>

          {/* Body Pages */}
          <Box sx={{ p: { xs: 2, sm: 3.5 }, maxWidth: 1540, mx: "auto" }}>
            {activePage === "overview" && <DashboardPage />}
            {activePage === "datasets" && <DatasetsPage />}
            {activePage === "pipeline" && <PipelinePage />}
            {activePage === "releases" && <ReleasesPage />}
            {activePage === "access" && <AccessPage />}
            {activePage === "styles" && (
              <Paper
                sx={{ maxWidth: 680, mx: "auto", mt: 5, p: { xs: 3, sm: 5 }, textAlign: "center" }}
              >
                <Paintbrush size={36} color="#d32f2f" />
                <Typography variant="h5" sx={{ mt: 2, fontWeight: 750 }}>
                  {t("styles.comingSoonTitle")}
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                  {t("styles.comingSoonDescription")}
                </Typography>
              </Paper>
            )}
          </Box>
        </Box>
      </Box>
    </SessionGate>
  );
}
