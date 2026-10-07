"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Loader2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { CreateUserSchema, type CreateUserInput } from "@schemas/user";

import { createUserAction } from "@/app/(app)/settings/actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CreatedUser } from "@/lib/services/users";

/**
 * Add User — feature round 2, part 3.
 *
 * The account is created by a server action that re-checks the administrator
 * role; this dialog is a form, not a guard.
 *
 * The temporary password is displayed exactly once, in place of the form, with a
 * copy button and a plain warning. It is never stored: not in the database, not
 * in a server log, and not in component state beyond this dialog's lifetime.
 */

const EMPTY_VALUES: CreateUserInput = {
  email: "",
  fullName: "",
  role: "user",
};

export function AddUserDialog({ trigger }: { trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedUser | null>(null);

  const form = useForm<CreateUserInput>({
    resolver: zodResolver(CreateUserSchema),
    defaultValues: EMPTY_VALUES,
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // The password goes away with the dialog, on purpose.
      setCreated(null);
      setFormError(null);
      form.reset(EMPTY_VALUES);
    }
  }

  async function onSubmit(values: CreateUserInput) {
    setFormError(null);
    setSaving(true);

    const result = await createUserAction(values);

    setSaving(false);

    if (!result.ok) {
      // Plan section 80: a readable Vietnamese message, never a raw stack trace.
      setFormError(result.message);
      return;
    }

    setCreated(result.data);
    toast.success("Đã tạo người dùng");
    router.refresh();
  }

  async function copyPassword() {
    if (!created) return;

    try {
      await navigator.clipboard.writeText(created.temporaryPassword);
      toast.success("Đã sao chép mật khẩu tạm");
    } catch {
      // Clipboard access can be refused; the password is on screen either way.
      toast.error("Không sao chép được. Hãy chọn và sao chép thủ công.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button data-testid="add-user-button">
            <UserPlus className="mr-2 h-4 w-4" />
            Thêm người dùng
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md" data-testid="add-user-dialog">
        <DialogHeader>
          <DialogTitle>
            {created ? "Đã tạo người dùng" : "Thêm người dùng"}
          </DialogTitle>
          <DialogDescription>
            {created
              ? "Gửi thông tin đăng nhập bên dưới cho người dùng."
              : "Tài khoản được tạo với mật khẩu tạm, hiển thị một lần sau khi lưu."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <Alert data-testid="temporary-password-warning">
              <AlertTitle>Mật khẩu tạm chỉ hiển thị một lần</AlertTitle>
              <AlertDescription>
                Hãy sao chép và lưu lại ngay. Đóng cửa sổ này là không xem lại
                được; nếu mất, bạn sẽ phải tạo lại tài khoản.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <p className="text-sm">
                <span className="text-muted-foreground">Email: </span>
                <span className="font-medium">{created.user.email}</span>
              </p>
              <div className="flex items-center gap-2">
                <code
                  className="min-w-0 flex-1 truncate rounded-xl bg-muted px-3 py-2 font-mono text-sm shadow-sm"
                  data-testid="temporary-password"
                >
                  {created.temporaryPassword}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyPassword}
                  data-testid="copy-temporary-password"
                >
                  <Copy className="mr-1 h-4 w-4" />
                  Sao chép
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Người dùng nên đổi mật khẩu sau lần đăng nhập đầu tiên.
              </p>
            </div>

            <Button
              type="button"
              onClick={() => handleOpenChange(false)}
              data-testid="close-temporary-password"
            >
              Đóng
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        id="newUserEmail"
                        type="email"
                        placeholder="ten@hrpartner.vn"
                        autoComplete="off"
                        disabled={saving}
                        data-testid="new-user-email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Họ tên</FormLabel>
                    <FormControl>
                      <Input
                        id="newUserFullName"
                        placeholder="VD: Nguyễn Văn A"
                        autoComplete="off"
                        disabled={saving}
                        data-testid="new-user-full-name"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                        <SelectTrigger id="newUserRole" data-testid="new-user-role">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="user">Người dùng</SelectItem>
                        <SelectItem value="admin">Quản trị viên</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Quản trị viên xem được toàn bộ hợp đồng và quản lý người
                      dùng của tổ chức.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {formError && (
                <Alert variant="destructive" data-testid="add-user-error">
                  <AlertTitle>Không tạo được người dùng</AlertTitle>
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}

              <div className="flex items-center gap-3">
                <Button
                  type="submit"
                  disabled={saving}
                  data-testid="add-user-submit"
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Tạo người dùng
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
        )}
      </DialogContent>
    </Dialog>
  );
}
