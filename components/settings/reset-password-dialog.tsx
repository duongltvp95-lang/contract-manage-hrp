"use client";

import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { resetUserPasswordAction } from "@/app/(app)/settings/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ManagedUser } from "@/lib/services/users";

function generateSecurePassword(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  const array = new Uint32Array(14);
  crypto.getRandomValues(array);
  return Array.from(array, (x) => chars[x % chars.length]).join("") + "aA1!";
}

export function ResetPasswordDialog({
  user,
  trigger,
}: {
  user: ManagedUser;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(true);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Tự động tạo sẵn 1 mật khẩu mạnh khi mở dialog
      setPassword(generateSecurePassword());
      setShowPassword(true);
      setCopied(false);
      setError(null);
    } else {
      setPassword("");
      setError(null);
      setCopied(false);
    }
  }

  function handleGenerateNew() {
    setPassword(generateSecurePassword());
    setCopied(false);
    setError(null);
  }

  async function handleCopy() {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      toast.success("Đã sao chép mật khẩu vào bộ nhớ tạm");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Không thể sao chép tự động. Vui lòng chọn và sao chép thủ công.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanPassword = password.trim();

    if (!cleanPassword || cleanPassword.length < 6) {
      setError("Mật khẩu phải có ít nhất 6 ký tự.");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await resetUserPasswordAction({
      userId: user.id,
      password: cleanPassword,
    });

    setSaving(false);

    if (!res.ok) {
      setError(res.message);
      return;
    }

    toast.success(`Đã đặt lại mật khẩu thành công cho ${user.fullName || user.email}`);
    // Sao chép luôn vào clipboard để admin tiện gửi cho nhân viên
    try {
      await navigator.clipboard.writeText(cleanPassword);
      toast.info("Mật khẩu mới đã được sao chép vào bộ nhớ tạm");
    } catch {
      // ignore
    }

    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            size="icon"
            data-testid="user-reset-password-button"
            aria-label="Đặt lại mật khẩu"
          >
            <KeyRound className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md" data-testid="reset-password-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Đặt lại mật khẩu
          </DialogTitle>
          <DialogDescription>
            Cấp lại mật khẩu mới cho tài khoản{" "}
            <strong>{user.fullName || user.email}</strong>{" "}
            ({user.email})
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="new-password">Mật khẩu mới</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleGenerateNew}
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                Tạo ngẫu nhiên
              </Button>
            </div>

            <div className="relative flex items-center">
              <Input
                id="new-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setCopied(false);
                  if (error) setError(null);
                }}
                placeholder="Nhập hoặc tạo mật khẩu mới..."
                className="pr-20 font-mono text-sm"
                required
                autoComplete="off"
                spellCheck={false}
              />
              <div className="absolute right-1 flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onClick={handleCopy}
                  disabled={!password}
                  aria-label="Sao chép mật khẩu"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Mật khẩu tối thiểu 6 ký tự. Bạn có thể sao chép mật khẩu này để gửi cho người dùng sau khi lưu.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Không đặt lại được mật khẩu</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Huỷ
            </Button>
            <Button type="submit" disabled={saving || !password.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Lưu mật khẩu mới
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
