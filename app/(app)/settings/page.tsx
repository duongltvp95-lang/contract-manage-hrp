import { KeyRound } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { LogoutButton } from "@/components/logout-button";
import { AddUserDialog } from "@/components/settings/add-user-dialog";
import { ProfileForm } from "@/components/settings/profile-form";
import { UsersTable } from "@/components/settings/users-table";
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
import { listUsers } from "@/lib/services/users";
import { hasServiceRoleKey } from "@/lib/supabase/admin";

/**
 * Settings — plan section 71, W1-WEB-034.
 *
 * Four blocks: Profile (editable `full_name`), Organization (view-only in
 * Wave 1 — the owner decision for M7), User management (feature round 2, part 3,
 * administrators only) and the account actions (change password, logout).
 *
 * The organization name is read through a service rather than queried here, so
 * the session remains the only source of `organizationId` (plan section 2).
 *
 * The user-management block is decided on the SERVER and is not rendered at all
 * for a non-administrator — no hidden markup to find. The service checks the
 * role again, so hiding it is presentation, not protection.
 */

async function SettingsContent() {
  const user = await requireUser();
  const organization = await getOrganization(user.organizationId);

  const isAdmin = user.role === "admin";
  /*
   * Provisioning needs the service-role key, which is a server-side secret and
   * is NOT configured on Vercel yet (see the deployment notes for round 2). The
   * section still renders for an administrator and says what is missing, rather
   * than failing the whole Settings page with a stack trace.
   */
  const serviceReady = hasServiceRoleKey();
  const users =
    isAdmin && serviceReady
      ? await listUsers({ organizationId: user.organizationId })
      : null;

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

      {isAdmin ? (
        <Card data-testid="user-management-section">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Quản lý người dùng</CardTitle>
              <CardDescription>
                Thêm tài khoản cho tổ chức. Hệ thống không hỗ trợ xoá hay vô
                hiệu hoá người dùng từ giao diện; thay đổi trạng thái hoạt
                động thông qua nút Sửa.
              </CardDescription>
            </div>
            {serviceReady ? <AddUserDialog /> : null}
          </CardHeader>
          <CardContent>
            {!serviceReady ? (
              <Alert variant="destructive" data-testid="service-role-missing">
                <AlertTitle>Chưa cấu hình khoá quản trị</AlertTitle>
                <AlertDescription>
                  Máy chủ thiếu biến môi trường{" "}
                  <span className="font-mono text-xs">
                    SUPABASE_SERVICE_ROLE_KEY
                  </span>{" "}
                  nên chưa thể tạo hoặc liệt kê người dùng. Quản trị viên hệ
                  thống cần thêm biến này vào môi trường triển khai.
                </AlertDescription>
              </Alert>
            ) : users?.ok ? (
              <UsersTable rows={users.data} currentUserId={user.id} />
            ) : (
              <Alert variant="destructive">
                <AlertTitle>Không tải được danh sách người dùng</AlertTitle>
                <AlertDescription>
                  {users?.message ?? "Vui lòng thử lại sau."}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      ) : null}

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
