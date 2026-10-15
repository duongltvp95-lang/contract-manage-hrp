"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, ArrowLeftRight, Eye, EyeOff, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { loginAction } from "@/app/login/actions";
import {
  calculateRemainingAttempts,
  MAX_LOGIN_ATTEMPTS,
  parseLockoutSession,
  type LockoutSessionState,
} from "@/lib/login-attempts";

const LOCKOUT_SECONDS = 15 * 60; // 15 phút

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | undefined>(undefined);
  const [clientAttempts, setClientAttempts] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);

  // Phiên khóa đa tài khoản
  const [session, setSession] = useState<LockoutSessionState>({});
  const [activeMode, setActiveMode] = useState<"primary" | "alternate">("primary");
  const [now, setNow] = useState<number>(0);

  // 1. Đọc trạng thái khóa từ localStorage khi tải trang (giữ khóa kể cả khi F5)
  useEffect(() => {
    const initTimer = setTimeout(() => {
      const currentTimestamp = Date.now();
      setNow(currentTimestamp);
      try {
        const rawSession = localStorage.getItem("hrp_lockout_session");
        if (rawSession) {
          const parsed = parseLockoutSession(rawSession, currentTimestamp);
          if (parsed) {
            setSession(parsed);
            if (parsed.lockedEmail && parsed.lockedUntil && parsed.lockedUntil > currentTimestamp) {
              setEmail(parsed.lockedEmail);
              setRemainingAttempts(0);
              setError(
                `Tài khoản ${parsed.lockedEmail} đang bị tạm khóa 15 phút do nhập sai quá 5 lần. Bạn có thể thử đăng nhập bằng 1 tài khoản khác hoặc đặt lại mật khẩu.`,
              );
            }
          }
        } else {
          // Tương thích với key lưu trữ trước đó
          const legacyUntil = localStorage.getItem("hrp_lockout_until");
          if (legacyUntil) {
            const until = Number(legacyUntil);
            if (until > currentTimestamp) {
              const legacySession: LockoutSessionState = {
                lockedEmail: "tài khoản này",
                lockedUntil: until,
              };
              setSession(legacySession);
              setRemainingAttempts(0);
              setError(
                "Tài khoản đang bị tạm khóa 15 phút do nhập sai quá 5 lần. Nút đăng nhập đã bị vô hiệu hóa.",
              );
            }
          }
        }
      } catch {
        // Bỏ qua nếu môi trường không hỗ trợ localStorage
      }
    }, 0);

    return () => clearTimeout(initTimer);
  }, []);

  // 2. Đồng hồ đếm ngược từng giây
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const saveSession = (nextSession: LockoutSessionState) => {
    setSession(nextSession);
    try {
      localStorage.setItem("hrp_lockout_session", JSON.stringify(nextSession));
    } catch {}
  };

  const isPrimaryLocked = Boolean(
    now > 0 && session.lockedUntil && session.lockedUntil > now,
  );
  const isAlternateLocked = Boolean(
    now > 0 && session.alternateLockedUntil && session.alternateLockedUntil > now,
  );

  const isCurrentModeLocked =
    activeMode === "primary" ? isPrimaryLocked : isAlternateLocked;

  const currentLockedUntil =
    activeMode === "primary" ? session.lockedUntil : session.alternateLockedUntil;

  const lockoutSecondsLeft = currentLockedUntil
    ? Math.max(0, Math.ceil((currentLockedUntil - now) / 1000))
    : 0;

  const minutes = Math.floor(lockoutSecondsLeft / 60);
  const seconds = lockoutSecondsLeft % 60;

  // Chuyển sang thử 1 tài khoản khác
  const handleSwitchToAlternate = () => {
    setActiveMode("alternate");
    setError(null);
    setPassword("");
    if (session.alternateEmail) {
      setEmail(session.alternateEmail);
      if (session.alternateCount && session.alternateCount > 0) {
        setRemainingAttempts(calculateRemainingAttempts(session.alternateCount));
      } else {
        setRemainingAttempts(MAX_LOGIN_ATTEMPTS);
      }
    } else {
      setEmail("");
      setRemainingAttempts(MAX_LOGIN_ATTEMPTS);
    }
  };

  // Quay lại tài khoản chính
  const handleSwitchToPrimary = () => {
    setActiveMode("primary");
    setPassword("");
    if (session.lockedEmail) {
      setEmail(session.lockedEmail);
    }
    if (isPrimaryLocked) {
      setRemainingAttempts(0);
      setError(
        `Tài khoản ${session.lockedEmail || "chính"} đang bị tạm khóa do nhập sai 5 lần.`,
      );
    } else {
      setError(null);
      setRemainingAttempts(undefined);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCurrentModeLocked) {
      setError(
        "Nút đăng nhập đang bị khóa do nhập sai quá 5 lần. Vui lòng thử lại sau thời gian đếm ngược hoặc sử dụng tính năng 'Quên mật khẩu'.",
      );
      return;
    }

    setIsLoading(true);
    setError(null);

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError("Vui lòng nhập đầy đủ email và mật khẩu.");
      setIsLoading(false);
      return;
    }

    // Kiểm tra giới hạn chỉ được thử 1 tài khoản khác khi tài khoản chính bị khóa
    if (isPrimaryLocked) {
      if (
        session.lockedEmail &&
        cleanEmail.toLowerCase() === session.lockedEmail.toLowerCase()
      ) {
        setError(
          `Tài khoản ${session.lockedEmail} đang bị tạm khóa. Vui lòng bấm "Thử đăng nhập bằng tài khoản khác".`,
        );
        setIsLoading(false);
        return;
      }
      if (
        session.alternateEmail &&
        session.alternateEmail.toLowerCase() !== cleanEmail.toLowerCase()
      ) {
        setError(
          `Hệ thống chỉ cho phép thử tối đa 1 tài khoản khác (${session.alternateEmail}) trong thời gian khóa. Bạn không thể thử tài khoản ${cleanEmail}.`,
        );
        setIsLoading(false);
        return;
      }
    }

    try {
      const res = await loginAction({
        email: cleanEmail,
        password,
      });

      if (!res.success) {
        if (activeMode === "alternate" || isPrimaryLocked) {
          // Xử lý đếm lần sai cho tài khoản phụ
          const nextAltCount = (session.alternateCount || 0) + 1;
          const remaining =
            res.remainingAttempts !== undefined
              ? res.remainingAttempts
              : calculateRemainingAttempts(nextAltCount);

          const nextSession: LockoutSessionState = {
            ...session,
            alternateEmail: cleanEmail,
            alternateCount: nextAltCount,
          };

          if (remaining <= 0 || nextAltCount >= MAX_LOGIN_ATTEMPTS) {
            nextSession.alternateLockedUntil = Date.now() + LOCKOUT_SECONDS * 1000;
            setError(
              "Bạn đã nhập sai 5 lần với tài khoản khác này. Nút đăng nhập đã bị khóa trong 15 phút.",
            );
          } else {
            setError(
              res.error && res.error.includes("lần thử")
                ? res.error
                : `Email hoặc mật khẩu không chính xác. Bạn còn ${remaining} lần thử với tài khoản này.`,
            );
          }

          setRemainingAttempts(remaining);
          saveSession(nextSession);
        } else {
          // Xử lý đếm lần sai cho tài khoản chính
          const nextCount = clientAttempts + 1;
          setClientAttempts(nextCount);
          const remaining =
            res.remainingAttempts !== undefined
              ? res.remainingAttempts
              : calculateRemainingAttempts(nextCount);

          setRemainingAttempts(remaining);

          if (remaining <= 0 || nextCount >= MAX_LOGIN_ATTEMPTS) {
            const until = Date.now() + LOCKOUT_SECONDS * 1000;
            const nextSession: LockoutSessionState = {
              ...session,
              lockedEmail: cleanEmail,
              lockedUntil: until,
            };
            saveSession(nextSession);
            setError(
              `Bạn đã nhập sai 5 lần. Tài khoản ${cleanEmail} đã bị tạm khóa 15 phút. Bạn có thể thử đăng nhập bằng 1 tài khoản khác hoặc đặt lại mật khẩu.`,
            );
          } else {
            setError(
              res.error && res.error.includes("lần thử")
                ? res.error
                : `Email hoặc mật khẩu không chính xác. Bạn còn ${remaining} lần thử trước khi tài khoản bị tạm khóa.`,
            );
          }
        }

        setIsLoading(false);
        return;
      }

      // Đăng nhập thành công -> xóa bỏ mọi trạng thái khóa
      try {
        localStorage.removeItem("hrp_lockout_session");
        localStorage.removeItem("hrp_lockout_until");
        localStorage.removeItem("hrp_client_attempts");
      } catch {}

      // Hard redirect để đồng bộ hoàn toàn cookie trên Safari iOS và mobile browsers
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/dashboard";
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Đã xảy ra lỗi khi đăng nhập.");
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Đăng nhập</CardTitle>
          <CardDescription>
            {activeMode === "alternate"
              ? "Đang thử đăng nhập bằng tài khoản khác"
              : "Dùng email và mật khẩu được cấp để truy cập hệ thống"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} noValidate>
            <div className="flex flex-col gap-6">
              {/* Thông báo chế độ thử tài khoản khác */}
              {activeMode === "alternate" && isPrimaryLocked && (
                <div className="rounded-md border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs text-indigo-950 dark:text-indigo-200 flex items-start gap-2">
                  <ArrowLeftRight className="h-4 w-4 shrink-0 mt-0.5 text-indigo-600 dark:text-indigo-400" />
                  <div className="space-y-0.5">
                    <p className="font-semibold">Chế độ thử tài khoản khác</p>
                    <p>
                      Tài khoản chính{" "}
                      <span className="font-semibold underline">
                        {session.lockedEmail}
                      </span>{" "}
                      đang bị tạm khóa. Bạn chỉ được phép thử với tối đa 1 tài khoản khác.
                    </p>
                  </div>
                </div>
              )}

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="email">
                    {activeMode === "alternate" ? "Email tài khoản khác" : "Email"}
                  </Label>
                  {isPrimaryLocked && activeMode === "alternate" && (
                    <button
                      type="button"
                      onClick={handleSwitchToPrimary}
                      className="text-xs text-primary hover:underline font-medium"
                    >
                      Quay lại tài khoản cũ
                    </button>
                  )}
                </div>
                <Input
                  id="email"
                  type="email"
                  placeholder={
                    activeMode === "alternate"
                      ? "ten.khac@hrpartner.vn"
                      : "ten@hrpartner.vn"
                  }
                  required
                  disabled={isLoading || isCurrentModeLocked}
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Mật khẩu</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    Quên mật khẩu?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    disabled={isLoading || isCurrentModeLocked}
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    disabled={isCurrentModeLocked}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-0 top-0 bottom-0 z-20 flex h-full w-10 items-center justify-center text-muted-foreground hover:text-foreground active:opacity-70 focus:outline-none cursor-pointer"
                    aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className={cn(
                    "rounded-md p-3 text-sm border font-medium flex items-start gap-2.5",
                    isCurrentModeLocked
                      ? "bg-destructive/15 border-destructive/30 text-destructive"
                      : remainingAttempts !== undefined && remainingAttempts > 0
                        ? "bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200"
                        : "bg-destructive/15 border-destructive/20 text-destructive",
                  )}
                >
                  {isCurrentModeLocked ? (
                    <Lock className="h-5 w-5 shrink-0 mt-0.5 text-destructive" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1.5 w-full">
                    <p>{error}</p>
                    {remainingAttempts !== undefined &&
                      remainingAttempts <= 2 &&
                      remainingAttempts > 0 && (
                        <p className="text-xs font-normal">
                          Gợi ý:{" "}
                          <Link
                            href="/auth/forgot-password"
                            className="font-semibold underline underline-offset-2 hover:opacity-80"
                          >
                            Bấm vào đây để đặt lại mật khẩu
                          </Link>{" "}
                          trước khi tài khoản bị khóa.
                        </p>
                      )}
                  </div>
                </div>
              )}

              {/* Nút Đăng nhập - Sẽ bị KHÓA khi tài khoản hiện tại sai 5 lần */}
              <Button
                type="submit"
                className={cn(
                  "w-full transition-all duration-200 font-semibold",
                  isCurrentModeLocked &&
                    "opacity-60 cursor-not-allowed bg-destructive/80 text-white hover:bg-destructive/80",
                )}
                disabled={isLoading || isCurrentModeLocked}
              >
                {isLoading
                  ? "Đang đăng nhập..."
                  : isCurrentModeLocked
                    ? `Đã khóa nút đăng nhập (${minutes}p ${seconds < 10 ? `0${seconds}` : seconds}s)`
                    : activeMode === "alternate"
                      ? "Đăng nhập tài khoản khác"
                      : "Đăng nhập"}
              </Button>

              {/* Chức năng: Cho phép thử với 1 tài khoản khác khi tài khoản chính bị khóa */}
              {isPrimaryLocked && activeMode === "primary" && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSwitchToAlternate}
                  disabled={isAlternateLocked}
                  className="w-full border-primary text-primary hover:bg-primary/5 font-semibold flex items-center justify-center gap-2"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                  {isAlternateLocked
                    ? "Tài khoản khác cũng đã bị khóa"
                    : session.alternateEmail
                      ? `Thử lại tài khoản khác (${session.alternateEmail})`
                      : "Thử đăng nhập bằng tài khoản khác (Tối đa 1)"}
                </Button>
              )}

              {/* Nếu đã bị khóa, cung cấp nút Đặt lại mật khẩu để mở khóa ngay */}
              {isCurrentModeLocked && (
                <Button
                  variant="ghost"
                  asChild
                  className="w-full text-muted-foreground hover:text-foreground text-sm"
                >
                  <Link href="/auth/forgot-password">
                    Đặt lại mật khẩu để mở khóa ngay
                  </Link>
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
