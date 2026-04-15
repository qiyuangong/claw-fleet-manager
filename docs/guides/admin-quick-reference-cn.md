# Claw Fleet Manager — 管理员快速参考

| 任务 | 操作路径 | 关键操作 |
|------|----------|----------|
| 创建实例 | 侧边栏 → Manage Instances → + Add Instance | 输入名称 → 选择 Create OpenClaw Docker / Create OpenClaw Profile / Create Hermes Docker |
| 启动实例 | 侧边栏 → 实例名称 → Overview 标签页 | 点击 **Start** |
| 停止实例 | 侧边栏 → 实例名称 → Overview 标签页 | 点击 **Stop** |
| 重启实例 | 侧边栏 → 实例名称 → Overview 标签页 | 点击 **Restart** |
| 重命名实例 | 侧边栏 → Manage Instances → Rename（实例须已停止） | 输入新名称 → Rename |
| 迁移 OpenClaw 实例 | 侧边栏 → 打开实例 → Overview 标签页 | 点击 **Migrate** → 选择 Docker 或 Profile |
| 添加用户 | 侧边栏 → Users → Add User 区域 | 输入用户名 + 密码 → Add |
| 为用户分配实例 | 侧边栏 → Users → 点击用户的 Instances 按钮 | 勾选实例 → Save |
| 重置用户密码 | 侧边栏 → Users → Reset Password | 输入新密码 → Save |
| 审批设备 | 侧边栏 → 实例 → Control UI 标签页 | 点击 **Approve** 或 **Approve All** |
| 配置飞书 | 侧边栏 → 实例 → Feishu 标签页 | 输入 App ID + Secret → Save Config |
| 审批飞书配对 | 侧边栏 → 实例 → Feishu 标签页 | 点击配对码旁的 **Approve** |
| 查看实时日志 | 侧边栏 → 实例 → Logs 标签页 | 日志自动流式输出 |
| 查看 CPU/内存 | 侧边栏 → 实例 → Metrics 标签页 | 图表实时更新 |
| 查看实例活动 | 侧边栏 → Manage Instances → Open Instance → Activity 标签页 | 按状态/时间筛选；切换看板/表格视图 |
| 安装插件 | 侧边栏 → 实例 → Plugins 标签页 | 点击 **Install Plugin** → 输入标识符 |
| 卸载插件 | 侧边栏 → 实例 → Plugins 标签页 | 点击 **Remove** → 确认 |
| 编辑配置 | 侧边栏 → 实例 → Config 标签页 | 编辑 JSON → Save → 重启实例 |
| 实时监控会话 | 侧边栏 → 运行中 | 点击 **启动** |
| 查看历史会话 | 侧边栏 → 活动 | 全舰队筛选/排序/搜索会话 |
| 舰队活动仪表盘 | 侧边栏 → Dashboard | 点击状态分类聚焦；调整筛选器 |

OpenClaw 专属工作流：设备审批、飞书配对、插件、单实例 Activity，以及迁移。
Hermes Docker 使用通用的生命周期、日志、配置和指标工作流。
