import { LogoutButton } from "@/components/logout-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Landing page for a signed-in but deactivated account.
 *
 * `requireUser()` redirects here when `profiles.is_active` is false. The route
 * lives under `/auth/*`, which the session proxy leaves public, so there is no
 * redirect loop: protected page -> /auth/disabled -> (logout) -> /login.
 */
export default function DisabledAccountPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">
              Tài khoản đã bị vô hiệu hoá
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Tài khoản của bạn hiện không được phép truy cập hệ thống. Vui lòng
              liên hệ quản trị viên để được mở lại.
            </p>
            <LogoutButton />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
