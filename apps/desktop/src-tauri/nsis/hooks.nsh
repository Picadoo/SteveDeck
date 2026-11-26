; SteveDeck NSIS 安装/卸载钩子
; 解决 Windows 覆盖更新/卸载时内置引擎进程占用 engine-bundle 导致「文件正在使用」报错：
;  1) 精准结束新版专属进程名 stevedeck-engine.exe（绝不误杀用户机器上的系统 node.exe）；
;  2) 兼容从旧版（<= v0.1.3，内置引擎名为 node.exe）原地升级：仅当 $INSTDIR\engine-bundle\node.exe
;     存在时，按可执行路径前缀精准结束该目录下的进程并清理旧二进制。
!macro STEVEDECK_STOP_ENGINE ID
  nsExec::Exec `taskkill /F /IM stevedeck-engine.exe`
  IfFileExists "$INSTDIR\engine-bundle\node.exe" 0 stevedeck_skip_legacy_${ID}
    nsExec::Exec `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "$$dir = '$INSTDIR\engine-bundle\'; Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$dir, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Delete "$INSTDIR\engine-bundle\node.exe"
  stevedeck_skip_legacy_${ID}:
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro STEVEDECK_STOP_ENGINE preinstall
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro STEVEDECK_STOP_ENGINE preuninstall
!macroend
