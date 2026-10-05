import { USER_ROLE_LABELS } from "@schemas/user";

import { AddUserDialog } from "@/components/settings/add-user-dialog";
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
 * Users table — feature round 2, part 3.
 *
 * Họ tên · Email · Vai trò · Trạng thái · Ngày tạo. There is no delete column
 * and no deactivate control: provisioning is the whole feature this round, and
 * removing access will be an owner decision made deliberately.
 *
 * A Server Component: only the Add dialog and its copy button need the client.
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
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-testid="user-row" data-user-email={row.email ?? ""}>
              <TableCell className="font-medium">
                {row.fullName ?? "—"}
                {row.id === currentUserId ? (
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        {rows.length} người dùng
      </p>
    </div>
  );
}
