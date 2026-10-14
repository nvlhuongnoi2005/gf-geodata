import { Box, ButtonBase, Tooltip, Typography } from "@mui/material";
import ReactCountryFlag from "react-country-flag";
import { useI18n } from "../i18n";

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  const isVietnamese = language === "vi";

  return (
    <Tooltip title={t("language.switch")}>
      <ButtonBase
        type="button"
        aria-label={t("language.switch")}
        onClick={() => setLanguage(isVietnamese ? "en" : "vi")}
        sx={{
          minWidth: 72,
          height: 38,
          px: 1,
          gap: 0.75,
          borderRadius: 2,
          border: "1px solid rgba(255,255,255,0.5)",
          bgcolor: "rgba(255,255,255,0.12)",
          color: "#fff",
          "&:hover": { bgcolor: "rgba(255,255,255,0.2)" },
          "&:focus-visible": { outline: "2px solid #fff", outlineOffset: 2 },
        }}
      >
        <Box
          sx={{
            width: 20,
            height: 20,
            flex: "0 0 20px",
            borderRadius: "50%",
            overflow: "hidden",
            display: "grid",
            placeItems: "center",
          }}
        >
          <ReactCountryFlag
            countryCode={isVietnamese ? "VN" : "GB"}
            svg
            style={{ width: "100%", height: "100%", display: "block" }}
          />
        </Box>
        <Typography component="span" sx={{ color: "inherit", fontSize: 13, fontWeight: 800, lineHeight: 1, textTransform: "uppercase" }}>
          {isVietnamese ? "vn" : "en"}
        </Typography>
      </ButtonBase>
    </Tooltip>
  );
}
