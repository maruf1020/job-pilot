' Runs ensure-workers.ps1 with no window, so the 5-minute check never flashes a console.
Set fso = CreateObject("Scripting.FileSystemObject")
script = fso.GetParentFolderName(WScript.ScriptFullName) & "\ensure-workers.ps1"
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & script & """", 0, False
