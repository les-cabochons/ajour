# Ajour

Ajour records the time a person spends on project tasks, one workday at a time, and keeps those records on their own machine.

## Language

### Time entries

**Time entry**:
Time spent on a project task on one day, with an optional note.
_Avoid_: Log, session, record

**Running**:
The state of the one time entry the clock is currently counting. At most one time entry is running.
_Avoid_: Open, active, timer (as a separate thing the user sees)

**Saved**:
The state of a time entry that is neither running nor submitted.
_Avoid_: Closed, stopped, committed

**Submitted**:
The state of a time entry included in a submitted timesheet. Editing it returns it to saved.
_Avoid_: Locked, approved, sent

### Time entry actions

**Continue**:
Count more time for a time entry's work. On today's entry it resumes that entry. On another day's entry it starts a new running entry today with the same project task and note.
_Avoid_: Restart, resume (as the user-facing label)

**Discard**:
Throw away the time counted by a running entry since it last started.
_Avoid_: Cancel, delete (for a running entry)
