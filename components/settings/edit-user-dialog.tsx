"use client";

import { Loader2, UserCog } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  USER_ROLE_LABELS,
  type UpdateUserInput,
  type UserRole,
} from "@schemas/user";

import { updateUserAction } from "@/app/(app)/settings/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ManagedUser } from "@/lib/services/users";

/**
 * Edit user — round 3, part 1.
 *
 * A user can have their role and active state changed. `fullName` is not
 * editable here: an admin who needs to rename another user has a different
 * (later) decision, and routing it through the same form would silently let a
 * UI bug mutate fields the database was not asked about.
 *
 * The service is the gate (it re-checks the admin role, enforces the same-org
 * rule, and refuses the last-admin demotion). The dialog is a form, not a
 * guard.
 */

type FormValues = {
  role: UserRole;
  isActive: boolean;
};

export function EditUserDialog({
  user,
  trigger,
}: {
  user: ManagedUser;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    // The dialog's local shape is { role, isActive }; userId is supplied by the
    // dialog itself when it builds the service payload. Resolving against a
    // smaller shape keeps the form values simple and stops the user from
    // editing the id.
    defaultValues: { role: user.role, isActive: user.isActive },
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setFormError(null);
      form.reset({ role: user.role, isActive: user.isActive });
    }
  }

  async function onSubmit(values: FormValues) {
    setFormError(null);

    const payload: UpdateUserInput = {
      userId: user.id,
      role: values.role !== user.role ? values.role : undefined,
      isActive: values.isActive !== user.isActive ? values.isActive : undefined,
    };

    if (payload.role === undefined && payload.isActive === undefined) {
      setFormError("Không có thay đổi nào để lưu");
      return;
    }

    setSaving(true);
    const result = await updateUserAction(payload);
    setSaving(false);

    if (!result.ok) {
      setFormError(result.message);
      return;
    }

    toast.success("Đã cập nhật người dùng");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            size="icon"
            data-testid="user-edit-button"
            aria-label="Sửa người dùng"
          >
            <UserCog className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md" data-testid="edit-user-dialog">
        <DialogHeader>
          <DialogTitle>Sửa người dùng</DialogTitle>
          <DialogDescription>
            {user.email ? <span className="font-mono text-xs">{user.email}</span> : "Người dùng hiện tại"}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vai trò</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={saving}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="edit-user-role">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(["user", "admin"] as const).map((value) => (
                        <SelectItem key={value} value={value}>
                          {USER_ROLE_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        id="editUserActive"
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                        disabled={saving}
                        data-testid="edit-user-active"
                      />
                    </FormControl>
                    <FormLabel htmlFor="editUserActive" className="cursor-pointer">
                      Đang hoạt động
                    </FormLabel>
                  </div>
                  <FormDescription>
                    Bỏ chọn để tạm khoá tài khoản. Người dùng sẽ bị chặn ở
                    mọi yêu cầu cho tới khi kích hoạt lại.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {formError && (
              <Alert variant="destructive" data-testid="edit-user-error">
                <AlertTitle>Không cập nhật được</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={saving}
                data-testid="edit-user-submit"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Lưu
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => handleOpenChange(false)}
              >
                Huỷ
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
