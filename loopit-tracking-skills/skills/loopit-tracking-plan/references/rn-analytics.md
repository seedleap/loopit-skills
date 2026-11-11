# RN、Native 与 H5 采集核查

仅在方案涉及对应实现时读取。这里是 owner 导航和检查方法，不是业务代码规范或可直接套用的线上清单；先按主入口确认用户指定仓库、分支/HEAD 与适用 AGENTS。路径相对对应仓库根目录，缺失时重新定位，不猜替代实现。

## 沿实际链路核查

对有争议的事件读取：产生动作 → 同步快照 → 预处理/字段转换 → 具体消费者 → 各发送器 → 最终 payload/收件证据。按需列出逻辑名、出网名、目标、类型、复用依据与未核实项，不为每个需求强制扩建追踪系统。

前端入口：

| owner | 相对路径 | 重点 |
| --- | --- | --- |
| 架构与责任 | src/shared/analytics/README.md | 业务事件 owner、公共客户端与目的端分工 |
| 启动与账号 | src/_app/bootstrap/startAnalytics.ts；src/_app/bootstrap/analytics/startAccountAnalytics.ts | provider 初始化、账号同步、账号切换 |
| 公共客户端 | src/shared/analytics/analyticsClient.ts | 标准路径、thinking_data_only、目的端计划、身份与 vid 选项 |
| 预处理 | src/shared/analytics/prepareAnalyticsEvent.ts；analyticsTags.ts | 显式快照、ambient tags、键注册与序列化 |
| 字段转换 | src/shared/analytics/mapAnalyticsEventAttributes.ts | project_id→pid、task_id→tid、trigger_source→tr_src、view_id→vid；核对具体路径是否经过 |
| TD 发送 | src/shared/analytics 下 sendAnalyticsEventToThinkingData.ts、trackDirectThinkingDataEvent.ts、thinkingDataSdkAdapter.ts（先定位） | 标准与直接 TD 字段差异、SDK 身份与接收边界 |
| Loopit 发送 | src/shared/analytics 下 buildAnalyticsEventHeader.ts、buildAnalyticsRequest.ts、analyticsDeliveryClient.ts（先定位） | header 与 attr 分工、请求构建时机、目标路由 |
| Native | modules/native-monitor/README.md；src/shared/analytics 下 startNativeAnalyticsBridge.ts（先定位） | 既有 Native 通道、已投递标记、ack 与持久化范围 |

2026-10-27 核查所得，后续不默认为永久事实：

- 标准路径做字段缩写；thinking_data_only 直接路径不经过同一套 canonical enrich/map。AppsFlyer/Firebase 另有选择条件，不是每个事件都发到所有 provider。
- 公共身份 header、TD 自定义 td_track_* 属性与 TD SDK login 身份分开；保存原 uid 不能证明 TD SDK 当前身份与原账号一致，也不授权切换身份补发。
- tags 是已注册染色键，不是任意业务属性袋；不同调用形态的 tags 序列化不一致。raw 不在所有路径自动 JSON.stringify；查最终 payload 与 TE 类型，不凭 TS 对象类型推断入库。
- source、业务 pid 和原始订单归因不是自动公共字段。vid 关联/去重依赖事件选项和匹配条件；p_click 的 project+vid 去重不可推广到支付、全部点击或 H5 事件。
- 自动生成 event_id 只提供传输身份，重复业务回调生成新 ID 仍可能重复计数。普通进程队列与指定事件 durable outbox 的覆盖不同，不宣称所有事件跨重启可靠或 exactly once。
- 账号不匹配可能限制目的端或丢弃特定队列项；核对当前策略，不自动切换 SDK 身份补发。事件环境/账本验证与发送目标隔离分别证明。

## H5 项目事件与曝光

runtime 仓库的 packages/loopit-runtime/src/module/core/ 目录下按需读取 utils/nativeReport.ts、hooks/useLoopitProjectExposure.ts、states/projectExposureController.ts。

RN 消费者：src/features/feed/tracking/consumer-session/FeedTrackBridge.ts、resolveProjectEventContext.ts；src/entities/project/events/loopitProjectEvents.ts。普通 H5 与 Feed 宿主的上下文补齐及校验不同，逐个核查。

- 当前内部项目通道使用 a_loopit_project_event，以 event_type=exposure/click 区分；它是混合行为 wire 的存量事实，方案仍按每行为一行。关键动作需要独立事件时，先列出复用与协议扩展的实现差异，不能虚构 SDK 能发送任意独立事件。
- 显式 DOM ref 绑定 under AppContainer 才启用对应曝光能力；当前逻辑要求宿主活跃、节点可见 ≥50% 且连续 300ms，同次访问每元素一次尝试。遮挡/前后台会中断 dwell，不自动重置已尝试集合；页面复用有专门重置。不能推广为全局标准或所有已发布游戏均接入。
- 内部辅助调用返回 true 仅表示同步桥调用未抛出，不保证 RN 接受、排队或服务收件；该 runtime 辅助能力本身不提供确认重试。不得将内部 API 提升为公共创作契约。
- commerce.purchase 调用不证明用户真实点击，更不证明按钮曝光。常规 logger/perf telemetry 也不能替代该采集通道；须追查实际消费者。
- RN 校验宿主 WebView/render 身份，但部分 H5 标识字段保留 payload 优先规则；不能宣称所有上报 pid/page_id 都被强制覆盖为可信宿主值。金融业务的订单归属另从已验证的原意图/订单核实。

## 页面与搜索复用

- 根页面曝光注册表、搜索访问、Feed 与存量 Discover 的曝光/返回计数不同，不能只看路由或 mount。
- src/features/search/tracking/searchTracking.ts 与 useSearchTracking.ts：搜索结果 tr_src 为文本，button/keyboard/history_item，属于有效搜索最初提交方式。a_search_results_project_clk 等结果事件使用该上下文；这是复用语义、类型和取值的代码依据，不能证明 TE 该事件关联或线上入库。
- source 表示上一个统计页面；tr_src 表示最初触发方式。保持二者独立，并在新搜索时重置提交上下文。

## 证据与验收

分别记录：约定／TE 元数据／指定 HEAD 代码／静态验证／运行 payload／目标收件／线上分析结果。字段存在不等于枚举兼容，SDK accepted 不等于后端收件；HTTP 成功不等于业务交付或入账。无相应权限或设备授权时只报告现有证据与缺口。
