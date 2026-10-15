# scripts/fix-workspace-acl.ps1
#
# Script gỡ bỏ ACL Deny trên các thư mục .next, .next-test, .next-e2e (P0)
# Giúp Next.js dev server, build và test suite chạy mượt mà không bị lỗi EPERM.
#
# Cách sử dụng trong PowerShell:
#   .\scripts\fix-workspace-acl.ps1

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [HRP Contract Manager] Khởi chạy gỡ ACL Deny thư mục .next" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$targets = @(".next", ".next-test", ".next-e2e")

foreach ($dir in $targets) {
    if (Test-Path $dir) {
        Write-Host "[+] Đang xử lý quyền cho: $dir ..." -ForegroundColor Yellow
        try {
            # Gỡ bỏ các cờ Deny (nếu có)
            & icacls "$dir" /remove:d Everyone /T /C | Out-Null
            & icacls "$dir" /grant "${env:USERNAME}:(F)" /T /C | Out-Null
            
            # Dọn dẹp thư mục cũ để tạo mới hoàn toàn sạch sẽ
            Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "[OK] Đã dọn dẹp và cấp quyền sạch cho: $dir" -ForegroundColor Green
        } catch {
            Write-Warning "[-] Không thể xóa hoàn toàn $dir: $_"
        }
    } else {
        Write-Host "[i] Thư mục $dir không tồn tại hoặc đã được dọn sạch." -ForegroundColor Gray
    }
}

Write-Host "`n[HOÀN TẤT] Hệ thống đã sẵn sàng cho dev/build/test!" -ForegroundColor Green
