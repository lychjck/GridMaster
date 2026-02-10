# 红利低波网格交易分析工具 - 待实现功能清单 (Feature Roadmap)

本文档列出了基于现有代码库分析得出的功能增强建议，按优先级排序。

## 1. 策略深度与分析增强 (Strategy & Analytics) [P0]
目前的回测逻辑 (`backend/simulation.go`) 较为基础，需增加专业指标以评估策略稳健性。

- [ ] **高级回测指标 (Advanced Metrics)**
    - **最大回撤 (Max Drawdown)**: 评估最坏情况下的资金回撤比例，核心风险指标。
    - **夏普比率 (Sharpe Ratio)**: 评估每单位风险带来的超额收益。
    - **年化收益率 (CAGR)**: 将总收益转换为年化视角。
    - **胜率统计 (Win Rate)**: 统计网格套利的成功次数 vs 被套次数。
- [ ] **参数热力图 (Parameter Heatmap)**
    - 自动遍历不同网格步长 (e.g., 0.5% - 5.0%)，生成收益热力图，辅助选择最优参数。
- [ ] **资金利用率分析 (Capital Usage)**
    - 计算网格运行期间的平均持仓资金，评估资金效率。

## 2. 交互与可视化体验 (UX & Visualization) [P1]
提升前端 React + ECharts 的交互体验。

- [ ] **交易点标记 (Trade Markers)**
    - 在 K 线图上用不同颜色的箭头（Buy/Sell）标记每一笔交易，直观展示“低吸高抛”的效果。
- [x] **移动端适配 (Mobile Responsive)**
    - 优化 `Dashboard` 和图表在移动端的显示，方便随时查看。 (核心适配已完成，细节持续优化中)
- [ ] **暗黑模式 (Dark Mode)**
    - 利用 TailwindCSS 实现深色模式切换，提升夜间复盘体验。
- [ ] **数据导出 (Data Export)**
    - 支持将回测结果 (`DailyStats`, `Trades`) 导出为 CSV，方便二次分析。

## 3. 实时性与监控 (Real-time & Monitoring) [P2]
增提升系统的实时监控能力。

- [ ] **实时数据刷新 (Real-time Refresh)**
    - 前端增加自动轮询机制 (e.g., 每 5 秒)，实现“伪实时”盯盘。
- [ ] **价格预警 (Price Alerts)**
    - 设置价格区间，突破网格上下沿时通过浏览器通知或后端集成报警。

## 4. 策略扩展 (Strategy Expansion) [P3]
扩展网格策略的多样性。

- [ ] **动态网格/移动网格 (Trailing Grid)**
    - 网格中枢 (`Base Price`) 跟随价格趋势移动，防止踏空或深度被套。
- [ ] **马丁策略支持 (Martingale)**
    - 跌破补仓倍投机制 (e.g., 1x, 2x, 4x)，降低持仓成本。
