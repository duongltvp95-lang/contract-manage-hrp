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
import { AlertCircle, Eye, EyeOff, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { loginAction } from "@/app/login/actions";

const MAX_ATTEMPTS = 5;
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
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);

  // 1. Đọc trạng thái khóa từ localStorage khi tải trang (giữ khóa kể cả khi F5)
  useEffect(() => {
    const initTimer = setTimeout(() => {
      try {
        const savedUntil = localStorage.getItem("hrp_lockout_until");
        if (savedUntil) {
          const diff = Math.ceil((Number(savedUntil) - Date.now()) / 1000);
          if (diff > 0) {
            setLockoutSecondsLeft(diff);
            setRemainingAttempts(0);
            setError(
              "Tài khoản đang bị tạm khóa do nhập sai quá 5 lần. Nút đăng nhập đã bị vô hiệu hóa.",
            );
          } else {
            localStorage.removeItem("hrp_lockout_until");
            localStorage.removeItem("hrp_client_attempts");
          }
        }
        const savedAttempts = localStorage.getItem("hrp_client_attempts");
        if (savedAttempts) {
          const count = Number(savedAttempts);
          setClientAttempts(count);
          if (count > 0 && count < MAX_ATTEMPTS) {
            setRemainingAttempts(MAX_ATTEMPTS - count);
          }
        }
      } catch {
        // Bỏ qua nếu môi trường không hỗ trợ localStorage
      }
    }, 0);

    return () => clearTimeout(initTimer);
  }, []);

  // 2. Đếm ngược từng giây khi tài khoản bị khóa
  useEffect(() => {
    if (lockoutSecondsLeft <= 0) return;
    const timer = setInterval(() => {
      setLockoutSecondsLeft((prev) => {
        if (prev <= 1) {
          try {
            localStorage.removeItem("hrp_lockout_until");
            localStorage.removeItem("hrp_client_attempts");
          } catch {}
          setRemainingAttempts(undefined);
          setClientAttempts(0);
          setError(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSecondsLeft]);

  const isLocked =
    (remainingAttempts !== undefined && remainingAttempts <= 0) ||
    lockoutSecondsLeft > 0;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) {
      setError(
        "Nút đăng nhập đang bị khóa do nhập sai quá 5 lần. Vui lòng bấm 'Đặt lại mật khẩu' để mở khóa ngay.",
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

    try {
      const res = await loginAction({
        email: cleanEmail,
        password,
      });

      if (!res.success) {
        const nextCount = clientAttempts + 1;
        setClientAttempts(nextCount);
        try {
          localStorage.setItem("hrp_client_attempts", String(nextCount));
        } catch {}

        // Ưu tiên remainingAttempts từ server, fallback sang client calculation
        const remaining =
          res.remainingAttempts !== undefined
            ? res.remainingAttempts
            : Math.max(0, MAX_ATTEMPTS - nextCount);

        setRemainingAttempts(remaining);

        if (remaining <= 0) {
          const until = Date.now() + LOCKOUT_SECONDS * 1000;
          try {
            localStorage.setItem("hrp_lockout_until", String(until));
          } catch {}
          setLockoutSecondsLeft(LOCKOUT_SECONDS);
          setError(
            "Bạn đã nhập sai 5 lần. Nút đăng nhập đã bị khóa trong 15 phút để bảo vệ tài khoản.",
          );
        } else {
          setError(
            res.error && res.error.includes("lần thử")
              ? res.error
              : `Email hoặc mật khẩu không chính xác. Bạn còn ${remaining} lần thử trước khi tài khoản bị tạm khóa.`,
          );
        }

        setIsLoading(false);
        return;
      }

      // Đăng nhập thành công -> xóa bỏ mọi trạng thái khóa
      try {
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

  const minutes = Math.floor(lockoutSecondsLeft / 60);
  const seconds = lockoutSecondsLeft % 60;

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Đăng nhập</CardTitle>
          <CardDescription>
            Dùng email và mật khẩu được cấp để truy cập hệ thống
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} noValidate>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="ten@hrpartner.vn"
                  required
                  disabled={isLoading || isLocked}
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
                    disabled={isLoading || isLocked}
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
                    disabled={isLocked}
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
                    isLocked
                      ? "bg-destructive/15 border-destructive/30 text-destructive"
                      : remainingAttempts !== undefined && remainingAttempts > 0
                        ? "bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200"
                        : "bg-destructive/15 border-destructive/20 text-destructive",
                  )}
                >
                  {isLocked ? (
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

              {/* Nút Đăng nhập - Sẽ bị KHÓA HOÀN TOÀN (disabled) khi sai 5 lần */}
              <Button
                type="submit"
                className={cn(
                  "w-full transition-all duration-200 font-semibold",
                  isLocked &&
                    "opacity-60 cursor-not-allowed bg-destructive/80 text-white hover:bg-destructive/80",
                )}
                disabled={isLoading || isLocked}
              >
                {isLoading
                  ? "Đang đăng nhập..."
                  : isLocked
                    ? `Đã khóa nút đăng nhập (${minutes}p ${seconds < 10 ? `0${seconds}` : seconds}s)`
                    : "Đăng nhập"}
              </Button>

              {/* Nếu đã bị khóa, cung cấp nút Đặt lại mật khẩu để mở khóa ngay */}
              {isLocked && (
                <Button
                  variant="outline"
                  asChild
                  className="w-full border-primary text-primary hover:bg-primary/5 font-semibold"
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
