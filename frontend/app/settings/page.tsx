"use client";
import { useState } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Alert,
  IconButton,
  InputAdornment,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import SaveIcon from "@mui/icons-material/Save";
import GoogleIcon from "@mui/icons-material/Google";

const getLocal = (key: string, fallback: string) => {
  if (typeof window === "undefined") return fallback;
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
};

export default function Settings() {
  const [geminiKey, setGeminiKey] = useState(() => getLocal("gemini_key", ""));
  const [groqKey, setGroqKey] = useState(() => getLocal("groq_key", ""));
  const [saved, setSaved] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [showGroq, setShowGroq] = useState(false);

  const save = () => {
    localStorage.setItem("gemini_key", geminiKey);
    localStorage.setItem("groq_key", groqKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, fontSize: "1.6rem", mb: 0.5 }}>
          Settings
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Configure API keys for vision models
        </Typography>
      </Box>

      {saved && (
        <Alert severity="success" sx={{ mb: 2 }}>
          API keys saved successfully.
        </Alert>
      )}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <GoogleIcon color="primary" />
            <Typography variant="h6" sx={{ fontSize: "0.95rem", fontWeight: 600 }}>
              Google Gemini
            </Typography>
          </Box>
          <TextField
            fullWidth
            type={showGemini ? "text" : "password"}
            label="API Key"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            size="small"
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShowGemini(!showGemini)} edge="end">
                      {showGemini ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            Get your key at{" "}
            <Typography
              component="a"
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noreferrer"
              variant="caption"
              color="primary"
              sx={{ textDecoration: "underline" }}
            >
              aistudio.google.com
            </Typography>
          </Typography>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <Box
              sx={{
                width: 24,
                height: 24,
                borderRadius: 1,
                bgcolor: "primary.light",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.65rem",
                fontWeight: 700,
                color: "primary.main",
              }}
            >
              G
            </Box>
            <Typography variant="h6" sx={{ fontSize: "0.95rem", fontWeight: 600 }}>
              Groq
            </Typography>
          </Box>
          <TextField
            fullWidth
            type={showGroq ? "text" : "password"}
            label="API Key"
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            size="small"
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShowGroq(!showGroq)} edge="end">
                      {showGroq ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            Get your key at{" "}
            <Typography
              component="a"
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noreferrer"
              variant="caption"
              color="primary"
              sx={{ textDecoration: "underline" }}
            >
              console.groq.com
            </Typography>
          </Typography>
        </CardContent>
      </Card>

      <Button variant="contained" startIcon={<SaveIcon />} onClick={save} sx={{ px: 4 }}>
        Save Keys
      </Button>
    </Box>
  );
}
