import { alpha, createTheme, type PaletteMode } from "@mui/material/styles";

export function createAppTheme(mode: PaletteMode) {
  const isDark = mode === "dark";
  const palette = isDark
    ? {
        primary: {
          main: "#ef4444",
          dark: "#dc2626",
          light: "#7f1d1d",
          contrastText: "#ffffff",
        },
        secondary: {
          main: "#14b8a6",
          dark: "#0d9488",
          light: "#134e4a",
          contrastText: "#ffffff",
        },
        background: {
          default: "#090e13",
          paper: "#111922",
        },
        text: {
          primary: "#f1f5f9",
          secondary: "#94a3b8",
        },
        success: { main: "#22c55e", light: "#14532d" },
        warning: { main: "#f59e0b", light: "#78350f" },
        error: { main: "#f87171", light: "#7f1d1d" },
        info: { main: "#38bdf8", light: "#0c4a6e" },
        divider: "#1e293b",
      }
    : {
        primary: {
          main: "#d32f2f",
          dark: "#b71c1c",
          light: "#fee2e2",
          contrastText: "#ffffff",
        },
        secondary: {
          main: "#0d9488",
          dark: "#0f766e",
          light: "#ccfbf1",
          contrastText: "#ffffff",
        },
        background: {
          default: "#f8fafc",
          paper: "#ffffff",
        },
        text: {
          primary: "#0f172a",
          secondary: "#475569",
        },
        success: { main: "#16a34a", light: "#dcfce7" },
        warning: { main: "#d97706", light: "#fef3c7" },
        error: { main: "#dc2626", light: "#fee2e2" },
        info: { main: "#0284c7", light: "#e0f2fe" },
        divider: "#e2e8f0",
      };

  return createTheme({
    palette: { mode, ...palette },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      h3: { fontWeight: 800, letterSpacing: "-0.03em" },
      h4: { fontWeight: 700, letterSpacing: "-0.025em" },
      h5: { fontWeight: 700, letterSpacing: "-0.02em" },
      h6: { fontWeight: 650, letterSpacing: "-0.015em" },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      button: { textTransform: "none", fontWeight: 600, letterSpacing: "0.01em" },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            margin: 0,
            backgroundColor: palette.background.default,
            color: palette.text.primary,
          },
          "::selection": { backgroundColor: alpha(palette.primary.main, 0.25) },
          "*::-webkit-scrollbar": {
            width: "8px",
            height: "8px",
          },
          "*::-webkit-scrollbar-thumb": {
            backgroundColor: isDark ? "#334155" : "#cbd5e1",
            borderRadius: "4px",
          },
          "*::-webkit-scrollbar-track": {
            backgroundColor: "transparent",
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            borderColor: palette.divider,
            transition: "box-shadow 0.2s ease, border-color 0.2s ease",
          },
          outlined: {
            borderColor: palette.divider,
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            minHeight: 40,
            borderRadius: 10,
            paddingInline: 16,
            fontWeight: 600,
            transition: "all 0.15s ease-in-out",
          },
          contained: {
            boxShadow: isDark ? "0 4px 14px rgb(0 0 0 / 35%)" : "0 4px 14px rgb(211 47 47 / 20%)",
            "&:hover": {
              boxShadow: isDark ? "0 6px 18px rgb(0 0 0 / 45%)" : "0 6px 18px rgb(211 47 47 / 30%)",
            },
          },
          outlined: {
            borderColor: palette.divider,
            "&:hover": {
              borderColor: palette.text.secondary,
              backgroundColor: isDark ? alpha("#fff", 0.04) : alpha("#000", 0.04),
            },
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            "& .MuiOutlinedInput-root": {
              borderRadius: 10,
              backgroundColor: palette.background.paper,
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            fontWeight: 600,
            fontSize: "0.75rem",
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderColor: palette.divider,
          },
          head: {
            fontWeight: 700,
            color: palette.text.secondary,
            backgroundColor: isDark ? alpha(palette.background.paper, 0.6) : "#f1f5f9",
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: 8,
            fontSize: 12,
            padding: "6px 12px",
          },
        },
      },
    },
  });
}
