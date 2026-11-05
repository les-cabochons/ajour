!include "LogicLib.nsh"

; Only the ordinary uninstall removes the optional CLI. An update keeps it.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    Call un.RemoveAjourCommand
  ${EndIf}
!macroend

!ifdef BUILD_UNINSTALLER

; Each directory must exist, be a directory and not be a reparse point.
; The caller closes this LogicLib If so guards can nest.
!macro AjourSafeDirectory DIR
  System::Call 'kernel32::GetFileAttributesW(w "${DIR}") i .r9'
  IntOp $9 $9 & 0x410
  ${If} $9 = 0x10
!macroend

; Checked against the release archive layout by installer-cli-command.test.ts.
!macro AjourArchiveDocs ROOT
  !insertmacro AjourSafeDirectory "${ROOT}\man"
    !insertmacro AjourSafeDirectory "${ROOT}\man\man1"
      Delete "${ROOT}\man\man1\ajour-add.1"
      Delete "${ROOT}\man\man1\ajour.1"
      Delete "${ROOT}\man\man1\ajour-completion.1"
      Delete "${ROOT}\man\man1\ajour-connect.1"
      Delete "${ROOT}\man\man1\ajour-continue.1"
      Delete "${ROOT}\man\man1\ajour-discard.1"
      Delete "${ROOT}\man\man1\ajour-dup.1"
      Delete "${ROOT}\man\man1\ajour-edit.1"
      Delete "${ROOT}\man\man1\ajour-help.1"
      Delete "${ROOT}\man\man1\ajour-log.1"
      Delete "${ROOT}\man\man1\ajour-move.1"
      Delete "${ROOT}\man\man1\ajour-projects.1"
      Delete "${ROOT}\man\man1\ajour-rm.1"
      Delete "${ROOT}\man\man1\ajour-start.1"
      Delete "${ROOT}\man\man1\ajour-status.1"
      Delete "${ROOT}\man\man1\ajour-stop.1"
      Delete "${ROOT}\man\man1\ajour-undo.1"
      RMDir "${ROOT}\man\man1"
    ${EndIf}
    RMDir "${ROOT}\man"
  ${EndIf}
  !insertmacro AjourSafeDirectory "${ROOT}\completions"
    Delete "${ROOT}\completions\ajour.bash"
    Delete "${ROOT}\completions\_ajour"
    Delete "${ROOT}\completions\ajour.fish"
    RMDir "${ROOT}\completions"
  ${EndIf}
!macroend

!macro AjourPayload ROOT
  Delete "${ROOT}\ajour.exe"
  !insertmacro AjourSafeDirectory "${ROOT}\share"
    !insertmacro AjourArchiveDocs "${ROOT}\share"
    RMDir "${ROOT}\share"
  ${EndIf}
!macroend

; The Linux build for WSL in bin\linux (#605), laid out as bin is. Distros
; aren't entered: their ~/.local/bin/ajour links stay, pointing at nothing.
!macro AjourLinuxPayload ROOT
  Delete "${ROOT}\ajour"
  !insertmacro AjourSafeDirectory "${ROOT}\share"
    !insertmacro AjourArchiveDocs "${ROOT}\share"
    RMDir "${ROOT}\share"
  ${EndIf}
!macroend

; Input $R5, output $R0. The controller uses lowercase hex 8-4-4-4-12.
Function un.AjourUuid
  StrCpy $R0 0
  StrLen $0 $R5
  StrCmp $0 36 0 uuidDone
  StrCpy $1 0
  uuidLoop:
    StrCpy $2 $R5 1 $1
    ${If} $1 = 8
    ${OrIf} $1 = 13
    ${OrIf} $1 = 18
    ${OrIf} $1 = 23
      StrCmpS $2 "-" 0 uuidDone
    ${Else}
      StrCpy $3 0
      uuidHex:
        StrCpy $4 "0123456789abcdef" 1 $3
        StrCmpS $4 "" uuidDone
        StrCmpS $2 $4 uuidNext
        IntOp $3 $3 + 1
        Goto uuidHex
    ${EndIf}
    uuidNext:
      IntOp $1 $1 + 1
      IntCmp $1 36 uuidValid uuidLoop uuidDone
  uuidValid:
    StrCpy $R0 1
  uuidDone:
FunctionEnd

; Input $R5, output $R0. Accept only the controller's Windows ZIP names and
; its Linux archive name for WSL.
Function un.AjourArchiveName
  StrCpy $R0 0
  StrCpy $0 $R5 6
  StrCmpS $0 "ajour-" 0 archiveDone
  StrCpy $0 $R5 "" -16
  StrCmpS $0 "-windows-x64.zip" archiveX64
  StrCpy $0 $R5 "" -17
  StrCmpS $0 "-linux-x64.tar.gz" archiveLinux
  StrCpy $0 $R5 "" -18
  StrCmpS $0 "-windows-arm64.zip" 0 archiveDone
  StrCpy $1 18
  Goto archiveVersion
  archiveLinux:
    StrCpy $1 17
    Goto archiveVersion
  archiveX64:
    StrCpy $1 16
  archiveVersion:
    StrLen $0 $R5
    IntOp $0 $0 - $1
    IntCmp $0 6 archiveDone archiveDone
    StrCpy $1 6
  archiveLoop:
    StrCpy $2 $R5 1 $1
    StrCpy $3 0
    archiveCharacter:
      StrCpy $4 "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-+" 1 $3
      StrCmpS $4 "" archiveDone
      StrCmpS $2 $4 archiveNext
      IntOp $3 $3 + 1
      Goto archiveCharacter
    archiveNext:
      IntOp $1 $1 + 1
      IntCmp $1 $0 archiveValid archiveLoop archiveDone
  archiveValid:
    StrCpy $R0 1
  archiveDone:
FunctionEnd

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
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  ReadEnvStr $8 "LOCALAPPDATA"
  StrCmp $8 "" done
  StrCpy $8 "$8\Ajour\bin"
  ; Registry cleanup must also run when the executable is missing.

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
    ReadEnvStr $R2 "LOCALAPPDATA"
    !insertmacro AjourSafeDirectory "$R2\Ajour"
      !insertmacro AjourSafeDirectory "$8"
        !insertmacro AjourPayload "$8"
        !insertmacro AjourSafeDirectory "$8\linux"
          !insertmacro AjourLinuxPayload "$8\linux"
          RMDir "$8\linux"
        ${EndIf}
        FindFirst $R3 $R4 "$8\*"
        leftovers:
          StrCmp $R4 "" leftoversDone
          StrCpy $0 $R4 14
          StrCmpS $0 "ajour.exe.old-" 0 checkShare
            StrCpy $R5 $R4 "" 14
            Call un.AjourUuid
            StrCmp $R0 1 0 nextLeftover
            Delete "$8\$R4"
            Goto nextLeftover
          checkShare:
            StrCpy $0 $R4 10
            StrCmpS $0 "share.old-" 0 checkLinux
            StrCpy $R5 $R4 "" 10
            Call un.AjourUuid
            StrCmp $R0 1 0 nextLeftover
            !insertmacro AjourSafeDirectory "$8\$R4"
              !insertmacro AjourArchiveDocs "$8\$R4"
              RMDir "$8\$R4"
            ${EndIf}
            Goto nextLeftover
          checkLinux:
            StrCpy $0 $R4 10
            StrCmpS $0 "linux.old-" 0 checkStaging
            StrCpy $R5 $R4 "" 10
            Call un.AjourUuid
            StrCmp $R0 1 0 nextLeftover
            !insertmacro AjourSafeDirectory "$8\$R4"
              !insertmacro AjourLinuxPayload "$8\$R4"
              RMDir "$8\$R4"
            ${EndIf}
            Goto nextLeftover
          checkStaging:
            StrCpy $0 $R4 9
            StrCmpS $0 ".staging-" 0 checkPending
            StrCpy $R5 $R4 "" 9
            Call un.AjourUuid
            StrCmp $R0 1 0 nextLeftover
            !insertmacro AjourSafeDirectory "$8\$R4"
              !insertmacro AjourPayload "$8\$R4"
              !insertmacro AjourSafeDirectory "$8\$R4\unpacked"
                !insertmacro AjourPayload "$8\$R4\unpacked"
                !insertmacro AjourLinuxPayload "$8\$R4\unpacked"
                !insertmacro AjourArchiveDocs "$8\$R4\unpacked"
                RMDir "$8\$R4\unpacked"
              ${EndIf}
              FindFirst $R1 $R5 "$8\$R4\*"
              stagingArchives:
                StrCmp $R5 "" stagingArchivesDone
                Call un.AjourArchiveName
                StrCmp $R0 1 0 nextStagingArchive
                Delete "$8\$R4\$R5"
                nextStagingArchive:
                  FindNext $R1 $R5
                  Goto stagingArchives
              stagingArchivesDone:
                FindClose $R1
              ; Unknown entries keep the directory nonempty and stay untouched.
              RMDir "$8\$R4"
            ${EndIf}
            Goto nextLeftover
          checkPending:
            StrCpy $0 $R4 9
            StrCmpS $0 ".pending-" 0 nextLeftover
            StrCpy $R5 $R4 36 9
            StrCpy $0 $R4 "" 45
            StrCmpS $0 ".json" pendingUuid
            StrCmpS $0 ".json.tmp" 0 nextLeftover
          pendingUuid:
            Call un.AjourUuid
            StrCmp $R0 1 0 nextLeftover
            Delete "$8\$R4"
          nextLeftover:
            FindNext $R3 $R4
            Goto leftovers
        leftoversDone:
        FindClose $R3
        RMDir "$8"
      ${EndIf}
    ${EndIf}
    ReadEnvStr $R2 "APPDATA"
    StrCmp $R2 "" done
    !insertmacro AjourSafeDirectory "$R2\Ajour"
      Delete "$R2\Ajour\cli-command.json"
      Delete "$R2\Ajour\cli-command.json.tmp"
    ${EndIf}
  done:
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
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
!endif
