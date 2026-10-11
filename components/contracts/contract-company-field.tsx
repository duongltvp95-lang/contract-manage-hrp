"use client";

import type { Control } from "react-hook-form";
import type { CreateContractInput } from "@schemas/contract";
import type { Company } from "@/lib/services/partners";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Company selector field for the contract form, linked dynamically to the chosen partner.
 */
export function ContractCompanyField({
  control,
  partnerId,
  companyRows,
  companiesError,
  companiesLoading,
  onRetry,
  busy,
  isEdit,
  hasError,
}: {
  control: Control<CreateContractInput>;
  partnerId?: string;
  companyRows: Company[];
  companiesError: string | null;
  companiesLoading: boolean;
  onRetry: () => void;
  busy: boolean;
  isEdit: boolean;
  hasError: boolean;
}) {
  return (
    <FormField
      control={control}
      name="companyId"
      rules={{
        validate: (value) => {
          // Hợp đồng MỚI bắt buộc chọn công ty (quyết định Owner round 33+).
          // Hợp đồng CŨ (tạo trước round 33, `company_id IS NULL`) vẫn sửa được.
          if (isEdit) return true;
          return value && value.length > 0 ? true : "Vui lòng chọn công ty";
        },
      }}
      render={({ field }) => {
        const noPartnerChosen = !partnerId;
        const partnerHasNoCompany =
          !companiesError &&
          !noPartnerChosen &&
          !companiesLoading &&
          companyRows.length === 0;

        // Loading: Select hiển thị nhưng disabled
        const selectDisabled =
          busy || noPartnerChosen || companiesLoading || partnerHasNoCompany;

        return (
          <FormItem>
            <FormLabel>Công ty</FormLabel>
            {companiesError ? (
              <Alert
                variant="destructive"
                data-testid="contract-companies-error"
              >
                <AlertTitle>Không tải được danh sách công ty</AlertTitle>
                <AlertDescription className="flex items-center gap-2">
                  <span>{companiesError}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onRetry}
                    data-testid="contract-companies-retry"
                  >
                    Thử lại
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <Select
                  value={field.value ?? ""}
                  onValueChange={field.onChange}
                  disabled={selectDisabled}
                >
                  <FormControl>
                    <SelectTrigger
                      id="companyId"
                      data-testid="contract-company-select"
                      aria-invalid={hasError ? true : undefined}
                    >
                      <SelectValue placeholder="Chọn công ty" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {(companiesLoading ? [] : companyRows).map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {noPartnerChosen ? (
                  <FormDescription data-testid="contract-companies-hint">
                    Hãy chọn đối tác trước để xem công ty được liên kết.
                  </FormDescription>
                ) : companiesLoading ? (
                  <FormDescription data-testid="contract-companies-loading">
                    Đang tải danh sách công ty…
                  </FormDescription>
                ) : partnerHasNoCompany ? (
                  <FormDescription data-testid="contract-companies-hint">
                    Đối tác này chưa được gán công ty. Hãy gán công ty cho
                    đối tác ở trang Đối tác.
                  </FormDescription>
                ) : null}
              </>
            )}
            <FormDescription>
              {isEdit
                ? "Công ty ký hợp đồng. Hợp đồng cũ chưa có công ty vẫn sửa được."
                : "Chọn công ty ký hợp đồng."}
            </FormDescription>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
