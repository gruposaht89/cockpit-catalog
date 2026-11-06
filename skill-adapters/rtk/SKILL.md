---
name: rtk
description: Reduce the output volume of development commands with Rust Token Killer (RTK). Use when the task involves saving context while reading Git, file, search or test output. Requires the RTK CLI to be available.
---

# RTK in Cockpit

This adapter is maintained by Cockpit. The original documentation, with installation,
supported commands and limits, is in [README](references/README.md) and
[INSTALL](references/INSTALL.md), copied from the revision recorded in the manifest.

Before using it, check `rtk --version` and `rtk gain`. The `rtk` package on crates.io
may refer to a different project: follow the installation documented by rtk-ai.
If the CLI is missing, report the dependency and read INSTALL before installing it.

Use the documented commands, such as `rtk git status`, when the summarized output is
enough. Keep the full output when the task requires logs, evidence or a diagnosis
that the summary might leave out. Do not enable global hooks or change other agents'
configuration files as a side effect of a task.

An activated skill provides instructions; it does not mean the CLI or its hooks
are installed. Respect the mission's permissions, role and scope.
