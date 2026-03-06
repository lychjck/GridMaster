import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

export default function ParameterSweepChart({ data, loading, onRunSweep, sweepParams, setSweepParams }) {
    const options = useMemo(() => {
        if (!data || data.length === 0) return {};

        const sortedData = [...data].sort((a, b) => a.step - b.step);

        const xAxisData = sortedData.map(d => `${d.step.toFixed(1)}%`);
        const profitData = sortedData.map(d => d.totalProfit);
        const drawdownData = sortedData.map(d => -d.maxDrawdown); // Make drawdown negative for visual clarity
        const winRateData = sortedData.map(d => d.winRate);

        // Find the step with max profit
        let maxProfitIndex = 0;
        let maxProfit = -Infinity;
        profitData.forEach((profit, i) => {
            if (profit > maxProfit) {
                maxProfit = profit;
                maxProfitIndex = i;
            }
        });

        return {
            title: {
                text: '参数寻优 (步长 vs. 收益)',
                left: 'center',
                textStyle: { color: '#e2e8f0', fontSize: 16 }
            },
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                textStyle: { color: '#f8fafc' },
                axisPointer: { type: 'cross' }
            },
            legend: {
                data: ['总收益', '最大回撤 (%)', '胜率 (%)'],
                top: 30,
                textStyle: { color: '#cbd5e1' }
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '10%',
                containLabel: true
            },
            dataZoom: [
                { type: 'inside', xAxisIndex: 0 },
                { type: 'slider', xAxisIndex: 0 }
            ],
            xAxis: {
                type: 'category',
                name: '网格步长',
                nameTextStyle: { color: '#94a3b8' },
                boundaryGap: false,
                data: xAxisData,
                axisLabel: { color: '#cbd5e1' },
                axisLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.2)' } }
            },
            yAxis: [
                {
                    type: 'value',
                    name: '总收益',
                    position: 'left',
                    nameTextStyle: { color: '#ef4444' },
                    axisLabel: { color: '#ef4444' },
                    axisLine: { show: true, lineStyle: { color: '#ef4444' } },
                    splitLine: { lineStyle: { type: 'dashed', color: 'rgba(255, 255, 255, 0.05)' } }
                },
                {
                    type: 'value',
                    name: '比率 (%)',
                    position: 'right',
                    nameTextStyle: { color: '#818cf8' },
                    axisLabel: { color: '#818cf8' },
                    axisLine: { show: true, lineStyle: { color: '#818cf8' } },
                    splitLine: { show: false }
                }
            ],
            series: [
                {
                    name: '总收益',
                    type: 'line',
                    yAxisIndex: 0,
                    data: profitData,
                    smooth: true,
                    lineStyle: { color: '#ef4444', width: 3 },
                    itemStyle: { color: '#ef4444' },
                    areaStyle: {
                        color: {
                            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                            colorStops: [{ offset: 0, color: 'rgba(239,68,68,0.5)' }, { offset: 1, color: 'rgba(239,68,68,0.0)' }]
                        }
                    },
                    markPoint: {
                        data: [
                            { type: 'max', name: '最高收益', itemStyle: { color: '#ef4444' } }
                        ]
                    }
                },
                {
                    name: '最大回撤 (%)',
                    type: 'line',
                    yAxisIndex: 1,
                    data: drawdownData,
                    smooth: true,
                    lineStyle: { color: '#10b981', width: 2, type: 'dashed' },
                    itemStyle: { color: '#10b981' }
                },
                {
                    name: '胜率 (%)',
                    type: 'bar', // Used bar so it doesn't overlap messily with the lines
                    yAxisIndex: 1,
                    data: winRateData,
                    itemStyle: { color: 'rgba(99, 102, 241, 0.4)' },
                    barMaxWidth: 30
                }
            ]
        };
    }, [data]);

    return (
        <div className="w-full bg-slate-800/50 backdrop-blur-md rounded-2xl border border-white/10 shadow-xl p-6 space-y-4">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h3 className="text-lg font-bold text-indigo-400 border-l-4 border-indigo-500 pl-3">
                        参数热力分析 (Grid Search)
                    </h3>
                    <p className="text-sm text-slate-400 mt-1 pl-4">
                        自动遍历不同网格步长，寻找历史数据下的回测最优解。
                    </p>
                </div>

                <div className="flex items-center gap-3 bg-black/20 border border-white/5 p-2 rounded-lg">
                    <div className="flex flex-col">
                        <label className="text-xs text-slate-400 font-medium">最小步长(%)</label>
                        <input
                            type="number"
                            step="0.1"
                            value={sweepParams.minStep}
                            onChange={(e) => setSweepParams({ ...sweepParams, minStep: Number(e.target.value) })}
                            className="w-20 px-2 py-1 bg-black/30 border border-white/10 rounded text-sm text-slate-200 outline-none focus:border-indigo-500/50 font-mono"
                        />
                    </div>
                    <span className="text-slate-500 pt-5">-</span>
                    <div className="flex flex-col">
                        <label className="text-xs text-slate-400 font-medium">最大步长(%)</label>
                        <input
                            type="number"
                            step="0.1"
                            value={sweepParams.maxStep}
                            onChange={(e) => setSweepParams({ ...sweepParams, maxStep: Number(e.target.value) })}
                            className="w-20 px-2 py-1 bg-black/30 border border-white/10 rounded text-sm text-slate-200 outline-none focus:border-indigo-500/50 font-mono"
                        />
                    </div>
                    <div className="flex flex-col">
                        <label className="text-xs text-slate-400 font-medium">间隔(%)</label>
                        <input
                            type="number"
                            step="0.1"
                            value={sweepParams.stepInterval}
                            onChange={(e) => setSweepParams({ ...sweepParams, stepInterval: Number(e.target.value) })}
                            className="w-20 px-2 py-1 bg-black/30 border border-white/10 rounded text-sm text-slate-200 outline-none focus:border-indigo-500/50 font-mono"
                        />
                    </div>
                    <button
                        onClick={onRunSweep}
                        disabled={loading}
                        className="mt-5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded shadow-sm transition-colors flex items-center"
                    >
                        {loading ? (
                            <><span className="animate-spin mr-2">⏳</span>探测中...</>
                        ) : (
                            '执行分析'
                        )}
                    </button>
                </div>
            </div>

            {data && data.length > 0 ? (
                <ReactECharts
                    option={options}
                    style={{ height: '400px', width: '100%' }}
                    opts={{ renderer: 'canvas' }}
                />
            ) : (
                <div className="h-[400px] w-full bg-slate-900/30 rounded-xl border border-white/5 border-dashed flex items-center justify-center">
                    <div className="text-center text-slate-500">
                        <p className="mb-2">📊</p>
                        <p className="text-sm">点击上方“执行分析”开始扫描不同参数的回测表现</p>
                    </div>
                </div>
            )}
        </div>
    );
}
