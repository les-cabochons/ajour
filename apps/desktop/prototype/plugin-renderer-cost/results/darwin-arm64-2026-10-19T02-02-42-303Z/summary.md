# Plugin renderer cost (PROTOTYPE, #230/#260)

```json
{
  "platform": "darwin",
  "release": "25.6.0",
  "osVersion": "Darwin Kernel Version 25.6.0: Fri Jul 31 19:18:48 PDT 2026; root:xnu-12377.161.14~5/RELEASE_ARM64_T6020",
  "cpu": "Apple M2 Pro",
  "logicalCpus": 12,
  "totalMemoryGB": 32,
  "nodeArch": "arm64",
  "electronBinary": "/Users/a.trepanier/Repos/Personnal/ajour/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
  "os": "ProductName: macOS ProductVersion: 26.6.2 BuildVersion: 25G83",
  "hardware": "Mac14,10"
}
```

| Measure (median of runs) | 1 plugin | 4 plugins | 8 plugins |
| --- | --- | --- | --- |
| Runs | 5 | 5 | 5 |
| Launch to all first answers (ms) | 378 | 372 | 357 |
| View create to first answer, median plugin (ms) | 133 | 128 | 123 |
| View create to first answer, slowest plugin (ms) | 133 | 160 | 135 |
| First call round trip (ms) | 1.01 | 0.89 | 0.86 |
| Warm call, sequential, median (ms) | 0.058 | 0.085 | 0.088 |
| Warm call, sequential, p95 (ms) | 0.106 | 0.139 | 0.112 |
| Warm call, all plugins at once, median (ms) | 0.057 | 0.141 | 0.193 |
| Renderer working set, getAppMetrics (MB) | 85 | 85.1 | 85.2 |
| Renderer working set, OS (MB) | 85 | 85.1 | 85.2 |
| Renderer private bytes, getAppMetrics (MB) | null | null | null |
| Renderer private bytes, OS (MB) | null | null | null |
| Browser + GPU + utility working set (MB) | 249.3 | 262.8 | 276.6 |
| Whole app working set, getAppMetrics (MB) | 334.3 | 603.3 | 958 |
| Whole app working set, OS (MB) | 334.3 | 603.3 | 958 |
| Renderer footprint, macOS (MB) | 17.3 | 17.5 | 17.5 |
| Browser + GPU + utility footprint, macOS (MB) | 55.8 | 68.3 | 79.1 |
| Whole app footprint, macOS (MB) | 73.2 | 138.4 | 219 |
| Any process translated by Rosetta | false | false | false |
| Per-call renderer: create to first answer (ms) | 74 | 72 | 73 |
| Per-call renderer: close to process exit (ms) | 10 | 6 | 6 |
| app.quit() to main exit (ms) | 28 | 41 | 33 |
| Distinct renderer PIDs per run | 1,1,1,1,1 | 4,4,4,4,4 | 8,8,8,8,8 |
| Spike processes left 5 s after quit | 0,0,0,0,0 | 0,0,0,0,0 | 0,0,0,0,0 |

## quit
```json
[
  {
    "mode": "quit",
    "plugins": 8,
    "mainPid": 49933,
    "knownPids": 11,
    "quitToExitMs": 35.9,
    "exit": {
      "code": 0,
      "signal": null
    },
    "whileRunning": {
      "count": 11,
      "takenMs": "637.3-716.8",
      "types": [
        "browser:49933",
        "gpu-process:50041",
        "utility:50044",
        "renderer:50070",
        "renderer:50076",
        "renderer:50077",
        "renderer:50080",
        "renderer:50084",
        "renderer:50085",
        "renderer:50086",
        "renderer:50087"
      ]
    },
    "whileRunningWhy": [
      "browser:recorded-pid+user-data-dir",
      "gpu-process:recorded-pid+child-of-recorded-pid+user-data-dir",
      "utility:recorded-pid+child-of-recorded-pid+user-data-dir",
      "renderer:recorded-pid+child-of-recorded-pid+user-data-dir"
    ],
    "probeWhileRunning": [
      "alive"
    ],
    "lastRecordedPidGoneAfterMainMs": 0.1,
    "deadAfterMainMs": "browser:49933=0.1 gpu-process:50041=0.1 utility:50044=0.1 renderer:50070=0.1 renderer:50076=0.1 renderer:50077=0.1 renderer:50080=0.1 renderer:50084=0.1 renderer:50085=0.1 renderer:50086=0.1 renderer:50087=0.1",
    "afterCrash": null,
    "afterEnd": {
      "count": 0,
      "takenMs": "0.1-47",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "4999.6-5064.3",
      "types": []
    },
    "leftovers": [],
    "problems": []
  },
  {
    "mode": "quit",
    "plugins": 8,
    "mainPid": 50924,
    "knownPids": 11,
    "quitToExitMs": 51.2,
    "exit": {
      "code": 0,
      "signal": null
    },
    "whileRunning": {
      "count": 11,
      "takenMs": "506.3-556.1",
      "types": [
        "browser:50924",
        "gpu-process:50930",
        "utility:50931",
        "renderer:50938",
        "renderer:50939",
        "renderer:50940",
        "renderer:50941",
        "renderer:50942",
        "renderer:50943",
        "renderer:50944",
        "renderer:50945"
      ]
    },
    "whileRunningWhy": [
      "browser:recorded-pid+user-data-dir",
      "gpu-process:recorded-pid+child-of-recorded-pid+user-data-dir",
      "utility:recorded-pid+child-of-recorded-pid+user-data-dir",
      "renderer:recorded-pid+child-of-recorded-pid+user-data-dir"
    ],
    "probeWhileRunning": [
      "alive"
    ],
    "lastRecordedPidGoneAfterMainMs": 0.1,
    "deadAfterMainMs": "browser:50924=0.1 gpu-process:50930=0.1 utility:50931=0.1 renderer:50938=0.1 renderer:50939=0.1 renderer:50940=0.1 renderer:50941=0.1 renderer:50942=0.1 renderer:50943=0.1 renderer:50944=0.1 renderer:50945=0.1",
    "afterCrash": null,
    "afterEnd": {
      "count": 0,
      "takenMs": "0.2-48.4",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5000.4-5057.7",
      "types": []
    },
    "leftovers": [],
    "problems": []
  },
  {
    "mode": "quit",
    "plugins": 8,
    "mainPid": 51114,
    "knownPids": 11,
    "quitToExitMs": 36.4,
    "exit": {
      "code": 0,
      "signal": null
    },
    "whileRunning": {
      "count": 11,
      "takenMs": "423.3-476.4",
      "types": [
        "browser:51114",
        "gpu-process:51115",
        "utility:51116",
        "renderer:51117",
        "renderer:51118",
        "renderer:51119",
        "renderer:51120",
        "renderer:51121",
        "renderer:51122",
        "renderer:51123",
        "renderer:51124"
      ]
    },
    "whileRunningWhy": [
      "browser:recorded-pid+user-data-dir",
      "gpu-process:recorded-pid+child-of-recorded-pid+user-data-dir",
      "utility:recorded-pid+child-of-recorded-pid+user-data-dir",
      "renderer:recorded-pid+child-of-recorded-pid+user-data-dir"
    ],
    "probeWhileRunning": [
      "alive"
    ],
    "lastRecordedPidGoneAfterMainMs": 0.1,
    "deadAfterMainMs": "browser:51114=0.1 gpu-process:51115=0.1 utility:51116=0.1 renderer:51117=0.1 renderer:51118=0.1 renderer:51119=0.1 renderer:51120=0.1 renderer:51121=0.1 renderer:51122=0.1 renderer:51123=0.1 renderer:51124=0.1",
    "afterCrash": null,
    "afterEnd": {
      "count": 0,
      "takenMs": "0.1-47.8",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5001-5071.9",
      "types": []
    },
    "leftovers": [],
    "problems": []
  }
]
```

## kill
```json
[
  {
    "mode": "kill",
    "plugins": 8,
    "mainPid": 51215,
    "knownPids": 11,
    "killOutput": "kill -9 sent",
    "exit": {
      "code": null,
      "signal": "SIGKILL"
    },
    "whileRunning": {
      "count": 11,
      "takenMs": "334-382",
      "types": [
        "browser:51215",
        "gpu-process:51216",
        "utility:51217",
        "renderer:51222",
        "renderer:51223",
        "renderer:51224",
        "renderer:51225",
        "renderer:51227",
        "renderer:51228",
        "renderer:51229",
        "renderer:51231"
      ]
    },
    "whileRunningWhy": [
      "browser:recorded-pid+user-data-dir",
      "gpu-process:recorded-pid+child-of-recorded-pid+user-data-dir",
      "utility:recorded-pid+child-of-recorded-pid+user-data-dir",
      "renderer:recorded-pid+child-of-recorded-pid+user-data-dir"
    ],
    "killCommandMs": 9.2,
    "probeWhileRunning": [
      "alive"
    ],
    "lastRecordedPidGoneAfterMainMs": 22.3,
    "deadAfterMainMs": "browser:51215=0 gpu-process:51216=0 utility:51217=0 renderer:51222=22.3 renderer:51223=22.3 renderer:51224=22.3 renderer:51225=22.3 renderer:51227=22.3 renderer:51228=22.3 renderer:51229=22.3 renderer:51231=22.3",
    "afterCrash": null,
    "afterEnd": {
      "count": 8,
      "takenMs": "0-48.7",
      "types": [
        "browser:51222",
        "browser:51223",
        "browser:51224",
        "browser:51225",
        "browser:51227",
        "browser:51228",
        "browser:51229",
        "browser:51231"
      ]
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5000.3-5058.4",
      "types": []
    },
    "leftovers": [],
    "problems": []
  },
  {
    "mode": "kill",
    "plugins": 8,
    "mainPid": 51879,
    "knownPids": 11,
    "killOutput": "kill -9 sent",
    "exit": {
      "code": null,
      "signal": "SIGKILL"
    },
    "whileRunning": {
      "count": 11,
      "takenMs": "358.6-419.6",
      "types": [
        "browser:51879",
        "gpu-process:51880",
        "utility:51881",
        "renderer:51882",
        "renderer:51883",
        "renderer:51884",
        "renderer:51885",
        "renderer:51886",
        "renderer:51887",
        "renderer:51888",
        "renderer:51889"
      ]
    },
    "whileRunningWhy": [
      "browser:recorded-pid+user-data-dir",
      "gpu-process:recorded-pid+child-of-recorded-pid+user-data-dir",
      "utility:recorded-pid+child-of-recorded-pid+user-data-dir",
      "renderer:recorded-pid+child-of-recorded-pid+user-data-dir"
    ],
    "killCommandMs": 14.1,
    "probeWhileRunning": [
      "alive"
    ],
    "lastRecordedPidGoneAfterMainMs": 0,
    "deadAfterMainMs": "browser:51879=0 gpu-process:51880=0 utility:51881=0 renderer:51882=0 renderer:51883=0 renderer:51884=0 renderer:51885=0 renderer:51886=0 renderer:51887=0 renderer:51888=0 renderer:51889=0",
    "afterCrash": null,
    "afterEnd": {
      "count": 11,
      "takenMs": "0-48.2",
      "types": [
        "browser:51879",
        "browser:51880",
        "browser:51881",
        "browser:51882",
        "browser:51883",
        "browser:51884",
        "browser:51885",
        "browser:51886",
        "browser:51887",
        "browser:51888",
        "browser:51889"
      ]
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5001.4-5072.5",
      "types": []
    },
    "leftovers": [],
    "problems": []
  },
  {
    "mode": "kill",
    "plugins": 8,
    "mainPid": 52318,
    "knownPids": 11,
    "killOutput": "kill -9 sent",
    "exit": {
      "code": null,
      "signal": "SIGKILL"
    },
    "whileRunning": {
      "count": 11,
      "takenMs": "364.2-426.2",
      "types": [
        "browser:52318",
        "gpu-process:52319",
        "utility:52320",
        "renderer:52321",
        "renderer:52322",
        "renderer:52323",
        "renderer:52324",
        "renderer:52325",
        "renderer:52326",
        "renderer:52328",
        "renderer:52329"
      ]
    },
    "whileRunningWhy": [
      "browser:recorded-pid+user-data-dir",
      "gpu-process:recorded-pid+child-of-recorded-pid+user-data-dir",
      "utility:recorded-pid+child-of-recorded-pid+user-data-dir",
      "renderer:recorded-pid+child-of-recorded-pid+user-data-dir"
    ],
    "killCommandMs": 12.3,
    "probeWhileRunning": [
      "alive"
    ],
    "lastRecordedPidGoneAfterMainMs": 20.4,
    "deadAfterMainMs": "browser:52318=0 gpu-process:52319=0 utility:52320=0 renderer:52321=20.4 renderer:52322=20.4 renderer:52323=20.4 renderer:52324=20.4 renderer:52325=20.4 renderer:52326=20.4 renderer:52328=20.4 renderer:52329=20.4",
    "afterCrash": null,
    "afterEnd": {
      "count": 11,
      "takenMs": "0-48.9",
      "types": [
        "browser:52318",
        "browser:52319",
        "browser:52320",
        "browser:52321",
        "browser:52322",
        "browser:52323",
        "browser:52324",
        "browser:52325",
        "browser:52326",
        "browser:52328",
        "browser:52329"
      ]
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5000.8-5043.2",
      "types": []
    },
    "leftovers": [],
    "problems": []
  }
]
```

## crash
```json
[
  {
    "mode": "crash",
    "plugins": 8,
    "mainPid": 52896,
    "knownPids": 12,
    "quitToExitMs": 44.3,
    "exit": {
      "code": 0,
      "signal": null
    },
    "whileRunning": null,
    "whileRunningWhy": [],
    "probeWhileRunning": [],
    "lastRecordedPidGoneAfterMainMs": 0.1,
    "deadAfterMainMs": "browser:52896=0.1 gpu-process:52897=0.1 utility:52898=0.1 Tab:52899=0.1 renderer:52900=0.1 renderer:52901=0.1 renderer:52902=0.1 renderer:52903=0.1 renderer:52904=0.1 renderer:52905=0.1 renderer:52906=0.1 ?:53335=0.1",
    "afterCrash": {
      "count": 10,
      "takenMs": "366.5-420.3",
      "types": [
        "browser:52896",
        "gpu-process:52897",
        "utility:52898",
        "renderer:52900",
        "renderer:52901",
        "renderer:52902",
        "renderer:52903",
        "renderer:52904",
        "renderer:52905",
        "renderer:52906"
      ]
    },
    "afterEnd": {
      "count": 0,
      "takenMs": "0.2-62.9",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5000.9-5073",
      "types": []
    },
    "leftovers": [],
    "crash": {
      "reason": "killed",
      "exitCode": 2,
      "crashToGoneEventMs": 7.458,
      "crashToProcessExitMs": 7.575,
      "victimPidInOsList": false,
      "othersAnswered": 7,
      "others": 7,
      "victimCall": "Error: plugin-1 is not waiting.",
      "restartToFirstAnswerMs": 108.385,
      "restartSharing": {
        "distinctPids": 8,
        "plugins": 8,
        "shared": []
      }
    },
    "problems": []
  },
  {
    "mode": "crash",
    "plugins": 8,
    "mainPid": 54512,
    "knownPids": 12,
    "quitToExitMs": 53.6,
    "exit": {
      "code": 0,
      "signal": null
    },
    "whileRunning": null,
    "whileRunningWhy": [],
    "probeWhileRunning": [],
    "lastRecordedPidGoneAfterMainMs": 0.1,
    "deadAfterMainMs": "browser:54512=0.1 gpu-process:54513=0.1 utility:54514=0.1 Tab:54515=0.1 renderer:54516=0.1 renderer:54517=0.1 renderer:54518=0.1 renderer:54519=0.1 renderer:54520=0.1 renderer:54521=0.1 renderer:54522=0.1 ?:54926=0.1",
    "afterCrash": {
      "count": 10,
      "takenMs": "381-437.1",
      "types": [
        "browser:54512",
        "gpu-process:54513",
        "utility:54514",
        "renderer:54516",
        "renderer:54517",
        "renderer:54518",
        "renderer:54519",
        "renderer:54520",
        "renderer:54521",
        "renderer:54522"
      ]
    },
    "afterEnd": {
      "count": 0,
      "takenMs": "0.2-59.6",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5000.8-5053.9",
      "types": []
    },
    "leftovers": [],
    "crash": {
      "reason": "killed",
      "exitCode": 2,
      "crashToGoneEventMs": 6.584,
      "crashToProcessExitMs": 6.696,
      "victimPidInOsList": false,
      "othersAnswered": 7,
      "others": 7,
      "victimCall": "Error: plugin-1 is not waiting.",
      "restartToFirstAnswerMs": 112.978,
      "restartSharing": {
        "distinctPids": 8,
        "plugins": 8,
        "shared": []
      }
    },
    "problems": []
  },
  {
    "mode": "crash",
    "plugins": 8,
    "mainPid": 54962,
    "knownPids": 12,
    "quitToExitMs": 30,
    "exit": {
      "code": 0,
      "signal": null
    },
    "whileRunning": null,
    "whileRunningWhy": [],
    "probeWhileRunning": [],
    "lastRecordedPidGoneAfterMainMs": 0,
    "deadAfterMainMs": "browser:54962=0 gpu-process:54965=0 utility:54966=0 Tab:54967=0 renderer:54968=0 renderer:54969=0 renderer:54970=0 renderer:54971=0 renderer:54972=0 renderer:54973=0 renderer:54974=0 ?:55505=0",
    "afterCrash": {
      "count": 10,
      "takenMs": "375.5-430.6",
      "types": [
        "browser:54962",
        "gpu-process:54965",
        "utility:54966",
        "renderer:54968",
        "renderer:54969",
        "renderer:54970",
        "renderer:54971",
        "renderer:54972",
        "renderer:54973",
        "renderer:54974"
      ]
    },
    "afterEnd": {
      "count": 0,
      "takenMs": "0.2-52.1",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5000.1-5045.6",
      "types": []
    },
    "leftovers": [],
    "crash": {
      "reason": "killed",
      "exitCode": 2,
      "crashToGoneEventMs": 6.904,
      "crashToProcessExitMs": 7.039,
      "victimPidInOsList": false,
      "othersAnswered": 7,
      "others": 7,
      "victimCall": "Error: plugin-1 is not waiting.",
      "restartToFirstAnswerMs": 88.28,
      "restartSharing": {
        "distinctPids": 8,
        "plugins": 8,
        "shared": []
      }
    },
    "problems": []
  }
]
```

## sharing stress
```json
[
  {
    "processLimit": "1",
    "sharedPartition": false,
    "sameSiteIds": false,
    "plugins": 8,
    "sharing": {
      "distinctPids": 8,
      "plugins": 8,
      "shared": []
    },
    "problems": []
  },
  {
    "processLimit": "1",
    "sharedPartition": true,
    "sameSiteIds": false,
    "plugins": 8,
    "sharing": {
      "distinctPids": 8,
      "plugins": 8,
      "shared": []
    },
    "problems": []
  },
  {
    "processLimit": "1",
    "sharedPartition": false,
    "sameSiteIds": true,
    "plugins": 8,
    "sharing": {
      "distinctPids": 8,
      "plugins": 8,
      "shared": []
    },
    "problems": []
  },
  {
    "processLimit": "1",
    "sharedPartition": true,
    "sameSiteIds": true,
    "plugins": 8,
    "sharing": {
      "distinctPids": 8,
      "plugins": 8,
      "shared": []
    },
    "problems": []
  }
]
```
