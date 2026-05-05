# Parser Timeout Mechanism Fix

## The Problem: Why the Timeout Wasn't Working

### What Was Happening (Before Fix)
The application had a `Post95Watchdog` that was supposed to timeout parsing jobs that hanged during the finalization phase (after 95% progress). However, it **didn't actually stop the parser process**.

**Root cause location:** `desktop/src-tauri/src/lib.rs` lines 640-709

The watchdog would:
1. ✅ Track elapsed time after 95% progress is reached
2. ✅ Detect when 30 seconds passed without progress updates
3. ✅ **Emit a warning message to stderr and the frontend**
4. ❌ **But never kill the parser process**
5. ❌ **And never signal to the frontend that parsing had failed**

### Why This Happened

```rust
// OLD CODE (lines 702-707)
let message = format!(
    "Still waiting after {}s in finalization...",
    POST_95_TIMEOUT.as_secs()
);
eprintln!("[{name}] post-95 watchdog: {message}");
emit_parse_progress(&app, &name, 0.99, &message);
// ← No process kill, no error return
```

**The problem:** The watchdog is a detached background thread that couldn't easily access the parser's process handle. It was designed as a "diagnostic watchdog" that logs hangs, not as a "termination watchdog" that kills stuck processes.

**Why it matters:**
- On **Windows**, the parser can hang indefinitely in the gzip flush operation
- On **macOS/Linux**, the process usually exits cleanly, so the watchdog warning alone is harmless
- But on Windows, users were stuck: UI shows "waiting" indefinitely, parser won't die, only fix is force-quit the app

---

## The Solution: Making the Watchdog Actually Timeout

### Changes Made

#### 1. Added `timeout_triggered` Flag to ParseJob
```rust
struct ParseJob {
    running: bool,
    cancel_requested: bool,
    timeout_triggered: bool,  // ← NEW
    child: Option<CommandChild>,
    memory_guard: Option<ParserMemoryGuard>,
}
```

This allows the watchdog thread to signal the main parser event loop.

#### 2. Watchdog Now Kills the Parser
```rust
// NEW CODE (in start_post_95_watchdog, line 706+)
if let Ok(mut job) = parse_job().lock() {
    job.timeout_triggered = true;
    if let Some(child) = job.child.take() {
        let _ = child.kill();  // ← Actually kill it
    }
}
```

When 30 seconds pass in finalization:
1. Set the `timeout_triggered` flag
2. Kill the child process immediately
3. Emit warning message (as before)

#### 3. Parser Event Loop Checks for Timeout
```rust
// NEW CODE (when CommandEvent::Terminated is received)
if let Ok(mut job) = parse_job().lock() {
    timeout_triggered = job.timeout_triggered;
    // ...
}
if timeout_triggered {
    let _ = fs::remove_file(out_path);
    return Err(format!(
        "{name} timeout: killed after {}s in finalization phase",
        POST_95_TIMEOUT.as_secs()
    ));
}
```

When the killed process exits, we check the flag and return a clear error message to the frontend.

#### 4. Flag Reset on New Parse
```rust
// In parse_demo(), when starting new parse job
job.timeout_triggered = false;
```

Ensures clean state for each parsing attempt.

---

## Why This Works

### Thread Safety
- **Atomicity**: The `timeout_triggered` bool is protected by the `parse_job()` mutex
- **Watchdog can safely set it** without holding the lock for long (just one assignment + process kill)
- **Main thread can safely read it** when the process terminates
- **No race conditions**: Worst case is a stale process ID, but we're already killing it

### Error Handling
- **Clear message to user**: "Parser timeout after 30s in finalization phase"
- **Automatic cleanup**: Incomplete output file is deleted on timeout
- **No orphaned processes**: Child is killed directly, not left hanging

### Platform-Specific Behavior
- **Windows**: Parser hangs in gzip flush? Gets killed after 30s, user sees error
- **macOS/Linux**: Parser exits normally before timeout? Returns clean success
- **All platforms**: Deterministic behavior now, not "wait forever and hope"

---

## Testing the Fix

### Manual Test on Windows
1. Parse a large demo file
2. Monitor task manager for parser process
3. Let it reach finalization (95%+ progress)
4. After ~30 seconds, verify:
   - Parser process is killed (no longer in task manager)
   - Frontend shows error: "Parser timeout after 30s in finalization phase"
   - Incomplete `.json.gz` file is deleted from `%APPDATA%/RoundLab/parsed/`

### Debug Console (New Feature)
Press **Ctrl+Shift+D** to open debug console in any build:
- Shows live `running`, `timeoutTriggered`, `cancelRequested` flags
- Shows console logs for debugging
- Allows easy monitoring during long parses

---

## Technical Notes

### Why 95%?
The threshold triggers the watchdog only in the "finalization phase" (final steps after heavy processing). This phase has different bottlenecks:
- **gzip compression** (Windows can stall here)
- **disk fsync** for file close
- **stderr flushing** from parser sidecar
- **process termination signals** from Tauri

Before 95%, the watchdog is idle because real progress updates keep coming frequently.

### Why 30 Seconds?
Empirically chosen:
- Long enough for slow disks and network files to flush
- Short enough that users don't wait indefinitely
- Matches typical gzip+fsync worst-case on a busy Windows machine

### Why Not Use Timeout Crate or Tokio?
- Tauri's sidecar process spawning is synchronous (no async runtime)
- The watchdog needs to be a simple OS thread, not dependent on async infrastructure
- Simpler, more explicit timeout mechanism fits this architecture better

---

## Files Modified
- `desktop/src-tauri/src/lib.rs`: Timeout fix + debug command
- `desktop/src/app/page.tsx`: Hotkey listener for debug console
- `desktop/src/components/DebugConsole.tsx`: NEW - debug UI
- `desktop/src/lib/api.ts`: NEW - get_debug_info() API wrapper

## Commit
See commit: "Add debug console and fix parser timeout mechanism"
