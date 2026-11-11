# IAP 归因与九列表格案例

日期：2026-10-27。仅用于验证本技能可表达已确认需求；不是已实施的埋点清单，也不授权业务开发、TE 建属性、配置修改或支付操作。实现快照与元数据范围见 [source-docs.md](source-docs.md)，一般核查路径见 [rn-analytics.md](rn-analytics.md)。

## 已确认目标与边界

- 覆盖自定义 H5 购买按钮、官方 Pay 面板、充值入口、Recharge Get；客户端行为加权威服务端交付/入账结果，用于转化及流失原因，不分析法币收入。
- 取消、pending/待确认、确定失败分开；超时不是失败，关闭面板不自动等于取消交易。余额不足打开充值，充值结束需要用户再次 Pay，不补造第二次点击。
- 查单/已有订单恢复不是新充值；成功按原业务订单计一次，不按回调、查单或验证请求次数计数。
- 原账号、原作品、原订单及必要页面来源跨作品切换、关闭、重启仍需保留；不能取回调时的当前上下文补齐。原始归因和当前 SDK/传输身份分开处理。

## 当前代码事实及缺口

前端仓库：src/_app/commerce/createGamePurchaseBridge.ts；src/features/coin-commerce 下 model/createCoinCommerce.ts、confirmPurchase.ts、createRechargeFlow.ts、createRechargeOrderRecovery.ts、api/pendingRechargeOrdersStorage.ts、api/rechargeApi.ts、ui/PurchaseSheet.tsx、ui/RechargeSheet.tsx。

- 购买桥从宿主创建购买意图并校验文档身份；不能用调用本身证明按钮可见或真实点击。当前检查的商务 owner 中未发现这些业务采集点的完整实现，不据此宣称所有线上版本均无埋点。
- Pay 余额不足路径打开充值后返回；Get 在 pending 分支执行查单，恢复原 transaction 也不代表又创建一次充值。
- 购买 pending 已保留部分原 scope/作品/requestId；充值恢复持久化账号、环境、bundle 和订单身份，但缺原作品/页面/染色的完整快照，不能假设重启归因已经满足。
- 创建充值单只传 scene=recharge。API refId 虽存在，但客户端按数值字符串校验，不可直接把任意作品 ID 填入 ref_id；先确认业务语义和双端类型。
- 服务端参考 services/biz-core-service/internal 的 recharge 领域、handler/router.go：充值入账事务及重放已有处理，日志/Metric 不能当作 TE 结果事件。所查本地 HEAD 未找到对应 RN 的游戏购买路由，不据此推断线上无实现；最终交付 owner 与部署版本仍需核实。

## 属性决策与原始快照

表中“复用/代码”表示有当前采集代码依据，但 TE 目标事件关联、枚举及线上入库仍需核查；“候选/待核查”不是已批准新增。正式方案须完成同义属性核查后选择复用或拟新增全称，不能把未查询到当不存在。

| 字段/上下文 | 本案例决策与来源 | 冻结与缺失处理 |
| --- | --- | --- |
| page_id、source | 复用统计页面/来源语义；引用搜索链路等现有定义；具体页面值下表拟定 | 入意图时冻结原统计页及来源，结果不读当前页面 |
| pid | 复用作品事件 pid，文本，参考 a_loopit_project_event；金融归属必须来自可信原宿主/订单 | 缺原作品时不填当前作品，保留未知归因缺口 |
| event_type、element_id、element_type | H5 复用 a_loopit_project_event 的现有协议；事件其他字段不自动继承 | 固定值在对应行给出，调用与可见性分别验证 |
| request_id | 复用候选：TE 文本属性存在，购买 pending 有 requestId；语义及目标关联待核查 | 提交时创建；不能倒推其已覆盖 H5 首次点击 |
| order_no | 候选/待核查：采用充值订单原编号（字符串），TE 可复用名称未确认 | 绑定原账号/订单；不输出 order_token、JWS、purchaseToken 等凭据 |
| reason_code | 复用候选：TE 文本属性存在，错误原因语义兼容仍待核查 | 确定来源与稳定枚举，未知不编造；不直接上传异常原文 |
| 账号、environment、book、发生时间、既有 tags | 按原意图/订单保存的上下文，不预设全部新增顶层属性或每行上传 | 维护与上传分开；标签按注册键处理，环境路由另验 |

以下九列是受限验算片段：只覆盖“Explore 进入 /game/P → Pay → Pay 内充值入口 → Recharge Get”这一条拟定路径。page_id=project_detail 引用项目事件 /game/:id 映射；purchase_page、recharge_page 为拟定统计页。其他入口不得套用本 source；正式方案逐一补映射。自动公共身份/设备字段沿既有客户端，不冒充已实现原账号结果归因。

## 九列示例

所有“新增”均指采集点；H5 技术事件复用不代表新采集点已接入。其他业务事件名和中文名均为拟定且待 TE 查重；不因下面列名而创建事件。所需属性在各行完整列出，复用依据见上表。

| 方案时间 | 类型 | 埋点英文名称 | 埋点中文名 | 端 | 页面位置 | 触发时机 | 事件属性 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026.10.27 | 新增 | a_loopit_project_event | 作品事件（展示名待核） | 前端 | /game/P 自定义购买按钮 | 显式接入后真实满足对应曝光资格，本次访问该元素一次尝试 | page_id：string=project_detail（复用）；pid：string=原宿主 P（复用）；event_type：string=exposure（复用）；element_id：string=game_purchase（复用属性、拟定值）；element_type：string=button（复用） | 复用 H5 wire，不是已接入证明；source 需要传播但不在该 SDK 白名单内，不能伪造已上传 |
| 2026.10.27 | 新增 | a_loopit_project_event | 作品事件（展示名待核） | 前端 | /game/P 自定义购买按钮 | 用户真实点击；程序调用 purchase 不计按钮点击 | page_id：string=project_detail（复用）；pid：string=原宿主 P（复用）；event_type：string=click（复用）；element_id：string=game_purchase（复用属性、拟定值）；element_type：string=button（复用） | 与曝光分行；核心动作若另选独立事件，先说明协议变更，不能双报后相加 |
| 2026.10.27 | 新增 | a_page_exp | 页面曝光 | 前端 | Pay 统计页 | Pay 面板真实可见，每个面板访问一次；被加载不计 | page_id：string=purchase_page（复用属性、拟定值）；source：string=project_detail（复用）；pid：string=原购买意图作品 P（复用） | 事件复用；拟定统计页不等于已有路由或 TE 定义 |
| 2026.10.27 | 新增 | a_purchase_pay_exp | Pay 按钮曝光（拟定） | 前端 | Pay 面板 | 真实 Pay 操作按钮可见，本次访问一次；非 Got it/Refresh quote | page_id：string=purchase_page（复用属性、拟定值）；source：string=project_detail（复用）；pid：string=原购买意图作品 P（复用） | 事件拟新增、待查重；不机械补无关元素字段 |
| 2026.10.27 | 新增 | a_purchase_pay_clk | Pay 按钮点击（拟定） | 前端 | Pay 面板 | 用户真实执行 Pay；余额不足也计这一次点击 | page_id：string=purchase_page（复用属性、拟定值）；source：string=project_detail（复用）；pid：string=原购买意图作品 P（复用） | 事件拟新增、待查重；当前 requestId 晚于此动作生成，不能冒称已逐次关联 |
| 2026.10.27 | 新增 | a_purchase_recharge_exp | 充值入口曝光（拟定） | 前端 | Pay 面板充值入口 | 充值入口真实可见，本次访问一次 | page_id：string=purchase_page（复用属性、拟定值）；source：string=project_detail（复用）；pid：string=原购买意图作品 P（复用） | 事件拟新增、待查重 |
| 2026.10.27 | 新增 | a_purchase_recharge_clk | 充值入口点击（拟定） | 前端 | Pay 面板充值入口 | 用户点充值入口；Pay 余额不足自动打开不伪造该点击 | page_id：string=purchase_page（复用属性、拟定值）；source：string=project_detail（复用）；pid：string=原购买意图作品 P（复用） | 自动打开可计 Recharge 页面到达，来源分组若需要另核查合适属性 |
| 2026.10.27 | 新增 | a_page_exp | 页面曝光 | 前端 | Recharge 统计页 | Recharge 面板真实可见，每次访问一次 | page_id：string=recharge_page（复用属性、拟定值）；source：string=purchase_page（复用）；pid：string=原购买意图作品 P（复用） | 事件复用；关闭/返回计数按此次访问定义 |
| 2026.10.27 | 新增 | a_recharge_get_exp | Get 按钮曝光（拟定） | 前端 | Recharge 面板 | 新购 Get 可操作且可见，本次访问一次；查单状态不是新购 Get | page_id：string=recharge_page（复用属性、拟定值）；source：string=purchase_page（复用）；pid：string=原充值关联作品 P（复用） | 事件拟新增、待查重；当前原作品恢复有缺口 |
| 2026.10.27 | 新增 | a_recharge_get_clk | Get 按钮点击（拟定） | 前端 | Recharge 面板 | 用户有效发起新购；pending 查单/恢复原单不计 | page_id：string=recharge_page（复用属性、拟定值）；source：string=purchase_page（复用）；pid：string=原充值关联作品 P（复用） | 事件拟新增、待查重；order_no 尚未生成，不假设此时已有 |
| 2026.10.27 | 新增 | s_purchase_success | 作品交付成功（拟定） | 服务端 | 原 Pay 过程 | 权威交付事务成功后，按原业务购买记录幂等一次 | page_id：string=purchase_page（复用属性、拟定值，原快照）；source：string=project_detail（复用，原快照）；pid：string=原订单作品 P（复用）；request_id：string=原购买关联键（复用候选/待核查） | 事件拟新增、待查重；服务端 owner/部署及快照透传待核实，UI 成功不代发此结果 |
| 2026.10.27 | 新增 | s_recharge_success | 充值入账成功（拟定） | 服务端 | 原 Recharge 过程 | 入账事务成功后，按原充值业务单幂等一次；查单/verify 重放不增计 | page_id：string=recharge_page（复用属性、拟定值，原快照）；source：string=purchase_page（复用，原快照）；pid：string=原订单关联作品 P（复用）；order_no：string=原订单号（候选/待核查） | 事件拟新增、待查重；原始归因不全时列未知缺口，不读当前作品；当前日志不算已有采集 |

此表不是完整生产方案：流失原因点需核实实际状态/错误码、同义事件属性与明确枚举后逐行补齐，不能凭空生成一个通用 result 事件。取消、pending、确定失败、超时/未知按已确认边界分别统计；必要阶段字段优先复用，无合适属性才拟新增全称。未补齐这些点前，不宣称已具备流失原因分析。

## 验收与指标边界

| 场景 | 预期/Oracle | 所需证据 |
| --- | --- | --- |
| 隐藏、骨架、预加载、程序调用 | 不伪造按钮曝光/点击；显式绑定适用范围明确 | 运行可见性与 payload 对账 |
| 普通点击与重复回调 | 行为按真实动作计；传输重试不重计同一记录 | 业务动作与 event_id、目的端收件对账 |
| Pay 余额不足 → Recharge → 返回 | 不自动再 Pay，不产生充值入口假点击 | UI/状态机、行为记录及请求顺序 |
| Get pending 查单或恢复原 transaction | 不新增 Get 新购和新充值；同一入账只计一次 | 原订单号、请求与服务端结果 |
| 取消、pending、确定失败、超时 | 四类分开；未知不归为失败，原因使用核实枚举 | 商店状态、业务响应与脱敏 payload |
| 切作品、关面板、重启、切号 | 原事件保留原归属；无快照标未知，不混入当前账号/作品 | 持久化与原单对账、身份/路由证据 |
| CREDITED/交付结果重复验证 | 服务端业务成功幂等一次；前端成功反馈另算 | 事务后事件/outbox 与业务单对账 |
| 环境/账本 | 原 scope 与目的端隔离分别验证，不混入 live 分析 | 配置、目标请求与查询过滤证据 |

指标先明确是按用户/作品/订单的聚合转化，还是严格逐次漏斗。当前 request_id/order_no 不能自动关联生成前的所有按钮动作；若确需逐次关联，另行核查可复用关联键及最小实施方案，不默认新增 flow/trace ID。关闭或未再 Pay 只有到观察窗口结束才能作为相应流失，不可瞬时认定失败。本次静态案例不证明设备、真实支付、服务收件、线上入库或完整流失分析已通过。
