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
import { isOwnerEmail, isOwnerUserId } from "@/lib/owner";
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
      ? await listUsers()
      : null;

  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Cài đặt</h1>
        <p className="text-sm text-muted-foreground">
          Hồ sơ cá nhân, đơn vị tổ chức và bảo mật tài khoản.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Card className="h-full flex flex-col justify-between">
            <CardHeader>
              <CardTitle>Hồ sơ cá nhân</CardTitle>
              <CardDescription>Sửa tên hiển thị và xem thông tin tài khoản của bạn.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1">
              <ProfileForm
                initialFullName={user.fullName ?? ""}
                email={user.email}
                role={user.role}
              />
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-5 flex flex-col gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Tổ chức</CardTitle>
              <CardDescription>
                Thông tin đơn vị quản lý hợp đồng.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {organization.ok ? (
                <div className="rounded-lg border bg-muted/30 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Tên đơn vị:</span>
                    <span className="font-semibold text-foreground" data-testid="organization-name">
                      {organization.data.name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Mã tổ chức:</span>
                    <span className="font-mono text-xs text-muted-foreground bg-background px-2 py-0.5 rounded border">
                      {organization.data.id}
                    </span>
                  </div>
                </div>
              ) : (
                <Alert variant="destructive">
                  <AlertTitle>Không đọc được thông tin tổ chức</AlertTitle>
                  <AlertDescription>{organization.message}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Bảo mật & Đăng nhập</CardTitle>
              <CardDescription>Đổi mật khẩu truy cập và kết thúc phiên làm việc.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <Button variant="outline" asChild className="h-10 justify-center">
                  <Link href="/auth/update-password" data-testid="change-password-link">
                    <KeyRound className="mr-2 h-4 w-4" />
                    Đổi mật khẩu
                  </Link>
                </Button>
                <LogoutButton variant="outline" className="h-10 justify-center" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {isAdmin ? (
        <Card data-testid="user-management-section" className="w-full">
          <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle>Quản lý người dùng</CardTitle>
              <CardDescription>
                Thêm tài khoản cho tổ chức. Hệ thống hỗ trợ{" "}
                <strong className="text-foreground">vô hiệu hoá</strong> (giữ row) và{" "}
                <strong className="text-foreground">xoá hẳn</strong> user (chỉ quản trị viên, không thể
                xoá chính mình hoặc quản trị viên cuối cùng của tổ chức).
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
              <UsersTable
                rows={users.data}
                currentUserId={user.id}
                isCurrentUserOwner={isOwnerUserId(user.id) || isOwnerEmail(user.email)}
              />
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
    <div className="space-y-6 p-4 sm:p-6 md:p-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Skeleton className="h-[360px] w-full rounded-xl" />
        </div>
        <div className="lg:col-span-5 flex flex-col gap-6">
          <Skeleton className="h-[160px] w-full rounded-xl" />
          <Skeleton className="h-[160px] w-full rounded-xl" />
        </div>
      </div>
      <Skeleton className="h-[280px] w-full rounded-xl" />
    </div>
  );
}

