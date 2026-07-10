export interface UDISETransferData {
  studentName: string;
  dob: string;
  fatherName: string;
  motherName: string;
  gender: string;
  address: string;
  mobile: string;
  email: string;
}

export async function triggerUDISEExtension(): Promise<void> {
  console.log("[EduSphere] Triggering extension OPEN_UDISE...");
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("trigger_udise_extension");
    console.log("[EduSphere] Extension trigger sent to Tauri backend.");
  } catch {
    console.log("[EduSphere] Tauri backend not available (running in browser).");
  }
}

export function openUDISEPortal(): void {
  console.log("[EduSphere] UDISE+ export flow started.");
  triggerUDISEExtension();
}

export function prepareUDISETransfer(data: UDISETransferData): void {
  console.log("[EduSphere] prepareUDISETransfer called with:", data);
}
