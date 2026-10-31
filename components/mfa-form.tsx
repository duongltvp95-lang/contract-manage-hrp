"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { beginMfaEnrollmentAction, verifyMfaAction, type MfaEnrollment } from "@/app/auth/mfa/actions";
import type { MfaState } from "@/lib/mfa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function MfaForm({ initialState }: { initialState: MfaState }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [factorId, setFactorId] = useState(initialState.factors[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const verify = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        const result = await verifyMfaAction({ factorId: enrollment?.factorId ?? factorId, code });
        if (!result.ok) { setError(result.message); return; }
        setEnrollment(null);
        setCode("");
        router.replace("/settings");
        router.refresh();
      } catch { setError("Kết nối bị gián đoạn. Vui lòng thử lại."); }
    });
  };
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center p-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Bảo mật 2FA</CardTitle>
          <CardDescription>Các thao tác quản trị và xóa dữ liệu yêu cầu mã từ ứng dụng xác thực.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {initialState.verified ? (
            <p role="status">Phiên này đã xác thực hai bước. <Link className="underline" href="/settings">Quay lại Cài đặt</Link></p>
          ) : <>
            {initialState.factors.length === 0 && !enrollment && (
              <Button disabled={pending} onClick={() => {
                setError("");
                startTransition(async () => {
                  try {
                    const result = await beginMfaEnrollmentAction();
                    if (result.ok) setEnrollment(result.data);
                    else setError(result.message);
                  } catch { setError("Không thể kết nối. Vui lòng thử lại."); }
                });
              }}>{pending ? "Đang chuẩn bị..." : "Thiết lập ứng dụng xác thực"}</Button>
            )}
            {enrollment && <div className="space-y-3">
              <p>Quét mã QR bằng Google Authenticator, Microsoft Authenticator hoặc ứng dụng tương thích, rồi nhập mã OTP.</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- provider-generated QR, kept in memory only */}
              <img alt="Mã QR thiết lập xác thực hai bước" width={220} height={220}
                src={enrollment.qrCode.startsWith("data:") ? enrollment.qrCode : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.qrCode)}`} />
              <details><summary className="cursor-pointer text-sm underline">Nhập khóa thủ công</summary>
                <code className="break-all text-sm">{enrollment.secret}</code>
              </details>
            </div>}
            {(enrollment || initialState.factors.length > 0) && <form onSubmit={verify} className="space-y-3">
              {initialState.factors.length > 1 && <div className="space-y-2">
                <Label htmlFor="mfa-factor">Ứng dụng xác thực</Label>
                <select id="mfa-factor" value={factorId} onChange={(event) => setFactorId(event.target.value)}
                  className="w-full rounded-md border bg-background p-2">
                  {initialState.factors.map((factor) => <option key={factor.id} value={factor.id}>{factor.name}</option>)}
                </select>
              </div>}
              <Label htmlFor="mfa-code">Mã OTP 6 chữ số</Label>
              <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
                minLength={6} maxLength={6} required value={code} disabled={pending}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
              <Button type="submit" disabled={pending}>{pending ? "Đang xác thực..." : "Xác thực và tiếp tục"}</Button>
            </form>}
          </>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Link className="block text-sm underline" href="/dashboard">Về trang tổng quan</Link>
        </CardContent>
      </Card>
    </main>
  );
}
