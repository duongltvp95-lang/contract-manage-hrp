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
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { loginAction } from "@/app/login/actions";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setRemainingAttempts(undefined);

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
        setError(res.error);
        setRemainingAttempts(res.remainingAttempts);
        setIsLoading(false);
        return;
      }

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
                    remainingAttempts !== undefined && remainingAttempts > 0
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200"
                      : "bg-destructive/15 border-destructive/20 text-destructive",
                  )}
                >
                  <div className="space-y-1 w-full">
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
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Đang đăng nhập..." : "Đăng nhập"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
