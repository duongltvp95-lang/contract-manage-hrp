import { Skeleton } from "@/components/ui/skeleton";

/** Khung tải tức thì cho trang Nhật ký quản trị khi điều hướng từ menu. */
export default function AdminLogsLoading() {
  return (
    <div className="space-y-6 p-6" data-testid="route-loading-skeleton">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
