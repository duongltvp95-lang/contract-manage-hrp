import { USER_ROLE_LABELS } from "@schemas/user";

import { isOwnerEmail, isOwnerUserId } from "@/lib/owner";
import { AddUserDialog } from "@/components/settings/add-user-dialog";
import { UserRowActions } from "@/components/settings/user-row-actions";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import type { ManagedUser } from "@/lib/services/users";

export function UsersTable({
  rows,
  currentUserId,
}: {
  rows: ManagedUser[];
  currentUserId: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Chưa có người dùng"
        description="Thêm người dùng đầu tiên cho tổ chức."
        action={<AddUserDialog />}
      />
    );
  }

  return (
    <div className="rounded-xl shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Họ tên</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Vai trò</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead>Ngày tạo</TableHead>
            <TableHead className="w-[120px] text-right">Thao tác</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isSelf = row.id === currentUserId;
            const isOwner = isOwnerEmail(row.email) || isOwnerUserId(row.id);
            return (
              <TableRow
                key={row.id}
                data-testid="user-row"
                data-user-email={row.email ?? ""}
              >
                <TableCell className="font-medium">
                  {row.fullName ?? "—"}
                  {isOwner ? (
                    <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10">
                      Owner
                    </Badge>
                  ) : null}
                  {isSelf ? (
                    <span className="ml-2 text-xs text-muted-foreground">(bạn)</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.email ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={row.role === "admin" ? "default" : "secondary"}>
                    {isOwner ? "Quản trị viên (Owner)" : USER_ROLE_LABELS[row.role]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={row.isActive ? "outline" : "secondary"}>
                    {row.isActive ? "Hoạt động" : "Đã vô hiệu hoá"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDateTime(row.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <UserRowActions user={row} isSelf={isSelf} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        {rows.length} người dùng
      </p>
    </div>
  );
}
