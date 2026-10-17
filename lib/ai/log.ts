import "server-only";

/**
 * Logger có cấu trúc cho module AI.
 *
 * Mục đích (B9 + G2 v2):
 * - Thay thế 5 chỗ `console.log/warn/error` rải rác trong `lib/ai/gemini.ts`
 *   và 1 chỗ trong `app/(app)/contracts/actions.ts`.
 * - Ghi JSON 1 dòng ra stdout/stderr để Vercel logs pickup được
 *   và dễ parse/grep trong production.
 * - Khi sau này thêm Sentry/Datadog/OTel, chỉ cần đổi hàm `emit()` —
 *   KHÔNG phải sửa 6 call sites.
 *
 * Lưu ý:
 * - Module này có `server-only` → KHÔNG import trong component client.
 *   Client component dùng `lib/ai/log-client.ts` (phiên bản không có server-only).
 * - Theo rule §2 workspace: KHÔNG bao giờ truyền `apiKey` hay credential
 *   vào context. Các call site chỉ truyền `model`, `elapsedMs`, `errorMessage`...
 */

type Level = "info" | "warn" | "error";

function emit(level: Level, message: string, context?: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    scope: "ai:gemini",
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

export const aiLog = {
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),
};
