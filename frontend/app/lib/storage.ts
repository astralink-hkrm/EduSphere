export interface VerificationRecord {
  id: string;
  timestamp: number;
  studentName: string;
  docCount: number;
  mismatchCount: number;
  status: "verified" | "mismatch" | "pending";
}

export function getVerifications(): VerificationRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem("verifications") || "[]");
  } catch {
    return [];
  }
}

export function saveVerification(record: VerificationRecord) {
  const list = getVerifications();
  list.unshift(record);
  localStorage.setItem("verifications", JSON.stringify(list.slice(0, 50)));
}
