"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button, type ButtonProps } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

interface LogoutButtonProps {
  variant?: ButtonProps["variant"];
  className?: string;
}

export function LogoutButton({ variant = "default", className }: LogoutButtonProps = {}) {
  const router = useRouter();

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <Button
      variant={variant}
      className={className}
      onClick={logout}
      data-testid="logout-button"
    >
      <LogOut className="mr-2 h-4 w-4" />
      Đăng xuất
    </Button>
  );
}

