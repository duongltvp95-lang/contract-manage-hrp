/**
 * Logger cho module AI ở phía client (component).
 *
 * KHÔNG có `server-only` → có thể import trong component React client.
 * Cùng interface với `lib/ai/log.ts` (server-side) để dễ chuyển đổi.
 *
 * Mục đích (B9 + G2 v2):
 * - Thay thế 1 chỗ `console.error` rải rác trong `components/contracts/contract-form.tsx`.
 * - Ghi JSON 1 dòng ra browser console → dễ debug khi user gặp sự cố.
 *
 * Lưu ý:
 * - Theo rule §2 workspace: KHÔNG bao giờ truyền `apiKey` hay credential
 *   vào context.
 */

type Level = "info" | "warn" | "error";

function emit(level: Level, message: string, context?: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    scope: "ai:client",
    message,
    ...context,
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const clientLog = {
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),
};
