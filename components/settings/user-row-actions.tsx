"use client";

import { Trash2, UserCog } from "lucide-react";

import { DeleteUserDialog } from "@/components/settings/delete-user-dialog";
import { EditUserDialog } from "@/components/settings/edit-user-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ManagedUser } from "@/lib/services/users";

/**
 * The rightmost column of the user-management table — round 3 + round 4.
 *
 * Two icon buttons: edit (role / active state) and delete (hard remove).
 *
 * The signed-in user's own row keeps a disabled delete with a Vietnamese
 * tooltip. The service refuses a self-delete anyway, but offering a control
 * that cannot succeed is worse than not offering it. The same shape applies
 * to the row of the last remaining active admin: a delete is offered (with
 * the same disabled + tooltip), because the last-admin refusal is a runtime
 * rule, not a row state the UI can know about without re-implementing the
 * service. Round 4 chose to keep the button visible rather than hide it, on
 * the same principle: a "Xoá" button that fails the last-admin check tells
 * the admin why (the service message), and a hidden button is the kind of
 * "stale UI" we are trying to avoid.
 */
export function UserRowActions({
  user,
  isSelf,
}: {
  user: ManagedUser;
  isSelf: boolean;
}) {
  return (
    <TooltipProvider delayDuration={200}>
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
        {isSelf ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled
                data-testid="user-delete-button-self"
                aria-label="Không thể xoá chính mình"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Không thể xoá chính mình</TooltipContent>
          </Tooltip>
        ) : (
          <DeleteUserDialog
            user={user}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                data-testid="user-delete-button"
                aria-label="Xoá người dùng"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            }
          />
        )}
      </div>
    </TooltipProvider>
  );
}
