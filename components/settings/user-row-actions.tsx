"use client";

import { KeyRound, Trash2, UserCog } from "lucide-react";

import { isOwnerEmail, isOwnerUserId } from "@/lib/owner";
import { DeleteUserDialog } from "@/components/settings/delete-user-dialog";
import { EditUserDialog } from "@/components/settings/edit-user-dialog";
import { ResetPasswordDialog } from "@/components/settings/reset-password-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ManagedUser } from "@/lib/services/users";

export function UserRowActions({
  user,
  isSelf,
  isCurrentUserOwner = false,
}: {
  user: ManagedUser;
  isSelf: boolean;
  isCurrentUserOwner?: boolean;
}) {
  const isOwner = isOwnerEmail(user.email) || isOwnerUserId(user.id);

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
        {isCurrentUserOwner ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <ResetPasswordDialog
                  user={user}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      data-testid="user-reset-password-button"
                      aria-label="Đặt lại mật khẩu"
                    >
                      <KeyRound className="h-4 w-4 text-primary" />
                    </Button>
                  }
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>Đặt lại mật khẩu</TooltipContent>
          </Tooltip>
        ) : null}
        {isOwner ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled
                data-testid="user-delete-button-owner"
                aria-label="Không thể xoá tài khoản Quản trị viên tối cao"
              >
                <Trash2 className="h-4 w-4 text-muted-foreground/50" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Không thể xoá tài khoản Quản trị viên tối cao</TooltipContent>
          </Tooltip>
        ) : isSelf ? (
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
