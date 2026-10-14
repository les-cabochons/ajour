// A realistic workspace for screenshots and measurements, written into
// localStorage before the app loads. `large` adds 600 backlog items and
// 1,800 entries, the workspace the progress tracker's budgets are measured on;
// `empty` leaves storage clear, as on a fresh install.
export function seedScript(options = {}) {
  return `(() => {
  const options = ${JSON.stringify(options)};
  const now = new Date();
  const iso = (d) => [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
  const dayOffset = (n) => { const d = new Date(now); d.setDate(d.getDate()+n); return iso(d); };
  const today = iso(now);
  const dow = (now.getDay()+6)%7;
  const monday = (n) => dayOffset(n - dow);
  const h = (x) => Math.round(x*3600000);
  const t0 = Date.now();
  const projects = [
    { _id:"p-atlas", name:"Atlas platform", displayName:"Atlas platform", code:"ATL", color:"#2563eb", icon:{kind:"preset",name:"dot"}, status:"active", tasks:[
      { _id:"t-atlas-dev", name:"Development", status:"active", createdAt:t0-9e6, billable:true, budgetMs:h(120), pinnedSlot:"1" },
      { _id:"t-atlas-review", name:"Code review", status:"active", createdAt:t0-8e6, billable:true, pinnedSlot:"2" },
      { _id:"t-atlas-meet", name:"Meetings", status:"active", createdAt:t0-7e6, billable:false },
    ]},
    { _id:"p-harbor", name:"Harbor mobile", displayName:"Harbor mobile", code:"HRB", color:"#d97706", icon:{kind:"preset",name:"dot"}, status:"active", tasks:[
      { _id:"t-harbor-dev", name:"Development", status:"active", createdAt:t0-6e6, billable:true, budgetMs:h(40) },
      { _id:"t-harbor-qa", name:"QA and release", status:"active", createdAt:t0-5e6, billable:true },
    ]},
    { _id:"p-internal", name:"Internal", displayName:"Internal", code:"INT", color:"#059669", icon:{kind:"preset",name:"dot"}, status:"active", tasks:[
      { _id:"t-int-admin", name:"Admin", status:"active", createdAt:t0-4e6, billable:false, pinnedSlot:"3" },
      { _id:"t-int-learning", name:"Learning", status:"active", createdAt:t0-3e6, billable:false },
    ]},
    { _id:"p-old", name:"Legacy CRM", displayName:"Legacy CRM", code:"CRM", color:"#7c3aed", icon:{kind:"preset",name:"dot"}, status:"archived", tasks:[
      { _id:"t-old-dev", name:"Maintenance", status:"archived", createdAt:t0-2e7, archivedAt:t0-1e7 },
    ]},
  ];
  const workflowStates = [
    { _id:"ws-todo", name:"To do", color:"#9ca3af", createdAt:1 },
    { _id:"ws-doing", name:"In progress", color:"#d97706", createdAt:2 },
    { _id:"ws-review", name:"In review", color:"#2563eb", createdAt:3 },
    { _id:"ws-done", name:"Done", color:"#059669", done:true, createdAt:4 },
  ];
  const wi = (id, title, extra) => ({ _id:id, title, status:"active", source:"manual", createdAt:t0-1e6, ...extra });
  const ado = (id, type, key, label) => ({ source:"azure-devops", sourceId:id, sourceConnectionId:"ado-work", sourceConnectionLabel:"Contoso", sourceProjectName:"Atlas", sourceWorkItemType:type, sourceStatusKey:key, sourceStatusLabel:label, sourceUrl:"https://dev.azure.com/contoso/atlas/_workitems/edit/"+id });
  const workItems = [
    wi("w1","Fix export rounding on half-hour entries",{ priority:1, workflowStateId:"ws-doing", projectId:"p-atlas", taskId:"t-atlas-dev", originalEstimateHours:4, remainingEstimateHours:1.5, completedEstimateHours:2.5, ...ado("48213","Bug","active","Active") }),
    wi("w2","Week grid: keyboard editing of cells",{ priority:2, workflowStateId:"ws-doing", projectId:"p-atlas", taskId:"t-atlas-dev", originalEstimateHours:8, remainingEstimateHours:5, completedEstimateHours:3, ...ado("48190","User Story","active","Active") }),
    wi("w2a","Arrow keys between cells",{ priority:2, workflowStateId:"ws-done", status:"archived", archivedAt:t0-2e5, parentWorkItemId:"w2", hierarchyLevel:1, projectId:"p-atlas", taskId:"t-atlas-dev", remainingEstimateHours:0, originalEstimateHours:2, completedEstimateHours:2 }),
    wi("w2b","Type a digit to edit hours",{ priority:2, workflowStateId:"ws-todo", parentWorkItemId:"w2", hierarchyLevel:1, projectId:"p-atlas", taskId:"t-atlas-dev", remainingEstimateHours:3, originalEstimateHours:3 }),
    wi("w3","Review PR: connector worker timeouts",{ priority:2, workflowStateId:"ws-review", projectId:"p-atlas", taskId:"t-atlas-review", remainingEstimateHours:1, originalEstimateHours:1 }),
    wi("w4","Harbor: offline sync conflict dialog",{ priority:3, workflowStateId:"ws-todo", projectId:"p-harbor", taskId:"t-harbor-dev", originalEstimateHours:6, remainingEstimateHours:6, source:"jira", sourceId:"HRB-412", sourceConnectionId:"jira-work", sourceConnectionLabel:"Jira Cloud", sourceProjectName:"Harbor", sourceWorkItemType:"Story", sourceStatusKey:"todo", sourceStatusLabel:"To Do", sourceUrl:"https://contoso.atlassian.net/browse/HRB-412" }),
    wi("w5","Release notes for 1.4",{ priority:3, workflowStateId:"ws-todo", projectId:"p-harbor", taskId:"t-harbor-qa", remainingEstimateHours:2, originalEstimateHours:2 }),
    wi("w6","Update expense policy doc",{ priority:4, workflowStateId:"ws-todo", projectId:"p-internal", taskId:"t-int-admin" }),
    wi("w7","Read the new OKLCH color guide",{ workflowStateId:"ws-todo", projectId:"p-internal", taskId:"t-int-learning", remainingEstimateHours:1 }),
    wi("w8","Investigate flaky nightly build",{ priority:2, workflowStateId:"ws-todo", projectId:"p-atlas", taskId:"t-atlas-dev", snoozedUntil:t0+26*3600000, remainingEstimateHours:3, originalEstimateHours:3, ...ado("48301","Bug","new","New") }),
    wi("w9","Waiting on design: settings icons",{ priority:3, status:"settled", settledAt:t0-2*86400000, workflowStateId:"ws-review", projectId:"p-atlas", taskId:"t-atlas-dev", ...ado("48102","Task","resolved","Resolved") }),
    wi("w10","Migrate CI to Node 26",{ priority:3, status:"archived", archivedAt:t0-3*86400000, workflowStateId:"ws-done", projectId:"p-internal", taskId:"t-int-admin", originalEstimateHours:4, completedEstimateHours:4, remainingEstimateHours:0 }),
  ];
  const e = (id, date, pid, tid, label, note, hrs, extra={}) => ({ _id:id, localDate:date, projectId:pid, taskId:tid, label, note, durationMs:h(hrs), sourceBlockIds:[], committedAt:t0-5e5, ...extra });
  const timesheetEntries = [
    e("e1", monday(0), "p-atlas","t-atlas-dev","Development","Export rounding spike", 3.5, {workItemId:"w1", submittedAt:t0-4e5}),
    e("e2", monday(0), "p-atlas","t-atlas-meet","Meetings","Sprint planning", 1, {submittedAt:t0-4e5}),
    e("e3", monday(0), "p-internal","t-int-admin","Admin","Expense report", 0.5, {submittedAt:t0-4e5}),
    e("e4", monday(0), "p-harbor","t-harbor-dev","Development","Conflict dialog scaffolding", 2.5, {workItemId:"w4", submittedAt:t0-4e5}),
    e("e5", monday(1), "p-atlas","t-atlas-dev","Development","Week grid keyboard editing", 4, {workItemId:"w2"}),
    e("e6", monday(1), "p-atlas","t-atlas-review","Code review","Worker timeouts PR", 1.5, {workItemId:"w3"}),
    e("e7", monday(1), "p-atlas","t-atlas-meet","Meetings","1:1 with Sam", 0.5),
    e("e8", monday(1), "p-harbor","t-harbor-qa","QA and release","Smoke test 1.4 RC1", 1.5),
    e("e9", today, "p-atlas","t-atlas-dev","Development","Export rounding: fixed half-hour case", 2, {workItemId:"w1"}),
    e("e10", today, "p-atlas","t-atlas-meet","Meetings","Standup", 0.25),
    e("e11", today, "p-internal","t-int-learning","Learning","OKLCH guide", 0.75, {workItemId:"w7"}),
    e("e12", monday(-7), "p-atlas","t-atlas-dev","Development","Last week carry-over", 6, {submittedAt:t0-8e5}),
    e("e13", monday(-6), "p-atlas","t-atlas-dev","Development","", 7.5, {submittedAt:t0-8e5}),
    e("e14", monday(-5), "p-harbor","t-harbor-dev","Development","", 8, {submittedAt:t0-8e5}),
    e("e15", monday(-4), "p-atlas","t-atlas-review","Code review","", 4, {submittedAt:t0-8e5}),
    e("e16", monday(-4), "p-internal","t-int-admin","Admin","", 3.5, {submittedAt:t0-8e5}),
    e("e17", monday(-3), "p-atlas","t-atlas-dev","Development","", 6.5, {submittedAt:t0-8e5}),
  ];
  if (options.large) {
    const states = ["ws-todo", "ws-doing", "ws-review"];
    const tasks = [["p-atlas","t-atlas-dev"],["p-harbor","t-harbor-dev"],["p-internal","t-int-admin"]];
    for (let i = 0; i < 600; i += 1) {
      const [pid, tid] = tasks[i % 3];
      workItems.push(wi("big-" + i, "Work item " + i + ": " + ["refactor","fix","review","write","test"][i % 5] + " the " + ["sync","export","grid","dock","palette"][i % 5], { priority: (i % 4) + 1, workflowStateId: states[i % 3], projectId: pid, taskId: tid, remainingEstimateHours: (i % 8) + 1, originalEstimateHours: (i % 8) + 2, createdAt: t0 - 1e6 - i * 1000 }));
    }
    for (let i = 0; i < 1800; i += 1) {
      const [pid, tid] = tasks[i % 3];
      timesheetEntries.push(e("big-e-" + i, dayOffset(-(Math.floor(i / 6) + 1)), pid, tid, "Development", "Entry " + i, 0.5 + (i % 4) * 0.5, { submittedAt: t0 - 9e5 }));
    }
  }
  const timers = options.running === false ? [] : [ { _id:"timer-1", startedAt:t0-47*60000, localDate:today, workItemId:"w1", projectId:"p-atlas", taskId:"t-atlas-dev", note:"Export rounding: edge cases", accumulatedDurationMs:0 } ];
  // Capacity targets persist in milliseconds per weekday.
  const h8 = 8 * 3600000;
  const userPreferences = { themeMode: options.theme || "light", updateTrack:"stable", projectDataShapeId:"default", weeklyTimeViewStyle: options.weekStyle || "grid", weeklyCapacityTargets:{ monday:h8, tuesday:h8, wednesday:h8, thursday:h8, friday:h8, saturday:0, sunday:0 }, warnWhenOverCapacity:true, warnWhenSubmittingUnderCapacity:true, closeParentSubitems:"ask" };
  localStorage.clear();
  // An empty workspace: nothing persisted, so the app starts as on a fresh install.
  if (options.empty) return;
  localStorage.setItem("ajour.local-state.v2", JSON.stringify({ projects, workflowStates, workItems, timesheetEntries, timers, userPreferences }));
  if (options.backlogLayout) localStorage.setItem("ajour.backlog-view", JSON.stringify({ layout: options.backlogLayout }));
  if (options.sidebar) localStorage.setItem("ajour.app-sidebar", options.sidebar);
})()`;
}

/** The connector overview the mocked API returns: plugins on, nothing connected. */
export const emptyConnectorsOverview = {
  pluginsEnabled: true,
  plugins: [],
  connectionGroups: [],
  totalPendingImportCount: 0,
  totalSelectedImportCount: 0,
};
