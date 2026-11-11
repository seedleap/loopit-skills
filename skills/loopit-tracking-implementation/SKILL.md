---
name: loopit-tracking-implementation
description: 根据已确认的 Loopit 埋点方案修改 RN、Native、H5
  或服务端采集代码。用于落地埋点、接入埋点代码、补齐事件上报及字段映射，纯方案设计或只读验收按对应任务处理。
metadata:
  short-description: Implement confirmed Loopit tracking plans
---

# 每次调用入口

每次选用此 Skill（显式调用、自动选用、同会话再次使用、压缩后继续）都必须重新执行入口；不得缓存或直接复用上次的业务正文。

1. 以本文件实际安装目录为基准，执行：

   `node "<本 SKILL.md 所在目录>/scripts/entry.mjs"`

2. 读取入口返回 JSON 中的绝对路径 `workflowPath`，并严格按该正文完成本次任务；所有相对资源路径以 `resourcesRoot` 为基准。
3. 本次始终固定使用回执的 `version` 和路径，即使后台出现新版也不重新解析指针。不等待后台检查，不执行前台更新。下次调用重新从步骤 1 开始。

本入口只返回本地快照并启动静默后台检查。Node.js ≥22.20、Git；详情或最近结果：`node "<本 SKILL.md 所在目录>/scripts/entry.mjs" --status`。宿主没有执行入口的权限时应报告限制，不绕过权限。
