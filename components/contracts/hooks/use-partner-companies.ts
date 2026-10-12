"use client";

import { useEffect, useRef, useState } from "react";
import { partnerCompanyRowsAction } from "@/app/(app)/partners/actions";
import type { Company } from "@/lib/services/partners";

/**
 * Custom hook to fetch and synchronize linked companies for the selected partner.
 */
export function usePartnerCompanies({
  partnerId,
  isEdit,
  defaultCompanyId,
  defaultCompanyName,
  currentCompanyId,
  onResetCompany,
}: {
  partnerId?: string;
  isEdit: boolean;
  defaultCompanyId?: string | null;
  defaultCompanyName?: string | null;
  currentCompanyId?: string;
  onResetCompany?: () => void;
}) {
  const [companyRows, setCompanyRows] = useState<Company[]>([]);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [companiesRetry, setCompaniesRetry] = useState(0);
  const [rowsPartnerId, setRowsPartnerId] = useState<string | null>(null);

  const onResetCompanyRef = useRef(onResetCompany);
  const currentCompanyIdRef = useRef(currentCompanyId);

  useEffect(() => {
    onResetCompanyRef.current = onResetCompany;
    currentCompanyIdRef.current = currentCompanyId;
  });

  // Đang tải khi đối tác đổi nhưng dữ liệu của đối tác mới chưa nạp xong
  const companiesLoading = Boolean(partnerId) && rowsPartnerId !== partnerId;

  useEffect(() => {
    // Chưa chọn đối tác → không gọi server
    if (!partnerId) return;

    let active = true;
    partnerCompanyRowsAction(partnerId)
      .then((result) => {
        if (!active) return;
        setRowsPartnerId(partnerId);

        if (!result.ok) {
          setCompanyRows([]);
          setCompaniesError(result.message || "Không tải được danh sách công ty");
          return;
        }
        setCompaniesError(null);
        let next = result.data;

        // Hợp đồng cũ có `company_id` không thuộc đối tác hiện tại: ghép thêm
        // một dòng {id, name} để Select hiển thị đúng nhãn.
        if (isEdit && defaultCompanyId) {
          const stillPresent = next.some((row) => row.id === defaultCompanyId);
          if (!stillPresent) {
            next = [
              ...next,
              { id: defaultCompanyId, name: defaultCompanyName ?? "" },
            ];
          }
        }

        setCompanyRows(next);

        // Nếu công ty đang chọn không còn thuộc danh sách mới → reset về ""
        if (
          currentCompanyIdRef.current &&
          !next.some((row) => row.id === currentCompanyIdRef.current)
        ) {
          onResetCompanyRef.current?.();
        }
      })
      .catch(() => {
        if (!active) return;
        setRowsPartnerId(partnerId);
        setCompanyRows([]);
        setCompaniesError("Không tải được danh sách công ty. Vui lòng thử lại.");
      });

    return () => {
      active = false;
    };
  }, [
    partnerId,
    companiesRetry,
    isEdit,
    defaultCompanyId,
    defaultCompanyName,
  ]);

  const retryCompanies = () => {
    setCompaniesError(null);
    setCompaniesRetry((n) => n + 1);
  };

  return {
    companyRows,
    companiesError,
    companiesLoading,
    retryCompanies,
  };
}
