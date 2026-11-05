import { PartnersTableSkeleton } from "@/components/partners/partners-table-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Khung tải tức thì cho trang Đối tác khi điều hướng từ menu. */
export default function PartnersLoading() {
  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8" data-testid="route-loading-skeleton">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </div>

      <PartnersTableSkeleton />
    </div>
  );
}
