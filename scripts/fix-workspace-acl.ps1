# scripts/fix-workspace-acl.ps1
#
# Script gỡ bỏ ACL Deny trên các thư mục .next, .next-test, .next-e2e (P0)
# Giúp Next.js dev server, build và test suite chạy mượt mà không bị lỗi EPERM.

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " [HRP Contract Manager] Khoi chay go ACL Deny thu muc .next" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$targets = @(".next", ".next-test", ".next-e2e")

foreach ($dir in $targets) {
    if (Test-Path $dir) {
        Write-Host "[+] Dang xu ly quyen cho: $dir ..." -ForegroundColor Yellow
        try {
            # Chiếm quyền sở hữu nếu bị lệch user SID
            & takeown /F "$dir" /R /D Y 2>$null | Out-Null
            
            # Gỡ bỏ các cờ Deny và cấp Full Control
            & icacls "$dir" /remove:d Everyone /T /C 2>$null | Out-Null
            & icacls "$dir" /grant "${env:USERNAME}:(F)" /T /C 2>$null | Out-Null
            
            # Dọn dẹp thư mục để tạo mới sạch sẽ
            Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "[OK] Da don dep va cap quyen sach cho: $dir" -ForegroundColor Green
        } catch {
            Write-Warning "[-] Khong the don dep $dir : $($_.Exception.Message)"
        }
    } else {
        Write-Host "[i] Thu muc $dir khong ton tai (da duoc don sach se)." -ForegroundColor Gray
    }
}

Write-Host "`n[HOAN TAT] He thong da sach se va san sang cho dev/build/test!" -ForegroundColor Green
