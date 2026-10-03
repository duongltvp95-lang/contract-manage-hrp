import { KeyRound } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { LogoutButton } from "@/components/logout-button";
import { ProfileForm } from "@/components/settings/profile-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth";
import { getOrganization } from "@/lib/services/organizations";

/**
 * Settings — plan section 71, W1-WEB-034.
 *
 * Three blocks: Profile (editable `full_name`), Organization (view-only in
 * Wave 1 — the owner decision for M7) and the account actions (change password,
 * logout).
 *
 * The organization name is read through a service rather than queried here, so
 * the session remains the only source of `organizationId` (plan section 2).
 */

async function SettingsContent() {
  const user = await requireUser();
  const organization = await getOrganization(user.organizationId);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Cài đặt</h1>
        <p className="text-sm text-muted-foreground">
          Hồ sơ, tổ chức và bảo mật tài khoản.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Hồ sơ cá nhân</CardTitle>
          <CardDescription>Sửa tên hiển thị của bạn.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            initialFullName={user.fullName ?? ""}
            email={user.email}
            role={user.role}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tổ chức</CardTitle>
          <CardDescription>
            Thông tin tổ chức chỉ được hiển thị ở Wave 1.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {organization.ok ? (
            <>
              <p className="font-medium" data-testid="organization-name">
                {organization.data.name}
              </p>
              <p className="text-muted-foreground">
                Mã tổ chức:{" "}
                <span className="font-mono text-xs">{organization.data.id}</span>
              </p>
            </>
          ) : (
            <Alert variant="destructive">
              <AlertTitle>Không đọc được thông tin tổ chức</AlertTitle>
              <AlertDescription>{organization.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bảo mật</CardTitle>
          <CardDescription>Đổi mật khẩu đăng nhập của bạn.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <Link href="/auth/update-password" data-testid="change-password-link">
              <KeyRound className="mr-2 h-4 w-4" />
              Đổi mật khẩu
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Phiên đăng nhập</CardTitle>
          <CardDescription>Đăng xuất khỏi thiết bị này.</CardDescription>
        </CardHeader>
        <CardContent>
          <LogoutButton />
        </CardContent>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-64" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </div>
  );
}
