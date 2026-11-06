# Brings the clean Chrome window (storage/browser/clean-profile) to the front. Windows does not let a
# background program (the worker) raise a window it starts: on 2 Nov 2026 "open a new separate chrome"
# opened it behind his other windows and looked like nothing happened. Minimize + restore + foreground
# is the reliable way to raise it.
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class JfWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
'@
for ($i = 0; $i -lt 20; $i++) {
  $ids = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'clean-profile' } | ForEach-Object { $_.ProcessId })
  $win = Get-Process -Id $ids | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($win) {
    $h = $win.MainWindowHandle
    [JfWin]::ShowWindow($h, 6) | Out-Null   # minimize
    [JfWin]::ShowWindow($h, 9) | Out-Null   # restore
    [JfWin]::BringWindowToTop($h) | Out-Null
    [JfWin]::SetForegroundWindow($h) | Out-Null
    exit 0
  }
  Start-Sleep -Milliseconds 500
}
exit 1
