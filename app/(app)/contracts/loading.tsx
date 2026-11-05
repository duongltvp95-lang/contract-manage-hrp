import { ContractsTableSkeleton } from "@/components/contracts/contracts-table-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/** Khung tải tức thì cho trang Hợp đồng khi điều hướng từ menu. */
export default function ContractsLoading() {
  return (
    <div className="space-y-6 p-4 sm:p-6 md:p-8" data-testid="route-loading-skeleton">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>

      <Skeleton className="h-10 w-full max-w-2xl rounded-xl" />
      <Skeleton className="h-9 w-full max-w-sm rounded-md" />
      <ContractsTableSkeleton />
    </div>
  );
}
