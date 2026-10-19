# Plugin renderer cost (PROTOTYPE, #230/#260)

```json
{
  "platform": "win32",
  "release": "10.0.26200",
  "osVersion": "Windows 11 Home",
  "cpu": "AMD Ryzen 7 5800X 8-Core Processor             ",
  "logicalCpus": 16,
  "totalMemoryGB": 31.9,
  "nodeArch": "x64",
  "electronBinary": "C:\\Users\\alext\\Repos\\harday\\.claude\\worktrees\\agent-a7ae0a9265c18514c\\node_modules\\electron\\dist\\electron.exe",
  "os": "Microsoft Windows 11 Home",
  "version": "10.0.26200",
  "build": "26200",
  "cores": 8,
  "threads": 16
}
```

## backgroundThrottling off
```json
{
  "on": {
    "runs": 5,
    "succeeded": 5,
    "launchToFirstAnswerMs": 308,
    "viewColdMedianMs": 104,
    "viewColdMaxMs": 122,
    "firstCallMs": 1.09,
    "warmMedianMs": 0.175,
    "warmP95Ms": 0.226,
    "concurrentMedianMs": 0.214,
    "concurrentRoundMedianMs": 0.242,
    "rendererWorkingSetMB": 65.9,
    "rendererPrivateMB": 27.6,
    "osRendererWorkingSetMB": 65.9,
    "osRendererPrivateMB": 27.6,
    "nonRendererWorkingSetMB": 235.2,
    "totalWorkingSetMB": 500.8,
    "osTotalWorkingSetMB": 500.8,
    "perCallCreateMs": 56,
    "perCallCloseToExitMs": 8,
    "quitToExitMs": 152,
    "distinctRendererPidsEveryRun": [
      4,
      4,
      4,
      4,
      4
    ],
    "sharedPidsAnyRun": false,
    "sandboxedEveryRun": true,
    "integrityLevels": "untrusted",
    "processTypes": "Browser,GPU,Tab,Tab,Tab,Tab,Utility",
    "leftoversAfterQuit": [
      0,
      0,
      0,
      0,
      0
    ]
  },
  "off": {
    "runs": 5,
    "succeeded": 5,
    "launchToFirstAnswerMs": 295,
    "viewColdMedianMs": 101,
    "viewColdMaxMs": 118,
    "firstCallMs": 0.99,
    "warmMedianMs": 0.165,
    "warmP95Ms": 0.215,
    "concurrentMedianMs": 0.209,
    "concurrentRoundMedianMs": 0.236,
    "rendererWorkingSetMB": 65.9,
    "rendererPrivateMB": 27.6,
    "osRendererWorkingSetMB": 65.9,
    "osRendererPrivateMB": 27.6,
    "nonRendererWorkingSetMB": 235.2,
    "totalWorkingSetMB": 500.9,
    "osTotalWorkingSetMB": 501,
    "perCallCreateMs": 57,
    "perCallCloseToExitMs": 8,
    "quitToExitMs": 152,
    "distinctRendererPidsEveryRun": [
      4,
      4,
      4,
      4,
      4
    ],
    "sharedPidsAnyRun": false,
    "sandboxedEveryRun": true,
    "integrityLevels": "untrusted",
    "processTypes": "Browser,GPU,Tab,Tab,Tab,Tab,Utility",
    "leftoversAfterQuit": [
      0,
      0,
      0,
      0,
      0
    ]
  }
}
```
