"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { UpdateProfileSchema, type UpdateProfileInput } from "@schemas/profile";

import { updateProfileAction } from "@/app/(app)/settings/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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

/**
 * Profile form — plan section 71, W1-WEB-034.
 *
 * The only editable field in Wave 1 (owner decision for M7). Email is shown but
 * not editable: it belongs to Supabase Auth, and changing it needs a
 * confirmation flow that is out of scope.
 *
 * `full_name` is the only column the database grants UPDATE on, so a stray field
 * could not be persisted even if this form sent one.
 */
export function ProfileForm({
  initialFullName,
  email,
  role,
}: {
  initialFullName: string;
  email: string | null;
  role: "admin" | "user";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(UpdateProfileSchema),
    defaultValues: { fullName: initialFullName },
  });

  async function onSubmit(values: UpdateProfileInput) {
    setPending(true);
    setError(null);

    const result = await updateProfileAction(values);

    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    toast.success("Đã cập nhật hồ sơ");
    // Re-sync with what the database actually stored (trimmed, authoritative).
    form.reset({ fullName: result.data.fullName ?? "" });
    router.refresh();
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Họ và tên</FormLabel>
              <FormControl>
                <Input
                  placeholder="VD: Nguyễn Văn A"
                  disabled={pending}
                  data-testid="profile-full-name"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Tên này hiển thị trên thanh điều hướng và trang tổng quan.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-1">
          <p className="text-sm font-medium">Email</p>
          <p className="text-sm text-muted-foreground" data-testid="profile-email">
            {email ?? "—"}
          </p>
          <p className="text-xs text-muted-foreground">
            Email không sửa được ở đây vì thuộc tài khoản đăng nhập.
          </p>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">Vai trò</p>
          <p className="text-sm text-muted-foreground">
            {role === "admin" ? "Quản trị viên" : "Người dùng"}
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Không lưu được hồ sơ</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={pending} data-testid="profile-submit">
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Lưu thay đổi
        </Button>
      </form>
    </Form>
  );
}
