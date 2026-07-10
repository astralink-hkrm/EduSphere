"use client";
import { useState } from "react";
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DescriptionIcon from "@mui/icons-material/Description";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import Link from "next/link";
import { getVerifications, type VerificationRecord } from "./lib/storage";

export default function Dashboard() {
  const [records] = useState<VerificationRecord[]>(() => getVerifications());

  const total = records.length;
  const pending = records.filter((r) => r.status === "pending").length;
  const verified = records.filter((r) => r.status === "verified").length;
  const mismatches = records.filter((r) => r.status === "mismatch").length;

  const stats = [
    { label: "Total Verifications", value: total, icon: DescriptionIcon, color: "#4f6ef7", bg: "#eef1fe" },
    { label: "Pending Review", value: pending, icon: HourglassEmptyIcon, color: "#f59e0b", bg: "#fffbeb" },
    { label: "Verified", value: verified, icon: CheckCircleIcon, color: "#10b981", bg: "#ecfdf5" },
    { label: "Mismatches", value: mismatches, icon: WarningAmberIcon, color: "#ef4444", bg: "#fef2f2" },
  ];

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, fontSize: "1.6rem", mb: 0.5 }}>
          Dashboard
        </Typography>
        <Typography variant="body2" color="text.secondary">
          School admission document verification overview
        </Typography>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {stats.map((s) => (
          <Grid size={{ xs: 6, md: 3 }} key={s.label}>
            <Card>
              <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}>
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: 2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: s.bg,
                      color: s.color,
                    }}
                  >
                    <s.icon fontSize="small" />
                  </Box>
                </Box>
                <Typography variant="h4" sx={{ fontWeight: 700, fontSize: "1.5rem", lineHeight: 1.1, mb: 0.25 }}>
                  {s.value}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.75rem", fontWeight: 500 }}>
                  {s.label}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Box sx={{ display: "flex", gap: 1.5, mb: 4 }}>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          component={Link}
          href="/verify"
          sx={{ px: 3, py: 1.2 }}
        >
          New Verification
        </Button>
      </Box>

      <Card>
        <CardContent sx={{ p: 0, "&:last-child": { pb: 0 } }}>
          <Box sx={{ px: 2.5, py: 2, borderBottom: "1px solid", borderColor: "divider" }}>
            <Typography variant="h6" sx={{ fontSize: "0.95rem", fontWeight: 600 }}>
              Recent Verifications
            </Typography>
          </Box>
          {records.length > 0 ? (
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Student</TableCell>
                    <TableCell>Documents</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Date</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {records.map((r, index) => (
                    <TableRow key={`${r.id}-${index}`} hover>
                      <TableCell sx={{ fontWeight: 500 }}>{r.studentName || "Untitled"}</TableCell>
                      <TableCell>{r.docCount}</TableCell>
                      <TableCell>
                        <Chip
                          icon={
                            r.status === "verified" ? (
                              <CheckCircleIcon sx={{ fontSize: 14 }} />
                            ) : r.status === "mismatch" ? (
                              <WarningAmberIcon sx={{ fontSize: 14 }} />
                            ) : (
                              <HourglassEmptyIcon sx={{ fontSize: 14 }} />
                            )
                          }
                          label={
                            r.status === "verified"
                              ? "Verified"
                              : r.status === "mismatch"
                                ? `${r.mismatchCount} Mismatch`
                                : "Pending"
                          }
                          size="small"
                          color={
                            r.status === "verified"
                              ? "success"
                              : r.status === "mismatch"
                                ? "warning"
                                : "default"
                          }
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell sx={{ color: "text.secondary", fontSize: "0.78rem" }}>
                        {new Date(r.timestamp).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
              <DescriptionIcon sx={{ fontSize: 48, color: "divider", mb: 1 }} />
              <Typography variant="body2" color="text.secondary">
                No verifications yet. Start by uploading student documents.
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                component={Link}
                href="/verify"
                sx={{ mt: 2 }}
              >
                New Verification
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
