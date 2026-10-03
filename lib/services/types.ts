/**
 * Result shape shared by the service layer.
 *
 * Services never throw for expected outcomes, so route handlers and server
 * actions can map them onto HTTP status codes or form errors without a
 * try/catch around every call.
 */

export type ServiceErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "upload_incomplete"
  | "db_error";

export type ServiceIssue = { path: string; message: string };

export type ServiceOk<T> = { ok: true; data: T };

export type ServiceErr = {
  ok: false;
  code: ServiceErrorCode;
  message: string;
  issues?: ServiceIssue[];
};

export type ServiceResult<T> = ServiceOk<T> | ServiceErr;

export function ok<T>(data: T): ServiceOk<T> {
  return { ok: true, data };
}

export function err(
  code: ServiceErrorCode,
  message: string,
  issues?: ServiceIssue[],
): ServiceErr {
  return { ok: false, code, message, issues };
}

/** Maps a service failure onto an HTTP status for route handlers. */
export function statusForCode(code: ServiceErrorCode): number {
  switch (code) {
    case "unauthenticated":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "validation":
      return 422;
    default:
      return 500;
  }
}

/**
 * A database failure, handled the way plan section 80 requires.
 *
 * The underlying driver error goes to the server log, where an operator can see
 * it; the caller gets a message that is safe to render. Supabase/PostgREST
 * errors carry SQL detail (constraint names, column names, sometimes fragments
 * of the query), which must never reach the UI.
 */
export function dbError(scope: string, error: unknown): ServiceErr {
  console.error(`[service:${scope}]`, error);
  return err(
    "db_error",
    "Không xử lý được yêu cầu. Vui lòng thử lại sau ít phút.",
  );
}
