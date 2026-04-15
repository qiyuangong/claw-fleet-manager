# Claw Fleet Manager — Admin Quick Reference

| Task | Where to go | Key action |
|------|-------------|------------|
| Create instance | Sidebar → Manage Instances → + Add Instance | Enter name → choose Create OpenClaw Docker / Create OpenClaw Profile / Create Hermes Docker |
| Start instance | Sidebar → instance name → Overview tab | Click **Start** |
| Stop instance | Sidebar → instance name → Overview tab | Click **Stop** |
| Restart instance | Sidebar → instance name → Overview tab | Click **Restart** |
| Rename instance | Sidebar → Manage Instances → Rename (instance must be stopped) | Enter new name → Rename |
| Migrate OpenClaw instance | Sidebar → open instance → Overview tab | Click **Migrate** → choose Docker or Profile |
| Add user | Sidebar → Users → Add User section | Enter username + password → Add |
| Assign instance to user | Sidebar → Users → Instances | Select instances → Save |
| Reset user password | Sidebar → Users → Reset Password | Enter new password → Save |
| Approve device | Sidebar → instance → Control UI tab | Click **Approve** or **Approve All** |
| Configure Feishu | Sidebar → instance → Feishu tab | Enter App ID + Secret → Save Config |
| Approve Feishu pairing | Sidebar → instance → Feishu tab | Click **Approve** next to the code |
| View live logs | Sidebar → instance → Logs tab | Logs stream automatically |
| View CPU/memory | Sidebar → instance → Metrics tab | Charts update live |
| View instance activity | Sidebar → Manage Instances → Open Instance → Activity tab | Filter by status/time; toggle Board/Table view |
| Install plugin | Sidebar → instance → Plugins tab | Enter package/path → click **Install** |
| Remove plugin | Sidebar → instance → Plugins tab | Click **Remove** → confirm |
| Edit config | Sidebar → instance → Config tab | Edit JSON → Save → restart instance |
| Monitor active sessions | Sidebar → Running | Click **Start** |
| Review session history | Sidebar → Activity | Filter/sort/search sessions fleet-wide |
| Fleet activity dashboard | Sidebar → Dashboard | Click status buckets to focus; adjust filters |

OpenClaw-only workflows: device approval, Feishu pairing, plugins, per-instance Activity, and migration.
Hermes Docker uses the shared lifecycle, logs, config, and metrics flows.
