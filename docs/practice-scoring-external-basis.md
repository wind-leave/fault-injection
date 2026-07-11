# 故障注入平台实践评分系统外部依据整理

本文用于说明当前故障注入平台实践评分系统的外部依据。结论先行：外部资料能够支撑“结果正确性 + 过程证据链 + 排故路径 + 效率 + 安全合规”的评分框架；具体分值权重（如当前实现中的 30/20/30/5/15）属于本项目结合教学目标、系统能力和任务粒度制定的实现配置，不应表述为外部标准原样规定。

## 一、当前评分系统对应的评价维度

当前平台提交练习时返回 `scoreBreakdown`，主要包括：

| 平台评分项 | 当前分值 | 评价含义 |
| --- | ---: | --- |
| `faultLocalization` | 30 | 最终故障判断是否命中目标故障 |
| `diagnosticTreePath` | 20 | 关键节点覆盖、路径效率 |
| `informationGain` | 30 | 单步决策是否匹配动态推荐动作，反映证据采集和决策合理性 |
| `efficiency` | 5 | 是否在规定时间内完成 |
| `safetyCompliance` | 15 | 是否存在安全违规操作 |

这些维度可以归纳为五类能力：故障定位能力、诊断推理过程、排故路径质量、操作效率、安全风险控制。

## 二、外部依据与可支撑内容

### 1. 职业维修认证强调“知识、风险管理、技能”的综合评价

美国 eCFR 14 CFR 65.79 对航空机械员证书技能要求规定，申请人需要通过口试和实践测试，并展示相应科目的知识、风险管理和技能要素。该规定不是针对本平台的评分模板，但它说明维修类实操评价不只考最终答案，还要考风险管理和实际技能表现。

可支撑的平台评分项：

- `faultLocalization`：维修/诊断任务需要证明对故障对象的理解。
- `safetyCompliance`：风险管理是技能认证的一部分。
- `diagnosticTreePath`：实践测试关注实际技能表现，而不是单纯笔试结果。

来源：

- eCFR, 14 CFR § 65.79 Skill requirements: https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-65/subpart-D/section-65.79

### 2. 电子实验排故研究将 troubleshooting 定义为“诊断并修复故障系统”的认知任务

Dounas-Frazer 与 Lewandowski 对电子实验课程排故教学与评价进行了研究。文中将 troubleshooting 描述为诊断和修复故障系统的过程，并指出合格排故需要多类知识：领域知识、系统知识、程序性知识和策略性知识。同时，排故过程包含生成故障原因、执行测试、依据测试结果缩小问题空间等子任务。

这与平台“关键测点选择、测量证据、维修动作、路径组织、动态参考匹配”的设计一致。

可支撑的平台评分项：

- `diagnosticTreePath`：检测节点选择、关键节点覆盖和路径效率。
- `informationGain`：每一步测量或维修是否有助于缩小故障范围。
- `efficiency`：结构化排故策略比随机试错更高效。

来源：

- Dounas-Frazer, D. R., & Lewandowski, H. J. (2016). *Electronics lab instructors' approaches to troubleshooting instruction*. https://arxiv.org/abs/1610.01564

### 3. 诊断推理研究强调“假设、证据、证据评价、结论”的过程性评价

Schulz 等人的诊断推理自动分析研究指出，诊断推理是许多职业的核心能力。教育心理学通常通过分析学生诊断过程中的认知活动来进行反馈，包括假设生成、证据生成、证据评价和形成结论。

这直接支撑本平台不只看学生最后是否猜中故障，还记录每步操作，将测点、维修、匹配结果和最终判断一起评价。

可支撑的平台评分项：

- `informationGain`：每步动作是否能生成或评价有效证据。
- `diagnosticTreePath`：路径是否体现从证据到结论的逻辑链。
- `faultLocalization`：最终结论是否与证据链一致并命中目标故障。

来源：

- Schulz, C., Meyer, C. M., Sailer, M., Kiesewetter, J., Bauer, E., Fischer, F., Fischer, M. R., & Gurevych, I. (2018). *Challenges in the Automatic Analysis of Students' Diagnostic Reasoning*. https://arxiv.org/abs/1811.10550

### 4. 物理计算排故评价强调“超越正确答案”，关注排故思维过程

Morales-Navarro 等人针对物理计算中的排故思维变化提出评价方法。研究指出，物理计算排故是高度情境化的实践，涉及硬件、软件、多模态信息和多种技能；评价工具应能揭示学生的排故过程，而不只是看答案是否正确或学生自我感受。

这支持平台记录完整操作轨迹、关键节点、迭代测试和错误路径，并在成绩之外输出扣分原因与反馈。

可支撑的平台评分项：

- `diagnosticTreePath`：评价学生是否有清晰、具体、可解释的排故过程。
- `informationGain`：评价迭代测试是否产生有效证据。
- `deductions` / `record.pathEvaluation`：输出过程性反馈和扣分依据。

来源：

- Morales-Navarro, L., Fields, D. A., Kafai, Y. B., & Barapatre, D. (2024). *Assessing Changes in Thinking about Troubleshooting in Physical Computing*. https://arxiv.org/abs/2412.03687

### 5. VR/仿真训练评分研究支持基于轨迹数据和专家样本进行自动评价

Vaughan 与 Gabrys 针对 VR 训练模拟器提出评分与评估方法。研究指出，VR 模拟器可以捕获详细的多维操作数据，用于表现分析；专家记录可用于指导新手；评估反馈能够帮助受训者改进技能和一致性，错误也可以动态检测。

虽然该研究场景是医疗 VR，不是故障注入平台，但其方法论与三维实践平台相似：使用仿真环境记录操作轨迹，将学生轨迹与专家/标准轨迹进行比较，并输出自动化评价。

可支撑的平台评分项：

- `diagnosticTreePath`：学生操作轨迹可与标准排故路径比较。
- `informationGain`：每一步动作可与动态参考动作集比较。
- `safetyCompliance`：可在过程中识别危险动作并触发扣分。

来源：

- Vaughan, N., & Gabrys, B. (2020). *Scoring and Assessment in Medical VR Training Simulators with Dynamic Time Series Classification*. https://arxiv.org/abs/2006.12366

### 6. 工业信息物理系统故障诊断研究支持模型、知识、故障树等可解释诊断依据

Dowdeswell 等人的工业信息物理系统故障诊断综述覆盖航空、汽车和工业控制等领域，归纳了模型驱动、数据驱动、知识驱动等故障诊断方法，并提到故障树、Petri 网、Markov 方法等在故障识别和分析中的使用。

这为平台使用 D 矩阵、故障树关键节点、可检测关系、候选故障集和动态推荐动作提供了工程依据。它说明故障诊断系统通常需要可解释的模型结构，而不是只给出黑箱结论。

可支撑的平台评分项：

- `diagnosticTreePath`：基于故障树关键节点、D 矩阵测点覆盖评价路径质量。
- `informationGain`：基于候选故障集和测点区分度评价动作价值。
- `faultLocalization`：最终故障判断来自可追溯的诊断模型。

来源：

- Dowdeswell, B., Sinha, R., & MacDonell, S. G. (2021). *Finding faults: A scoping study of fault diagnostics for Industrial Cyber-Physical Systems*. https://arxiv.org/abs/2101.05451

## 三、外部依据与平台评分项映射

| 平台评分项 | 外部依据支撑 | 说明 |
| --- | --- | --- |
| 故障定位 | 职业维修认证、诊断推理研究、故障诊断综述 | 维修/诊断任务最终必须定位故障类型和位置 |
| 诊断树路径 | 电子排故研究、物理计算排故评价、故障诊断综述 | 排故能力体现为测点选择、路径顺序、关键节点覆盖和证据链 |
| 单步决策合理性 | 诊断推理研究、电子排故研究、VR 轨迹评价 | 每一步动作都应产生有效信息或推进诊断 |
| 效率 | 电子排故研究、VR 轨迹评价 | 结构化排故应减少无效操作和随机试错 |
| 安全合规 | 职业维修认证、VR 训练评价 | 实操训练必须把风险控制作为独立评价维度 |

## 四、可用于方案文本的表述

建议在技术方案或验收材料中使用如下表述：

> 本平台实践评分体系参考维修类职业技能评价、电子系统排故教学评价、诊断推理过程评价以及 VR/仿真训练自动评分方法，采用“结果正确性 + 过程证据链 + 路径质量 + 操作效率 + 安全合规”的综合评价框架。系统在训练过程中记录学生操作轨迹，将测量、维修、验证等动作与标准排故路径、关键诊断节点和动态推荐动作集进行比对，形成可追溯的总分、分项得分和扣分原因。该评分方式避免单纯以最终答案评价训练结果，能够更真实地反映学生的排故思路、证据采集能力、操作规范性和安全意识。

