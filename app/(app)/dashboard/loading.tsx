import { Skeleton } from "@/components/ui/skeleton";

/** Khung tải tức thì cho trang Tổng quan khi điều hướng từ menu. */
export default function DashboardLoading() {
  return (
    <div className="space-y-6 p-6" data-testid="route-loading-skeleton">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-[7.5rem] rounded-xl" />
        ))}
      </div>

      <Skeleton className="h-56 rounded-2xl" />
      <Skeleton className="h-56 rounded-2xl" />
      <Skeleton className="h-56 rounded-2xl" />
    </div>
  );
}
