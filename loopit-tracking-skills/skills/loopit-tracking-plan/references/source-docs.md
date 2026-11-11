# 信息来源与查阅策略

本地保留稳定规则和必要案例，飞书保留完整规范与团队维护入口。此文件是来源索引与查阅指南，不是飞书全文副本，也不表示已自动同步到最新版本。

## 各来源的职责

| 来源 | 用于回答 | 不能据此推断 |
| --- | --- | --- |
| 当前用户要求与 PRD | 本次目标、分析问题、明确业务约定 | 方案已经上线、实现已符合需求 |
| SKILL.md | 已固化的方法、稳定设计规则 | 全量事件/属性/枚举的当前清单 |
| 飞书规范、预定义文档 | 团队约定、登记定义、共同维护的参考 | 实际代码已实现、TE 已存在 |
| TE 元数据 | 查询时已有的事件、属性及返回的定义 | 未返回的枚举、完整触发逻辑或线上数据质量 |
| 代码 | 当前检查版本的采集事实、路由组件、触发与映射 | 物理页面必须等于统计页面、代码已部署到线上 |
| 本地案例及历史查询 | 理解决策、复用本次会话仍适用的证据 | 长期有效的当前状态或全局规则 |

出现差异时分别说明约定、实现和本次建议，不简单规定某个来源永远覆盖其他来源。当前用户明确要求适用于当前方案；实际写入仍遵守授权边界。

## 何时访问飞书

- 已固化的规则足够支持当前设计时，直接使用本地 skill，无须每次完整重读两份规范。
- 页面、模块、元素定义未覆盖时，可先查《预定义埋点》对应部分，再用代码理解和核对。
- 出现来源冲突、疑似过期、规则或枚举变化，或用户明确要求最新规范时，读取相应原文。
- 相似历史方案仅在能帮助当前决策时读取；它们不覆盖当前确认的设计规则。
- 登录、权限或读取失败时说明具体缺口，继续使用已核实内容和明确标注的拟定方案；不能把不可访问当作无定义。

## 完整规范入口

- 数数埋点规范：https://icnimsatr0zz.feishu.cn/wiki/S4XwwBLhriiOPnkcLGpc5q26npU
- 预定义埋点：https://icnimsatr0zz.feishu.cn/wiki/Se6Qwd0b2iLII1ktSxhcoE9Tnmd

本轮已读取并讨论的日期：2026-10-12。此日期仅表示会话核对时间，不承诺文档内容此后未变化。

## 历史需求与方案

- IM活动H5页面埋点需求：https://icnimsatr0zz.feishu.cn/wiki/KFoAwr5rQiFwbCk3EjCcNLwxnug
- IM活动H5页面埋点方案：https://icnimsatr0zz.feishu.cn/wiki/XGONwO9whilbNpkxAxmcAUfpnSe
- 新用户注册流程引导创建模版-AB需求：https://icnimsatr0zz.feishu.cn/wiki/AwUbwE6CAi41FHkxESLcYp81nlb
- 新用户注册流程引导创建模版-AB埋点方案：https://icnimsatr0zz.feishu.cn/wiki/VKZrwMRBuijJtvke4dFcR61OnUd
- 搜索页增加hashtag运营位需求：https://icnimsatr0zz.feishu.cn/wiki/IrsHwvx3HiYrXQklUA3c6ZoqnHg

本地已整理的案例及其适用边界见 [examples.md](examples.md)。

## 本地维护方式

- 稳定决策写入主规则，输出要求写入 output-format.md，具体业务案例与核对日期写入 examples.md，API 操作契约保留在 api.md。
- 不复制完整飞书规范、TE 清单或大段代码到 skill，以免产生两份难以保持一致的定义。
- 保存参考时标注来源、核对日期、已核实或拟定状态；“属性已存在”与“取值已存在”“已用于该事件”分别判断。
- 用户请求更新 skill 时才维护本地规则；发现差异可提出更新建议，不擅自同步飞书、TE 或代码。


## 2026-10-27 安装适配与核查记录

- 来源为用户指定下载目录中的 7 个文件；目录后缀“2”不作为版本号。原始 SKILL.md SHA-256：`95cd853490b151b4acfb2e5fe932b9c235579a601537afda3eb03c8ebf04026f`。安装仅适配本技能，保留原下载文件。
- 团队规范本轮读取 revision 237，预定义文档 revision 405。规范要求单事件新增属性超过 5 个联系张晓东确认；新事件维护入口：[埋点_20260909](https://icnimsatr0zz.feishu.cn/wiki/GItUw7wN8i76ifkjowdcIqMynUa)。登记表正文本轮未读取；不自动写入或发送消息。历史属性数量限制等描述不作为当前平台硬限制。
- 规范倾向前端 a_、服务端 s_；不因此重命名存量事件。时长 #duration 为秒，position 为从 1 开始的数值。预定义中的存量 element_type=page 与本技能新页面 a_page_exp 规则分开，不自动迁移。tag 与当前搜索代码 hashtag 的实体差异单列，不自行改共享枚举。
- 本轮 TE 网页只读核查项目“美区Loopit”（3）：全局 trigger_source、tr_src、raw 均显示文本；element_exposure 关联 position 为数值、tags 为文本。属性存在不证明完整枚举、目标事件关联或线上入库。recharge/purchase 关键词无结果不足以证明没有事件。
- 本机 API 必填配置缺失，因此未调用 OpenAPI。已有登录态且工具支持时，可使用 tea 技能导航的 TE 网页只读核实类型及关联，先确认项目/身份；不能搜取其他凭据，也不以 API 失败为由绕过认证。飞书读取使用 lark-doc；不可用时保留未核实项，不自动安装工具或修改认证。
- RN 第一阶段核查 HEAD 1d4fbdf1；安装前在用户当前 checkout 复核为 876662cb，工作区干净。搜索字段与商务核心状态机相关事实已复核；后续使用须重新确认适用代码身份。本轮 runtime 参考第一阶段 88c17cc2，服务端参考 e998429b；这些快照均不证明线上版本。
- RN 消费者、字段与投递核查路径见 [rn-analytics.md](rn-analytics.md)；已确认的 IAP 目标与案例见 [commerce-example.md](commerce-example.md)。代码路径均相对对应仓库根目录，不固化个人 checkout 路径。
