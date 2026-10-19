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

| Measure (median of runs) | 1 plugin | 4 plugins | 8 plugins |
| --- | --- | --- | --- |
| Runs | 5 | 5 | 5 |
| Launch to all first answers (ms) | 308 | 302 | 358 |
| View create to first answer, median plugin (ms) | 104 | 104 | 137 |
| View create to first answer, slowest plugin (ms) | 104 | 121 | 162 |
| First call round trip (ms) | 0.98 | 1.09 | 1.4 |
| Warm call, sequential, median (ms) | 0.172 | 0.168 | 0.173 |
| Warm call, sequential, p95 (ms) | 0.226 | 0.216 | 0.224 |
| Warm call, all plugins at once, median (ms) | 0.166 | 0.214 | 0.266 |
| Renderer working set, getAppMetrics (MB) | 66.8 | 66 | 66 |
| Renderer working set, OS (MB) | 66.8 | 66 | 66 |
| Renderer private bytes, getAppMetrics (MB) | 27.7 | 27.6 | 27.6 |
| Renderer private bytes, OS (MB) | 27.7 | 27.6 | 27.6 |
| Browser + GPU + utility working set (MB) | 220.8 | 235.8 | 247.3 |
| Whole app working set, getAppMetrics (MB) | 287.3 | 501.8 | 777.5 |
| Whole app working set, OS (MB) | 287.3 | 501.8 | 777.6 |
| Per-call renderer: create to first answer (ms) | 58 | 55 | 62 |
| Per-call renderer: close to process exit (ms) | 18 | 8 | 14 |
| app.quit() to main exit (ms) | 143 | 149 | 162 |
| Distinct renderer PIDs per run | 1,1,1,1,1 | 4,4,4,4,4 | 8,8,8,8,8 |
| Spike processes left 5 s after quit | 0,0,0,0,0 | 0,0,0,0,0 | 0,0,0,0,0 |

## quit
```json
[
  {
    "mode": "quit",
    "plugins": 8,
    "mainPid": 28996,
    "knownPids": 11,
    "quitToExitMs": 152.8,
    "exit": {
      "code": 0,
      "signal": null
    },
    "whileRunning": {
      "count": 11,
      "takenMs": "353.6-5380.8",
      "types": [
        "browser:28996",
        "gpu-process:287736",
        "utility:5036",
        "renderer:274240",
        "renderer:290752",
        "renderer:292204",
        "renderer:264808",
        "renderer:281816",
        "renderer:274508",
        "renderer:30736",
        "renderer:26820"
      ]
    },
    "whileRunningWhy": [
      "browser:recorded-pid+user-data-dir",
      "gpu-process:child-of-recorded-pid+user-data-dir",
      "utility:recorded-pid+child-of-recorded-pid+user-data-dir",
      "renderer:recorded-pid+child-of-recorded-pid+user-data-dir"
    ],
    "probeWhileRunning": [
      "alive"
    ],
    "lastRecordedPidGoneAfterMainMs": 0.1,
    "deadAfterMainMs": "utility:5036=0.1 renderer:26820=0.1 browser:28996=0.1 renderer:30736=0.1 renderer:264808=0.1 renderer:274240=0.1 renderer:274508=0.1 renderer:281816=0.1 gpu-process:287736=0.1 renderer:290752=0.1 renderer:292204=0.1",
    "afterCrash": null,
    "afterEnd": {
      "count": 0,
      "takenMs": "0.2-5043.6",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5043.6-10187.6",
      "types": []
    },
    "leftovers": [],
    "problems": []
  },
  {
    "mode": "quit",
    "plugins": 8,
    "mainPid": 289864,
    "knownPids": 11,
    "quitToExitMs": 154.3,
    "exit": {
      "code": 0,
      "signal": null
    },
    "whileRunning": {
      "count": 11,
      "takenMs": "364.4-5932",
      "types": [
        "browser:289864",
        "gpu-process:292220",
        "utility:4708",
        "renderer:283612",
        "renderer:23916",
        "renderer:270432",
        "renderer:5268",
        "renderer:286652",
        "renderer:274676",
        "renderer:286600",
        "renderer:289052"
      ]
    },
    "whileRunningWhy": [
      "browser:recorded-pid+user-data-dir",
      "gpu-process:child-of-recorded-pid+user-data-dir",
      "utility:recorded-pid+child-of-recorded-pid+user-data-dir",
      "renderer:recorded-pid+child-of-recorded-pid+user-data-dir"
    ],
    "probeWhileRunning": [
      "alive"
    ],
    "lastRecordedPidGoneAfterMainMs": 0.1,
    "deadAfterMainMs": "utility:4708=0.1 renderer:5268=0.1 renderer:23916=0.1 renderer:270432=0.1 renderer:274676=0.1 renderer:283612=0.1 renderer:286600=0.1 renderer:286652=0.1 renderer:289052=0.1 browser:289864=0.1 gpu-process:292220=0.1",
    "afterCrash": null,
    "afterEnd": {
      "count": 0,
      "takenMs": "0.3-5355.6",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5355.6-10415.1",
      "types": []
    },
    "leftovers": [],
    "problems": []
  },
  {
    "mode": "quit",
    "plugins": 8,
    "mainPid": 285816,
    "knownPids": 11,
    "quitToExitMs": 164.1,
    "exit": {
      "code": 0,
      "signal": null
    },
    "whileRunning": {
      "count": 11,
      "takenMs": "333.9-5429.5",
      "types": [
        "browser:285816",
        "gpu-process:263612",
        "utility:288852",
        "renderer:265792",
        "renderer:30812",
        "renderer:277748",
        "renderer:249332",
        "renderer:285800",
        "renderer:292800",
        "renderer:293424",
        "renderer:285384"
      ]
    },
    "whileRunningWhy": [
      "browser:recorded-pid+user-data-dir",
      "gpu-process:child-of-recorded-pid+user-data-dir",
      "utility:recorded-pid+child-of-recorded-pid+user-data-dir",
      "renderer:recorded-pid+child-of-recorded-pid+user-data-dir"
    ],
    "probeWhileRunning": [
      "alive"
    ],
    "lastRecordedPidGoneAfterMainMs": 0.1,
    "deadAfterMainMs": "renderer:30812=0.1 renderer:249332=0.1 gpu-process:263612=0.1 renderer:265792=0.1 renderer:277748=0.1 renderer:285384=0.1 renderer:285800=0.1 browser:285816=0.1 utility:288852=0.1 renderer:292800=0.1 renderer:293424=0.1",
    "afterCrash": null,
    "afterEnd": {
      "count": 0,
      "takenMs": "0.3-5449.5",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5449.5-11024.8",
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
    "mainPid": 30068,
    "knownPids": 11,
    "killOutput": "SUCCESS: The process with PID 30068 has been terminated.",
    "exit": {
      "code": 1,
      "signal": null
    },
    "whileRunning": {
      "count": 11,
      "takenMs": "1952.8-7129.3",
      "types": [
        "browser:30068",
        "gpu-process:287088",
        "utility:292528",
        "renderer:271940",
        "renderer:20056",
        "renderer:274420",
        "renderer:278696",
        "renderer:275544",
        "renderer:29220",
        "renderer:292740",
        "renderer:285436"
      ]
    },
    "whileRunningWhy": [
      "browser:recorded-pid+user-data-dir",
      "gpu-process:recorded-pid+child-of-recorded-pid+user-data-dir",
      "utility:recorded-pid+child-of-recorded-pid+user-data-dir",
      "renderer:recorded-pid+child-of-recorded-pid+user-data-dir"
    ],
    "killCommandMs": 4579.6,
    "probeWhileRunning": [
      "alive"
    ],
    "lastRecordedPidGoneAfterMainMs": 0,
    "deadAfterMainMs": "renderer:20056=0 renderer:29220=0 browser:30068=0 renderer:271940=0 renderer:274420=0 renderer:275544=0 renderer:278696=0 renderer:285436=0 gpu-process:287088=0 utility:292528=0 renderer:292740=0",
    "afterCrash": null,
    "afterEnd": {
      "count": 0,
      "takenMs": "0-5067.2",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5067.3-9942.7",
      "types": []
    },
    "leftovers": [],
    "problems": []
  },
  {
    "mode": "kill",
    "plugins": 8,
    "mainPid": 284784,
    "knownPids": 11,
    "killOutput": "SUCCESS: The process with PID 284784 has been terminated.",
    "exit": {
      "code": 1,
      "signal": null
    },
    "whileRunning": {
      "count": 11,
      "takenMs": "333.3-5422.6",
      "types": [
        "browser:284784",
        "gpu-process:263188",
        "utility:287008",
        "renderer:9108",
        "renderer:258304",
        "renderer:293844",
        "renderer:278672",
        "renderer:286016",
        "renderer:27612",
        "renderer:293972",
        "renderer:293472"
      ]
    },
    "whileRunningWhy": [
      "browser:recorded-pid+user-data-dir",
      "gpu-process:child-of-recorded-pid+user-data-dir",
      "utility:recorded-pid+child-of-recorded-pid+user-data-dir",
      "renderer:recorded-pid+child-of-recorded-pid+user-data-dir"
    ],
    "killCommandMs": 4474.2,
    "probeWhileRunning": [
      "alive"
    ],
    "lastRecordedPidGoneAfterMainMs": 19.6,
    "deadAfterMainMs": "renderer:9108=19.6 renderer:27612=19.6 renderer:258304=19.6 gpu-process:263188=19.6 renderer:278672=19.6 browser:284784=0 renderer:286016=19.6 utility:287008=19.6 renderer:293472=19.6 renderer:293844=19.6 renderer:293972=19.6",
    "afterCrash": null,
    "afterEnd": {
      "count": 0,
      "takenMs": "0-5153.5",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5153.5-10642",
      "types": []
    },
    "leftovers": [],
    "problems": []
  },
  {
    "mode": "kill",
    "plugins": 8,
    "mainPid": 293072,
    "knownPids": 11,
    "killOutput": "SUCCESS: The process with PID 293072 has been terminated.",
    "exit": {
      "code": 1,
      "signal": null
    },
    "whileRunning": {
      "count": 11,
      "takenMs": "376.5-5678.1",
      "types": [
        "browser:293072",
        "gpu-process:291452",
        "utility:288704",
        "renderer:289964",
        "renderer:620",
        "renderer:274960",
        "renderer:291272",
        "renderer:285088",
        "renderer:267284",
        "renderer:284892",
        "renderer:230972"
      ]
    },
    "whileRunningWhy": [
      "browser:recorded-pid+user-data-dir",
      "gpu-process:child-of-recorded-pid+user-data-dir",
      "utility:recorded-pid+child-of-recorded-pid+user-data-dir",
      "renderer:recorded-pid+child-of-recorded-pid+user-data-dir"
    ],
    "killCommandMs": 4476.8,
    "probeWhileRunning": [
      "alive"
    ],
    "lastRecordedPidGoneAfterMainMs": 20.9,
    "deadAfterMainMs": "renderer:620=20.9 renderer:230972=20.9 renderer:267284=20.9 renderer:274960=20.9 renderer:284892=20.9 renderer:285088=20.9 utility:288704=20.9 renderer:289964=20.9 renderer:291272=20.9 gpu-process:291452=20.9 browser:293072=0",
    "afterCrash": null,
    "afterEnd": {
      "count": 0,
      "takenMs": "0-5185.5",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5185.5-10255",
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
    "mainPid": 291904,
    "knownPids": 12,
    "quitToExitMs": 151.8,
    "exit": {
      "code": 0,
      "signal": null
    },
    "whileRunning": null,
    "whileRunningWhy": [],
    "probeWhileRunning": [],
    "lastRecordedPidGoneAfterMainMs": 0.1,
    "deadAfterMainMs": "?:27676=0.1 renderer:28540=0.1 renderer:28840=0.1 renderer:263528=0.1 renderer:271020=0.1 gpu-process:285376=0.1 renderer:285520=0.1 utility:286040=0.1 renderer:286960=0.1 browser:291904=0.1 renderer:293532=0.1 Tab:293904=0.1",
    "afterCrash": {
      "count": 10,
      "takenMs": "343.6-5308.5",
      "types": [
        "browser:291904",
        "gpu-process:285376",
        "utility:286040",
        "renderer:286960",
        "renderer:28540",
        "renderer:293532",
        "renderer:285520",
        "renderer:263528",
        "renderer:271020",
        "renderer:28840"
      ]
    },
    "afterEnd": {
      "count": 0,
      "takenMs": "0.3-5270.3",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5270.3-10614.8",
      "types": []
    },
    "leftovers": [],
    "crash": {
      "reason": "crashed",
      "exitCode": 2,
      "crashToGoneEventMs": 2.068,
      "crashToProcessExitMs": 2.233,
      "victimPidInOsList": false,
      "othersAnswered": 7,
      "others": 7,
      "victimCall": "Error: plugin-1 is not waiting.",
      "restartToFirstAnswerMs": 55.85,
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
    "mainPid": 273096,
    "knownPids": 12,
    "quitToExitMs": 162.2,
    "exit": {
      "code": 0,
      "signal": null
    },
    "whileRunning": null,
    "whileRunningWhy": [],
    "probeWhileRunning": [],
    "lastRecordedPidGoneAfterMainMs": 0.1,
    "deadAfterMainMs": "renderer:37520=0.1 ?:106464=0.1 utility:263696=0.1 renderer:271928=0.1 browser:273096=0.1 renderer:274928=0.1 Tab:277768=0.1 gpu-process:281544=0.1 renderer:285568=0.1 renderer:289216=0.1 renderer:290376=0.1 renderer:291776=0.1",
    "afterCrash": {
      "count": 10,
      "takenMs": "353.2-5523.8",
      "types": [
        "browser:273096",
        "gpu-process:281544",
        "utility:263696",
        "renderer:289216",
        "renderer:271928",
        "renderer:285568",
        "renderer:274928",
        "renderer:37520",
        "renderer:291776",
        "renderer:290376"
      ]
    },
    "afterEnd": {
      "count": 0,
      "takenMs": "0.3-5070.6",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5070.6-10140.1",
      "types": []
    },
    "leftovers": [],
    "crash": {
      "reason": "crashed",
      "exitCode": 2,
      "crashToGoneEventMs": 2.544,
      "crashToProcessExitMs": 2.716,
      "victimPidInOsList": false,
      "othersAnswered": 7,
      "others": 7,
      "victimCall": "Error: plugin-1 is not waiting.",
      "restartToFirstAnswerMs": 55.443,
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
    "mainPid": 264924,
    "knownPids": 12,
    "quitToExitMs": 151.6,
    "exit": {
      "code": 0,
      "signal": null
    },
    "whileRunning": null,
    "whileRunningWhy": [],
    "probeWhileRunning": [],
    "lastRecordedPidGoneAfterMainMs": 0.1,
    "deadAfterMainMs": "Tab:26988=0.1 browser:264924=0.1 renderer:271404=0.1 renderer:274612=0.1 renderer:276792=0.1 gpu-process:280088=0.1 renderer:284788=0.1 renderer:290212=0.1 renderer:290300=0.1 renderer:290460=0.1 ?:291068=0.1 utility:291144=0.1",
    "afterCrash": {
      "count": 10,
      "takenMs": "335-5398.1",
      "types": [
        "browser:264924",
        "gpu-process:280088",
        "utility:291144",
        "renderer:271404",
        "renderer:284788",
        "renderer:276792",
        "renderer:290212",
        "renderer:290300",
        "renderer:290460",
        "renderer:274612"
      ]
    },
    "afterEnd": {
      "count": 0,
      "takenMs": "0.4-4952.1",
      "types": []
    },
    "afterWait": {
      "count": 0,
      "takenMs": "5011.1-9948.4",
      "types": []
    },
    "leftovers": [],
    "crash": {
      "reason": "crashed",
      "exitCode": 2,
      "crashToGoneEventMs": 2.274,
      "crashToProcessExitMs": 2.435,
      "victimPidInOsList": false,
      "othersAnswered": 7,
      "others": 7,
      "victimCall": "Error: plugin-1 is not waiting.",
      "restartToFirstAnswerMs": 54.234,
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
