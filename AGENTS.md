# Agent operating agreement

This repository follows the Quniverse unified agent doctrine:
https://github.com/QNFO/agent-operating-system/blob/main/GLOBAL-AGENTS.md

Fast loop: inspect the failure, make the smallest complete fix, run the
project's checks, and leave a reviewable branch/commit/PR with verification
evidence. Preserve existing conventions; never commit secrets or weaken
security controls to pass a task. Production deploy, credentials, DNS, billing,
permission escalation, and irreversible deletion stay human-gated unless this
repository's `.agentops/authority.yaml` explicitly enables them.
