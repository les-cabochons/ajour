!include "LogicLib.nsh"

; Only the ordinary uninstall removes the optional CLI. An update keeps it.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    Call un.RemoveAjourCommand
  ${EndIf}
!macroend

Function un.RemoveAjourCommand
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R0
  Push $R1
  ReadEnvStr $8 "LOCALAPPDATA"
  StrCmp $8 "" done
  StrCpy $8 "$8\Ajour\bin"
  ; A binary with our name is the minimum ownership evidence. Never recurse
  ; outside this fixed folder, and never delete the CLI's connection/Undo data.
  IfFileExists "$8\ajour.exe" 0 done
  System::Call 'kernel32::GetFileAttributesW(w r8) i .r9'
  IntOp $9 $9 & 0x400
  StrCmp $9 0 0 done

  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w "Environment", i 0, i 0x20019, *p .r0) i .r9'
  StrCmp $9 0 0 deleteFolder
  ; Query the raw value into a bounded buffer. ERROR_MORE_DATA and every
  ; other read error skip the write, so a long Path can never be truncated.
  IntOp $2 ${NSIS_MAX_STRLEN} * 2
  System::Call 'advapi32::RegQueryValueExW(p r0, w "Path", p 0, *i .r3, t .r1, *i r2) i .r9'
  System::Call 'advapi32::RegCloseKey(p r0)'
  StrCmp $9 0 0 deleteFolder
  ${If} $3 != 1
  ${AndIf} $3 != 2
    Goto deleteFolder
  ${EndIf}
  ; Preserve every retained segment, including empty segments and spelling.
  StrCpy $4 ""
  StrCpy $5 ""
  StrCpy $6 0
  StrCpy $7 0
  StrCpy $R1 0
  scan:
    StrCpy $9 $1 1 $6
    StrCmp $9 ";" segment
    StrCmp $9 "" segment
    StrCpy $5 "$5$9"
    IntOp $6 $6 + 1
    Goto scan
  segment:
    StrCmp $5 $8 removed
    StrCmp $5 "$8\" removed
    ${If} $7 = 0
      StrCpy $4 $5
      StrCpy $7 1
    ${Else}
      StrCpy $4 "$4;$5"
    ${EndIf}
    Goto next
  removed:
    StrCpy $R1 1
  next:
    StrCpy $5 ""
    StrCmp $9 "" write
    IntOp $6 $6 + 1
    Goto scan
  write:
    StrCmp $R1 1 0 deleteFolder
    ClearErrors
    ${If} $3 = 2
      WriteRegExpandStr HKCU "Environment" "Path" $4
    ${Else}
      WriteRegStr HKCU "Environment" "Path" $4
    ${EndIf}
    IfErrors deleteFolder
    SendMessage 0xffff 0x001A 0 "STR:Environment" /TIMEOUT=5000
  deleteFolder:
    RMDir /r "$8"
  done:
  Pop $R1
  Pop $R0
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
