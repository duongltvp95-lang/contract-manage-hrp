import { USER_ROLE_LABELS } from "@schemas/user";

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

/**
 * Users table — feature round 2, part 3 + round 3, part 1.
 *
 * Họ tên · Email · Vai trò · Trạng thái · Ngày tạo · Thao tác. The last column
 * is the round 3 addition: edit role/active, delete with email re-confirmation.
 *
 * The "delete" button on the row of the signed-in user is replaced by a
 * disabled control with a Vietnamese tooltip: the service refuses a self-delete
 * too, but the UI should not offer a control that cannot succeed.
 *
 * A Server Component: only the dialogs and the action wrapper need the client.
 */
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
    <div className="rounded-md border">
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
            return (
              <TableRow
                key={row.id}
                data-testid="user-row"
                data-user-email={row.email ?? ""}
              >
                <TableCell className="font-medium">
                  {row.fullName ?? "—"}
                  {isSelf ? (
                    <span className="ml-2 text-xs text-muted-foreground">(bạn)</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.email ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={row.role === "admin" ? "default" : "secondary"}>
                    {USER_ROLE_LABELS[row.role]}
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
