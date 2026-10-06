"use client";

import { UserCog } from "lucide-react";

import { EditUserDialog } from "@/components/settings/edit-user-dialog";
import { Button } from "@/components/ui/button";
import type { ManagedUser } from "@/lib/services/users";

/**
 * The rightmost column of the user-management table.
 *
 * Round 3, part 1 ships with edit (role / active state). The app intentionally
 * has no delete-user action: removing access is an owner decision, and the
 * service refuses to drop auth rows on the application's behalf. This file
 * used to render a Trash button next to Edit; that control is gone in this
 * revision.
 */
export function UserRowActions({ user }: { user: ManagedUser }) {
  return (
    <div className="flex justify-end gap-1">
      <EditUserDialog
        user={user}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            data-testid="user-edit-button"
            aria-label="Sửa người dùng"
          >
            <UserCog className="h-4 w-4" />
          </Button>
        }
      />
    </div>
  );
}
