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
  Paper,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Bell,
  Database,
  ExternalLink,
  FileStack,
  Gauge,
  Layers3,
  LockKeyhole,
  LogOut,
  Mail,
  MapPinned,
  Menu,
  Paintbrush,
  Send,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeModeSwitcher } from "./AppearanceControls";
import { DashboardPage } from "../pages/DashboardPage";
import { DatasetsPage } from "../pages/DatasetsPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { StyleStudioPage } from "../pages/StyleStudioPage";

const drawerWidth = 278;
type PageKey = "overview" | "datasets" | "pipeline" | "styles" | "releases" | "access";
const mapLoginUrl = import.meta.env.VITE_MAP_LOGIN_URL || "http://webgis.localhost/login";
const mapUrl = import.meta.env.VITE_WEBGIS_MAP_URL || "http://webgis.localhost/map";
const nav = [
  { key: "overview", label: "nav.overview", caption: "nav.overviewCaption", icon: Gauge },
  { key: "datasets", label: "nav.datasets", caption: "nav.datasetsCaption", icon: Database },
  { key: "pipeline", label: "nav.pipeline", caption: "nav.pipelineCaption", icon: Workflow },
  { key: "styles", label: "nav.styles", caption: "nav.stylesCaption", icon: Paintbrush },
  { key: "releases", label: "nav.releases", caption: "nav.releasesCaption", icon: Send },
  { key: "access", label: "nav.access", caption: "nav.accessCaption", icon: ShieldCheck },
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
        sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "#64e9d0" }}
      />
      <Typography variant="caption" sx={{ color: "rgb(235 255 251 / 72%)" }}>
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
        color: "#f6ffff",
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
          <Typography sx={{ fontWeight: 800 }}>Geodata Control</Typography>
          <Typography variant="caption" sx={{ opacity: 0.68 }}>
            Tile Server · Operations
          </Typography>
        </Box>
      </Stack>
      <Box sx={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.92 }}>
        <svg viewBox="0 0 800 650" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
          <path
            className="login-route"
            d="M-60 490 C120 290, 200 540, 350 370 S570 260, 870 160"
            fill="none"
            stroke="rgba(86, 235, 202, .55)"
            strokeWidth="2"
          />
          <path
            d="M-60 180 C140 300, 250 100, 460 250 S690 480, 870 350"
            fill="none"
            stroke="rgba(255,255,255,.23)"
            strokeWidth="1.5"
          />
        </svg>
      </Box>
      <Box sx={{ position: "relative", maxWidth: 500 }}>
        <Chip
          icon={<Sparkles size={14} />}
          label="Geospatial operations"
          size="small"
          sx={{ color: "#c9fff4", bgcolor: "rgb(96 229 202 / 12%)" }}
        />
        <Typography variant="h3" sx={{ mt: 2.5, maxWidth: 460, lineHeight: 1.05 }}>
          {t("login.artworkTitle")}
        </Typography>
        <Typography
          sx={{ mt: 2, color: "rgb(235 255 251 / 68%)", lineHeight: 1.75, maxWidth: 440 }}
        >
          {t("login.artworkDescription")}
        </Typography>
      </Box>
      <Stack direction="row" spacing={3} sx={{ position: "relative" }}>
        <Signal label="Offline-ready" />
        <Signal label="SeaweedFS S3" />
        <Signal label="Map Auth" />
      </Stack>
    </Box>
  );
}
function SessionGate({ children }: { children: ReactNode }) {
  const { isLoading, login, user } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    const result = await login(email, password);
    setIsSubmitting(false);
    if (!result.ok) setError(result.message);
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
        <CircularProgress />
      </Box>
    );
  if (!user)
    return (
      <Box
        sx={{
          minHeight: "100dvh",
          display: "grid",
          gridTemplateColumns: { md: "minmax(420px, 1.08fr) minmax(500px, .92fr)" },
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
            sx={{ width: "100%", maxWidth: 405, p: { xs: 0, sm: 1 }, bgcolor: "transparent" }}
          >
            <Stack spacing={3}>
              <Box sx={{ display: { md: "none" } }}>
                <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
                  <BrandMark size={38} />
                  <Typography sx={{ fontWeight: 800 }}>Geodata Control</Typography>
                </Stack>
              </Box>
              <Box>
                <Typography variant="overline" color="primary" sx={{ fontWeight: 800 }}>
                  {t("login.adminAccess")}
                </Typography>
                <Typography variant="h4" sx={{ mt: 0.25 }}>
                  {t("login.welcome")}
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 1, lineHeight: 1.65 }}>
                  {t("login.description")}
                </Typography>
              </Box>
              <Stack spacing={1.75}>
                <TextField
                  autoComplete="email"
                  label={t("login.email")}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoFocus
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
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <LockKeyhole size={18} />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
                {error && (
                  <Box
                    sx={{
                      px: 1.5,
                      py: 1.2,
                      borderRadius: 2,
                      bgcolor: "error.light",
                      color: "error.main",
                      fontSize: 14,
                    }}
                  >
                    {error}
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
          <ShieldCheck size={34} color="#df1743" />
          <Typography variant="h5" sx={{ mt: 2 }}>
            {t("login.noAccess")}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t("login.noAccessDescription")}
          </Typography>
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
            <Typography sx={{ fontWeight: 800 }}>Geodata Control</Typography>
            <Typography variant="caption" color="text.secondary">
              Tile platform · offline
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
        WORKSPACE
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
              sx={{ mb: 0.45, borderRadius: 2.5, py: 1.05 }}
            >
              <ListItemIcon sx={{ minWidth: 39 }}>
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
      <Box
        sx={{
          mt: "auto",
          m: 1.25,
          p: 1.5,
          borderRadius: 3,
          bgcolor: "secondary.light",
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <Stack direction="row" spacing={0.8} sx={{ alignItems: "center" }}>
          <Box
            className="status-pulse"
            sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "secondary.main" }}
          />
          <Typography variant="caption" sx={{ color: "secondary.dark", fontWeight: 800 }}>
            {t("sidebar.ready")}
          </Typography>
        </Stack>
      </Box>
      <Box sx={{ px: 1.25, pb: 1.25 }}>
        <Button
          fullWidth
          variant="outlined"
          color="inherit"
          startIcon={<LogOut size={17} />}
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
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
          <AppBar
            position="sticky"
            color="inherit"
            elevation={0}
            sx={{ borderBottom: "1px solid", borderColor: "divider", bgcolor: "background.paper" }}
          >
            <Toolbar
              sx={{
                minHeight: "70px !important",
                justifyContent: "space-between",
                px: { xs: 2, sm: 3.5 },
              }}
            >
              <Stack direction="row" spacing={1.3} sx={{ alignItems: "center" }}>
                <IconButton onClick={() => setMobileOpen(true)} sx={{ display: { md: "none" } }}>
                  <Menu />
                </IconButton>
                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", lineHeight: 1.1 }}
                  >
                    GEODATA WORKSPACE
                  </Typography>
                  <Typography sx={{ fontWeight: 750, fontSize: 15 }}>{t(active.label)}</Typography>
                </Box>
              </Stack>
              <Stack direction="row" spacing={1.2} sx={{ alignItems: "center" }}>
                <LanguageSwitcher />
                <ThemeModeSwitcher />
                <Tooltip title={t("common.notifications")}>
                  <IconButton size="small" sx={{ border: "1px solid", borderColor: "divider" }}>
                    <Bell size={18} />
                  </IconButton>
                </Tooltip>
                <Button
                  component="a"
                  href={mapUrl}
                  target="_blank"
                  rel="noreferrer"
                  variant="outlined"
                  size="small"
                  startIcon={<ExternalLink size={15} />}
                  sx={{ display: { xs: "none", sm: "inline-flex" } }}
                >
                  {t("common.openWebgis")}
                </Button>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", pl: 0.4 }}>
                  <Avatar
                    sx={{
                      width: 34,
                      height: 34,
                      bgcolor: "primary.light",
                      color: "primary.dark",
                      fontSize: 14,
                      fontWeight: 800,
                    }}
                  >
                    {user?.name.slice(0, 1).toUpperCase()}
                  </Avatar>
                  <Box sx={{ display: { xs: "none", sm: "block" } }}>
                    <Typography variant="body2" sx={{ fontWeight: 750, lineHeight: 1.15 }}>
                      {user?.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      WebGIS admin
                    </Typography>
                  </Box>
                </Stack>
              </Stack>
            </Toolbar>
          </AppBar>
          <Box sx={{ p: { xs: 2, sm: 3.5 }, maxWidth: 1540, mx: "auto" }}>
            {activePage === "overview" && <DashboardPage onNavigate={setActivePage} />}
            {activePage === "datasets" && <DatasetsPage />}
            {activePage === "pipeline" && (
              <PlaceholderPage
                icon={<Workflow size={25} />}
                title={t("placeholder.pipeline")}
                description={t("placeholder.pipelineDescription")}
              />
            )}
            {activePage === "styles" && <StyleStudioPage />}
            {activePage === "releases" && (
              <PlaceholderPage
                icon={<Send size={25} />}
                title={t("nav.releases")}
                description={t("placeholder.releasesDescription")}
              />
            )}
            {activePage === "access" && (
              <PlaceholderPage
                icon={<FileStack size={25} />}
                title={t("placeholder.access")}
                description={t("placeholder.accessDescription")}
              />
            )}
          </Box>
        </Box>
      </Box>
    </SessionGate>
  );
}
