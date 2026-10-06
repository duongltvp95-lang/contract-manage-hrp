"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { DeleteUserSchema, type DeleteUserInput } from "@schemas/user";

import { deleteUserAction } from "@/app/(app)/settings/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import type { ManagedUser } from "@/lib/services/users";
/**
 * Delete user — round 4, part 1.
 *
 * A destructive dialog: the admin has to type the user's email again to
 * confirm. The service re-checks the match server-side, so a stale form value
 * cannot bypass it. The dialog itself is a form, not a guard.
 *
 * Two outcomes depend on the service:
 *   - 403 "Bạn không thể xoá chính mình" — the form already disables the
 *     button on the self row, but the service is the source of truth.
 *   - 403 "Không thể ... quản trị viên cuối cùng" — the last-admin guard.
 *
 * Round 3 had a tombstone dialog "Hệ thống không hỗ trợ xoá user" that
 * round 4 reverts. The visual shape of the destructive dialog is unchanged
 * from the round 3 pre-revert design: the same `data-testid`s, the same
 * typed-confirmation field, the same submit button. Tests written before
 * round 3 still apply.
 */

const EMPTY_VALUES: DeleteUserInput = {
  userId: "",
  confirmEmail: "",
};

export function DeleteUserDialog({
  user,
  trigger,
}: {
  user: ManagedUser;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<DeleteUserInput>({
    resolver: zodResolver(DeleteUserSchema),
    defaultValues: { ...EMPTY_VALUES, userId: user.id },
  });

  const typedEmail = useWatch({ control: form.control, name: "confirmEmail" })?.trim() ?? "";
  const expectedEmail = (user.email ?? "").trim();
  // The button is enabled when the typed email matches the user's email
  // (case-insensitive, trimmed on both sides, the same way the service does
  // its own final check). The user's own email is what the admin is being
  // asked to re-type, so an empty value keeps the button disabled.
  const canSubmit =
    expectedEmail.length > 0 &&
    typedEmail.toLowerCase() === expectedEmail.toLowerCase();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setFormError(null);
      form.reset({ ...EMPTY_VALUES, userId: user.id });
    }
  }

  async function onSubmit(values: DeleteUserInput) {
    setFormError(null);
    setDeleting(true);

    const result = await deleteUserAction(values);

    setDeleting(false);

    if (!result.ok) {
      setFormError(result.message);
      return;
    }

    toast.success("Đã xoá người dùng");
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
            data-testid="user-delete-button"
            aria-label="Xoá người dùng"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md" data-testid="delete-user-dialog">
        <DialogHeader>
          <DialogTitle>Xoá người dùng</DialogTitle>
          <DialogDescription>
            Hành động này xoá vĩnh viễn tài khoản khỏi hệ thống. Không thể
            hoàn tác.
          </DialogDescription>
        </DialogHeader>

        <Alert variant="destructive" data-testid="delete-user-warning">
          <AlertTitle>Sắp xoá {user.fullName ?? user.email}</AlertTitle>
          <AlertDescription>
            Hợp đồng do người dùng này tạo sẽ được giữ lại, chỉ ghi nhận tác
            giả thành ẩn danh. Nhật ký hoạt động cũng được giữ lại làm bằng
            chứng.
          </AlertDescription>
        </Alert>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="confirmEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Nhập chính xác email{" "}
                    <span className="font-mono text-xs">
                      {expectedEmail || "(không rõ email)"}
                    </span>{" "}
                    để xác nhận
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="off"
                      disabled={deleting}
                      data-testid="delete-user-confirm-email"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Xác nhận giúp tránh xoá nhầm qua thao tác nhầm.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {formError && (
              <Alert variant="destructive" data-testid="delete-user-error">
                <AlertTitle>Không xoá được người dùng</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="flex items-center gap-3">
              <Button
                type="submit"
                variant="destructive"
                disabled={deleting || !canSubmit}
                data-testid="delete-user-submit"
              >
                {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Xoá người dùng
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={deleting}
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
