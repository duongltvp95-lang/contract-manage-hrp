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
import { Badge } from "@/components/ui/badge";
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
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-sm font-medium">Họ và tên</FormLabel>
              <FormControl>
                <Input
                  placeholder="VD: Nguyễn Văn A"
                  disabled={pending}
                  data-testid="profile-full-name"
                  className="h-10"
                  {...field}
                />
              </FormControl>
              <FormDescription className="text-xs text-muted-foreground">
                Tên này hiển thị trên thanh điều hướng và trang tổng quan.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-1.5">
          <label className="text-sm font-medium leading-none">
            Email tài khoản
          </label>
          <div className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
            <span data-testid="profile-email" className="font-medium text-foreground">
              {email ?? "—"}
            </span>
            <span className="text-xs rounded px-2 py-0.5 bg-background border text-muted-foreground font-medium">
              Chỉ đọc
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Email liên kết với tài khoản Supabase Auth dùng để đăng nhập hệ thống.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium leading-none">
            Vai trò hệ thống
          </label>
          <div className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge
                variant={role === "admin" ? "default" : "secondary"}
                className="font-medium"
              >
                {role === "admin" ? "Quản trị viên" : "Người dùng"}
              </Badge>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {role === "admin"
                  ? "Toàn quyền quản trị và phân quyền tổ chức"
                  : "Xem và thao tác các hợp đồng được giao"}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Vai trò xác định phạm vi phân quyền và các chức năng được phép truy cập.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertTitle>Không lưu được hồ sơ</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="pt-1">
          <Button
            type="submit"
            disabled={pending}
            data-testid="profile-submit"
            className="h-10 px-5 font-medium"
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Lưu thay đổi
          </Button>
        </div>
      </form>
    </Form>
  );
}

