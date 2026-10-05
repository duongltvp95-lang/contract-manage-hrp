import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Partners table placeholder while the server list streams in (plan section 81). */
export function PartnersTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tên đối tác</TableHead>
            <TableHead className="text-center">Số hợp đồng</TableHead>
            <TableHead>Cập nhật lúc</TableHead>
            <TableHead className="text-right">Thao tác</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, index) => (
            <TableRow key={index}>
              <TableCell>
                <Skeleton className="h-4 w-56" />
              </TableCell>
              <TableCell className="text-center">
                <Skeleton className="mx-auto h-4 w-6" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell className="text-right">
                <Skeleton className="ml-auto h-8 w-24" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
