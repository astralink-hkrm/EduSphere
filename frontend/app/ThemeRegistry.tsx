"use client";
import { useState } from "react";
import { ThemeProvider, createTheme, CssBaseline } from "@mui/material";
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Toolbar,
  AppBar,
  Select,
  MenuItem,
  FormControl,
  Chip,
} from "@mui/material";
import DashboardIcon from "@mui/icons-material/Dashboard";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import SettingsIcon from "@mui/icons-material/Settings";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import Link from "next/link";
import { usePathname } from "next/navigation";

const DRAWER_WIDTH = 240;

const theme = createTheme({
  palette: {
    primary: { main: "#4f6ef7", light: "#eef1fe", dark: "#3b5bdb" },
    secondary: { main: "#7c3aed" },
    success: { main: "#10b981", light: "#ecfdf5" },
    warning: { main: "#f59e0b", light: "#fffbeb" },
    error: { main: "#ef4444", light: "#fef2f2" },
    background: { default: "#f0f2f8", paper: "#ffffff" },
    text: { primary: "#1e2132", secondary: "#5b6778" },
    divider: "#e8ecf2",
  },
  typography: {
    fontFamily: [
      "Inter",
      "system-ui",
      "-apple-system",
      "BlinkMacSystemFont",
      "Segoe UI",
      "Roboto",
      "sans-serif",
    ].join(","),
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { textTransform: "none", fontWeight: 600, borderRadius: 8 },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          "& .MuiTableCell-head": {
            fontWeight: 600,
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "#6b7280",
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { padding: "10px 12px", fontSize: "0.82rem" },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, fontSize: "0.7rem" },
      },
    },
  },
});

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: DashboardIcon },
  { label: "Verification", href: "/verify", icon: VerifiedUserIcon },
  { label: "Settings", href: "/settings", icon: SettingsIcon },
];

const MODELS = [
  { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite", provider: "Google" },
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "Google" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google" },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "Google" },
  { id: "groq", name: "Llama 4 Scout", provider: "Groq" },
];

const getLocal = (key: string, fallback: string) => {
  if (typeof window === "undefined") return fallback;
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};

const setLocal = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch {}
};

export default function ThemeRegistry({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [selectedModel, setSelectedModel] = useState(() => getLocal("selected_model", "gemini-2.0-flash-lite"));

  const handleModelChange = (id: string) => {
    setSelectedModel(id);
    setLocal("selected_model", id);
  };

  const activeModel = MODELS.find((m) => m.id === selectedModel) || MODELS[0];

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
        <Drawer
          variant="permanent"
          sx={{
            width: DRAWER_WIDTH,
            flexShrink: 0,
            "& .MuiDrawer-paper": {
              width: DRAWER_WIDTH,
              borderRight: "1px solid",
              borderColor: "divider",
              bgcolor: "#fafbff",
            },
          }}
        >
          <Toolbar sx={{ px: 2.5, py: 2.5, alignItems: "flex-start", flexDirection: "column" }}>
            <Typography
              variant="h6"
              sx={{ fontWeight: 800, fontSize: "1.15rem", color: "primary.main", letterSpacing: "-0.3px" }}
            >
              AdiSphere
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.5px", mt: 0.5 }}>
              Admission Suite
            </Typography>
          </Toolbar>
          <List sx={{ px: 1.5 }}>
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <ListItem key={item.href} disablePadding sx={{ mb: 0.5 }}>
                  <Link href={item.href} style={{ width: "100%", textDecoration: "none", color: "inherit" }}>
                    <ListItemButton
                      sx={{
                        borderRadius: 2,
                        bgcolor: active ? "primary.main" : "transparent",
                        color: active ? "#fff" : "#4a5568",
                        "&:hover": { bgcolor: active ? "primary.dark" : "#edf2f7" },
                        py: 1.2,
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 36, color: active ? "#fff" : "#4a5568" }}>
                        <item.icon fontSize="small" />
                      </ListItemIcon>
                      <ListItemText
                        primary={item.label}
                        sx={{
                          "& .MuiListItemText-primary": {
                            fontSize: "0.85rem",
                            fontWeight: active ? 600 : 500,
                          },
                        }}
                      />
                    </ListItemButton>
                  </Link>
                </ListItem>
              );
            })}
          </List>
        </Drawer>
        <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
          <AppBar
            position="sticky"
            elevation={0}
            sx={{
              bgcolor: "#fff",
              borderBottom: "1px solid",
              borderColor: "divider",
              color: "text.primary",
              py: 0.5,
              px: 3,
            }}
          >
            <Toolbar disableGutters sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.85rem", mr: "auto" }}>
                {pathname === "/" ? "Dashboard" : pathname === "/verify" ? "Document Verification" : pathname === "/settings" ? "Settings" : ""}
              </Typography>
              <SmartToyIcon sx={{ color: "primary.main", fontSize: 20 }} />
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <Select
                  value={selectedModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  sx={{
                    fontSize: "0.78rem",
                    bgcolor: "background.default",
                    "& .MuiOutlinedInput-notchedOutline": { borderColor: "divider" },
                  }}
                >
                  {MODELS.map((m) => (
                    <MenuItem key={m.id} value={m.id} sx={{ fontSize: "0.8rem" }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Chip
                          label={m.provider === "Google" ? "G" : "Gq"}
                          size="small"
                          color="primary"
                          variant="outlined"
                          sx={{ fontSize: "0.55rem", fontWeight: 700, minWidth: 24, height: 20 }}
                        />
                        {m.name}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Toolbar>
          </AppBar>
          <Box sx={{ flexGrow: 1, bgcolor: "background.default", p: 4 }}>
            {children}
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
