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
import { getAllProviders, getLocal } from "../lib/providers";

function providerIcon(id: string) {
  if (id === "google") {
    return <GoogleIcon color="primary" />;
  }
  return (
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
      {id.charAt(0).toUpperCase()}
    </Box>
  );
}

function providerKeyUrl(id: string): string | undefined {
  if (id === "google") return "https://aistudio.google.com/apikey";
  if (id === "groq") return "https://console.groq.com/keys";
  if (id === "openrouter") return "https://openrouter.ai/keys";
  if (id === "github") return "https://github.com/settings/tokens";
  return undefined;
}

export default function Settings() {
  const providers = getAllProviders();
  const [keys, setKeys] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const p of providers) {
      initial[p.id] = getLocal(p.apiKeyKey, "");
    }
    return initial;
  });
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);

  const save = () => {
    for (const p of providers) {
      localStorage.setItem(p.apiKeyKey, keys[p.id] || "");
    }
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

      {providers.map((p) => (
        <Card key={p.id} sx={{ mb: 2 }}>
          <CardContent>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
              {providerIcon(p.id)}
              <Typography variant="h6" sx={{ fontSize: "0.95rem", fontWeight: 600 }}>
                {p.name}
              </Typography>
            </Box>
            <TextField
              fullWidth
              type={visible[p.id] ? "text" : "password"}
              label="API Key"
              value={keys[p.id] || ""}
              onChange={(e) => setKeys((prev) => ({ ...prev, [p.id]: e.target.value }))}
              size="small"
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() =>
                          setVisible((prev) => ({ ...prev, [p.id]: !prev[p.id] }))
                        }
                        edge="end"
                      >
                        {visible[p.id] ? (
                          <VisibilityOffIcon fontSize="small" />
                        ) : (
                          <VisibilityIcon fontSize="small" />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            {p.models.length > 0 && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 1 }}
              >
                Available models: {p.models.map((m) => m.name).join(", ")}
              </Typography>
            )}
            {providerKeyUrl(p.id) && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                Get your key at{" "}
                <Typography
                  component="a"
                  href={providerKeyUrl(p.id)}
                  target="_blank"
                  rel="noreferrer"
                  variant="caption"
                  color="primary"
                  sx={{ textDecoration: "underline" }}
                >
                  {new URL(providerKeyUrl(p.id)!).hostname}
                </Typography>
              </Typography>
            )}
          </CardContent>
        </Card>
      ))}

      <Button variant="contained" startIcon={<SaveIcon />} onClick={save} sx={{ px: 4 }}>
        Save Keys
      </Button>
    </Box>
  );
}
