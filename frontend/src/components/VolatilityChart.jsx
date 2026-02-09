import React, { useEffect, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';

const VolatilityChart = ({ data, dailyInfo, gridStep, gridStepUnit, initialPrice, tradePoints = [], preClose }) => {
    const chartRef = useRef(null);
    const [selectedIndices, setSelectedIndices] = useState([]);

    const onChartClick = (params) => {
        // console.log("Chart clicked:", params.componentType, params.seriesName, "dataIndex:", params.dataIndex, "data:", params.data);

        let index;
        if (params.componentType === 'series') {
            if (params.seriesType === 'scatter') {
                // Scatter data is [xIndex, yValue], so correct index is data[0]
                index = params.data[0];
            } else {
                // Line/Bar series on category axis uses dataIndex directly
                index = params.dataIndex;
            }
        }

        if (index !== undefined) {
            setSelectedIndices(prev => {
                // Toggle logic:
                // If 2 selected, reset to new one.
                // If clicked one is already selected, deselect it.
                // Otherwise add it.
                const newIndices = prev.length >= 2 ? [index] :
                    prev.includes(index) ? prev.filter(i => i !== index) :
                        [...prev, index];
                return newIndices;
            });
        }
    };

    const onEvents = {
        'click': onChartClick
    };

    const getOption = () => {
        if (!data || data.length === 0) return {};

        // Use dailyInfo if available (authoritative), else fallback to first/last minute (approx)
        const rawOpen = dailyInfo ? dailyInfo.open : data[0].open;
        const rawClose = dailyInfo ? dailyInfo.close : data[data.length - 1].close;

        // Force Number type to avoid ECharts axis mismatch or string quoting
        const dayOpen = parseFloat(rawOpen);
        const dayClose = parseFloat(rawClose);

        // Synthesize 09:30 data point if missing (common in minute data starting at 09:31)
        // This ensures the chart looks "connected" from the open.
        let chartDates = data.map(item => item.timestamp);
        let chartPrices = data.map(item => item.close);
        let chartVolumes = data.map((item, index) => [index, item.volume, item.close >= item.open ? 1 : -1]);

        let hasSynthesizedStart = false;
        if (data.length > 0) {
            const firstTime = data[0].timestamp.split(' ')[1]; // HH:MM
            // Synthesize 09:30 if the data starts later (e.g. 09:31 for 1m, 09:35 for 5m)
            if (firstTime > '09:30' && firstTime <= '10:00') { // Only for morning start
                const datePart = data[0].timestamp.split(' ')[0];
                const startTime = `${datePart} 09:30`;

                chartDates.unshift(startTime);
                chartPrices.unshift(dayOpen);

                chartVolumes = [
                    [0, 0, 1],
                    ...data.map((item, index) => [index + 1, item.volume, item.open > item.close ? 1 : -1])
                ];
                hasSynthesizedStart = true;
            }
        }

        // Use synthesized arrays for rendering
        const allPrices = [...chartPrices, dayOpen, dayClose];
        if (preClose) allPrices.push(preClose);

        const prices = chartPrices;
        const dates = chartDates;
        const volumes = chartVolumes;

        const priceRange = Math.max(...allPrices) - Math.min(...allPrices);
        const padding = Math.max(priceRange * 0.2, 0.005); // Increase padding to 20%
        const yMin = Math.min(...allPrices) - padding;
        const yMax = Math.max(...allPrices) + padding;

        // Calculate Grid Lines
        const gridChartLines = [];

        if (gridStep && initialPrice) {
            const base = parseFloat(initialPrice);
            const baseOverlapsClose = Math.abs(base - dayClose) < 0.0001;

            if (!baseOverlapsClose) {
                gridChartLines.push({
                    yAxis: base,
                    label: { show: false },
                    lineStyle: {
                        color: 'rgba(255, 255, 255, 0.3)',
                        type: 'solid',
                        width: 1
                    }
                });
            }
        }

        // --- Generate Scatter Data for Trades ---
        const buyScatterData = [];
        const sellScatterData = [];

        // Adjust index if we added a synthesized start point
        const indexOffset = hasSynthesizedStart ? 1 : 0;

        tradePoints.forEach(trade => {
            const chartIndex = trade.index + indexOffset;
            // Check boundaries
            if (chartIndex >= 0 && chartIndex < prices.length) {
                const yValue = trade.price; // 使用后端返回的精确价格
                const point = [chartIndex, yValue]; // [xIndex, yValue]

                if (trade.type === 'B') {
                    buyScatterData.push(point);
                } else {
                    sellScatterData.push(point);
                }
            }
        });

        return {
            backgroundColor: 'transparent',
            animation: false, // Disable animation for performance on updates
            tooltip: {
                trigger: 'axis',
                axisPointer: {
                    type: 'cross',
                    label: {
                        backgroundColor: '#6a7985'
                    }
                },
                backgroundColor: 'rgba(20, 20, 25, 0.95)',
                borderColor: '#444',
                borderWidth: 1,
                padding: 10,
                textStyle: {
                    color: '#eee'
                },
                formatter: function (params) {
                    if (!params || params.length === 0) return '';
                    // Try to find the axis pointer param (usually the first one or the line series)
                    // Since specific params might be scatter points derived from axis trigger, we rely on dataIndex.
                    // But with axis trigger, param[0] should be consistent.
                    const index = params[0].dataIndex;

                    let realItem;
                    if (hasSynthesizedStart) {
                        if (index === 0) {
                            return `<div style="font-size:12px; color:#ccc">09:30 开盘集合竞价 (拟合)</div>`;
                        }
                        realItem = data[index - 1];
                    } else {
                        realItem = data[index];
                    }

                    if (!realItem) return '';

                    const item = realItem;
                    const volSeries = params.find(p => p.seriesName === '成交量');
                    let volVal = volSeries && volSeries.data ? volSeries.data[1] : item.volume;

                    const colorPrice = item.close >= item.open ? '#ef4444' : '#22c55e';
                    const diff = item.close - item.open;
                    const diffPct = (diff / item.open) * 100;
                    const sign = diff >= 0 ? '+' : '';

                    // Calculate Change relative to PreClose (Real Change)
                    let preCloseHtml = '';
                    if (preClose) {
                        const realDiff = item.close - preClose;
                        const realPct = (realDiff / preClose) * 100;
                        const realColor = realDiff >= 0 ? '#ef4444' : '#22c55e';
                        const realSign = realDiff >= 0 ? '+' : '';
                        preCloseHtml = `
                            <span style="color:#888">涨幅:</span> <span style="text-align:right; font-family:monospace; color:${realColor}">${realSign}${realPct.toFixed(2)}%</span>
                        `;
                    }

                    // Trade HTML Logic
                    const dataIndex = index - (hasSynthesizedStart ? 1 : 0);
                    const tradesAtThisPoint = tradePoints.filter(t => t.index === dataIndex);

                    let tradeHtml = '';
                    if (tradesAtThisPoint.length > 0) {
                        tradeHtml = `<div style="margin-top:8px; padding-top:8px; border-top:1px dashed #444;">`;
                        tradesAtThisPoint.forEach(t => {
                            const typeLabel = t.type === 'B' ? '买入' : '卖出';
                            const typeColor = t.type === 'B' ? '#10b981' : '#f43f5e';
                            tradeHtml += `
                                <div style="display:flex; justify-content:space-between; color:${typeColor}; font-weight:bold;">
                                    <span>${typeLabel} (触发价: ${t.price.toFixed(3)})</span>
                                    <span>成交</span>
                                </div>
                            `;
                        });
                        tradeHtml += `</div>`;
                    }

                    return `
                        <div style="font-size:12px; min-width: 140px; font-family: sans-serif;">
                            <div style="font-weight:bold; margin-bottom:6px; color:#fff; border-bottom:1px solid #444; padding-bottom:4px;">
                                ${item.timestamp.split(' ')[1]} 分时数据
                            </div>
                            <div style="display:grid; grid-template-columns: 40px 1fr; gap: 4px; line-height: 1.6;">
                                <span style="color:#888">开盘:</span> <span style="text-align:right; font-family:monospace; color:#ccc">${item.open.toFixed(3)}</span>
                                <span style="color:#888">最高:</span> <span style="text-align:right; font-family:monospace; color:#ccc">${item.high.toFixed(3)}</span>
                                <span style="color:#888">最低:</span> <span style="text-align:right; font-family:monospace; color:#ccc">${item.low.toFixed(3)}</span>
                                <span style="color:#888">收盘:</span> <span style="text-align:right; font-family:monospace; color:${colorPrice}">${item.close.toFixed(3)}</span>
                                ${preCloseHtml}
                                <span style="color:#888">成交:</span> <span style="text-align:right; font-family:monospace; color:#ccc">${(volVal || 0).toLocaleString()}</span>
                            </div>
                            ${tradeHtml}
                        </div>
                    `;
                }
            },
            axisPointer: {
                link: { xAxisIndex: 'all' }
            },
            grid: [
                {
                    left: '50', // Fixed left margin for price axis labels
                    right: '80', // More space for labels
                    top: '30',
                    height: '60%'
                },
                {
                    left: '50',
                    right: '80',
                    top: '75%',
                    height: '15%'
                }
            ],
            xAxis: [
                {
                    type: 'category',
                    data: dates,
                    boundaryGap: false,
                    axisLine: { lineStyle: { color: '#444' } },
                    axisLabel: { color: '#888' },
                    min: 'dataMin',
                    max: 'dataMax'
                },
                {
                    type: 'category',
                    gridIndex: 1,
                    data: dates,
                    boundaryGap: false,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: { show: false },
                    min: 'dataMin',
                    max: 'dataMax'
                }
            ],
            yAxis: [
                {
                    type: 'value',
                    scale: true,
                    min: yMin,
                    max: yMax,
                    splitLine: {
                        show: true,
                        lineStyle: {
                            color: 'rgba(255,255,255,0.05)'
                        }
                    },
                    axisLabel: {
                        color: '#888',
                        formatter: (value) => value.toFixed(3)
                    },
                    axisPointer: {
                        snap: true,
                        label: {
                            precision: 3
                        }
                    }
                },
                {
                    scale: true,
                    gridIndex: 1,
                    splitNumber: 2,
                    axisLabel: { show: false },
                    axisLine: { show: false },
                    axisTick: { show: false },
                    splitLine: { show: false }
                }
            ],
            dataZoom: [
                {
                    type: 'inside',
                    xAxisIndex: [0, 1],
                    start: 0,
                    end: 100,
                    minSpan: 5, // Limit zoom to avoid looking too granular (e.g. < 5% of day)
                    preventDefaultMouseMove: false
                },
                {
                    show: true,
                    xAxisIndex: [0, 1],
                    type: 'slider',
                    bottom: 0,
                    start: 0,
                    end: 100,
                    minSpan: 5,
                    borderColor: '#333',
                    dataBackground: {
                        lineStyle: { color: '#444' },
                        areaStyle: { color: '#222' }
                    },
                    handleStyle: {
                        color: '#6366f1',
                        borderColor: '#6366f1'
                    },
                    textStyle: { color: '#888' }
                }
            ],
            series: [
                {
                    name: '价格',
                    type: 'line',
                    data: prices,
                    smooth: true,
                    showSymbol: true,
                    symbol: 'circle',
                    symbolSize: (val, params) => selectedIndices.includes(params.dataIndex) ? 12 : 6,
                    triggerLineEvent: true, // Make the line area also clickable
                    itemStyle: {
                        color: (params) => selectedIndices.includes(params.dataIndex) ? '#fbbf24' : '#38bdf8',
                        opacity: (params) => selectedIndices.includes(params.dataIndex) ? 1 : 0.4
                    },
                    z: 10, // Ensure price line and points are on top of everything
                    lineStyle: {
                        color: '#38bdf8',
                        width: 2
                    },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(56, 189, 248, 0.3)' },
                            { offset: 1, color: 'rgba(56, 189, 248, 0.0)' }
                        ])
                    },
                    // Grid Lines (Buy/Sell) remain as markLines (background)
                    markLine: {
                        symbol: ['none', 'none'],
                        data: gridChartLines,
                        animation: false,
                        silent: true
                    },
                    // Use MarkPoints ONLY for User Selection (Points 1 & 2)
                    markPoint: {
                        data: selectedIndices.map((idx, i) => ({
                            name: `点${i + 1}`,
                            coord: [idx, prices[idx]],
                            value: prices[idx].toFixed(3),
                            itemStyle: { color: i === 0 ? '#38bdf8' : '#fbbf24' },
                            label: {
                                show: true, boxPadding: [2, 4], backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 2,
                                color: '#fff', fontSize: 10, position: 'top', formatter: `{b}: {c}`
                            }
                        })),
                        animation: false,
                        silent: true
                    }
                },
                // --- Real Scatter Series to replace MarkPoints for Trades ---
                // Buy Points
                {
                    name: '买入点',
                    type: 'scatter',
                    data: buyScatterData,
                    symbol: 'circle',
                    symbolSize: 12,
                    itemStyle: {
                        color: '#10b981',
                        borderColor: '#fff',
                        borderWidth: 2,
                        shadowBlur: 5,
                        shadowColor: 'rgba(16,185,129,0.8)'
                    },
                    label: {
                        show: true,
                        formatter: 'B',
                        position: 'bottom',
                        color: '#10b981',
                        fontWeight: 'bold',
                        fontSize: 12,
                        distance: 5
                    },
                    z: 20 // Higher than line
                },
                // Sell Points
                {
                    name: '卖出点',
                    type: 'scatter',
                    data: sellScatterData,
                    symbol: 'circle',
                    symbolSize: 12,
                    itemStyle: {
                        color: '#f43f5e',
                        borderColor: '#fff',
                        borderWidth: 2,
                        shadowBlur: 5,
                        shadowColor: 'rgba(244,63,94,0.8)'
                    },
                    label: {
                        show: true,
                        formatter: 'S',
                        position: 'top',
                        color: '#f43f5e',
                        fontWeight: 'bold',
                        fontSize: 12,
                        distance: 5
                    },
                    z: 20
                },
                // Grid Baseline
                initialPrice && {
                    name: '网格基准',
                    type: 'line',
                    data: prices.map(() => parseFloat(initialPrice)),
                    showSymbol: false,
                    lineStyle: { color: '#a855f7', width: 2, type: 'dashed', opacity: 0.8 },
                    label: { show: false },
                    endLabel: {
                        show: true,
                        formatter: `基准: ${parseFloat(initialPrice).toFixed(3)}`,
                        color: '#a855f7',
                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                        padding: [2, 4],
                        borderRadius: 2,
                        offset: [2, 0], // 保持水平间距，垂直对齐
                        fontSize: 11
                    },
                    z: 5
                },
                // Highlighted K-Lines for Trades (Robust Implementation)
                {
                    name: '成交K线',
                    type: 'candlestick',
                    data: (() => {
                        const indexOffset = hasSynthesizedStart ? 1 : 0;
                        const klineData = new Array(prices.length).fill('-');

                        // 仅保留有成交的点位
                        const tradeIndices = new Set(tradePoints.map(t => t.index + indexOffset));

                        tradeIndices.forEach(idx => {
                            const dataIdx = idx - indexOffset;
                            if (dataIdx >= 0 && dataIdx < data.length) {
                                const item = data[dataIdx];
                                const open = parseFloat(item.open);
                                const close = parseFloat(item.close);
                                const low = parseFloat(item.low);
                                const high = parseFloat(item.high);

                                // ECharts Candlestick: [Open, Close, Low, High]
                                // 移除之前的影线拉伸逻辑，保持原始行情数据
                                klineData[idx] = [open, close, low, high];
                            }
                        });

                        return klineData;
                    })(),
                    itemStyle: {
                        color: '#ef4444',
                        color0: '#10b981',
                        borderColor: '#ef4444',
                        borderColor0: '#10b981',
                        opacity: 0 // 默认隐藏，保持界面美观
                    },
                    emphasis: {
                        itemStyle: {
                            opacity: 0.8 // Hover 时显现
                        }
                    },
                    tooltip: {
                        formatter: (params) => {
                            const o = params.data[1];
                            const c = params.data[2];
                            const l = params.data[3];
                            const h = params.data[4];
                            return `
                            <div class="font-bold mb-1">成交K线详情</div>
                            <div class="text-xs text-slate-300">Open: ${o}</div>
                            <div class="text-xs text-slate-300">Close: ${c}</div>
                            <div class="text-xs text-slate-300">Low: ${l}</div>
                            <div class="text-xs text-slate-300">High: ${h}</div>
                         `;
                        }
                    },
                    z: 10 // Behind Points (20) but above Line (2)
                },
                // Reference Lines as Real Series for perfect alignment
                {
                    name: '昨收价',
                    type: 'line',
                    data: prices.map(() => preClose || '-'),
                    showSymbol: false,
                    // Only show if preClose is valid and reasonably close to prices to avoid scale issues
                    lineStyle: { color: '#999', width: 1.5, type: 'dashed', opacity: preClose ? 0.6 : 0 },
                    label: { show: false },
                    endLabel: {
                        show: !!preClose,
                        formatter: `昨收: ${preClose ? preClose.toFixed(3) : ''}`,
                        color: '#bbb',
                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                        padding: [2, 4],
                        borderRadius: 2,
                        offset: [2, 0], // 归零垂直偏移，实现对齐
                        fontSize: 11
                    },
                    z: 4
                },
                {
                    name: '开盘价',
                    type: 'line',
                    data: prices.map(() => dayOpen),
                    showSymbol: false,
                    lineStyle: { color: '#fbbf24', width: 1.5, type: 'solid', opacity: 0.6 },
                    label: { show: false },
                    endLabel: {
                        show: true,
                        formatter: `开盘: ${dayOpen.toFixed(3)}`,
                        color: '#fbbf24',
                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                        padding: [2, 4],
                        borderRadius: 2,
                        offset: [2, 0],
                        fontSize: 11
                    },
                    z: 5
                },
                {
                    name: '收盘价',
                    type: 'line',
                    data: prices.map(() => dayClose),
                    showSymbol: false,
                    lineStyle: { color: '#38bdf8', width: 1.5, type: 'solid', opacity: 0.6 },
                    label: { show: false },
                    endLabel: {
                        show: true,
                        formatter: `收盘: ${dayClose.toFixed(3)}`,
                        color: '#38bdf8',
                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                        padding: [2, 4],
                        borderRadius: 2,
                        offset: [2, 0],
                        fontSize: 11
                    },
                    z: 5
                },
                {
                    name: '成交量',
                    type: 'bar',
                    xAxisIndex: 1,
                    yAxisIndex: 1,
                    data: volumes,
                    itemStyle: {
                        color: (params) => {
                            // params.data[2]: 1 表示当日收盘 > 开盘 (涨), -1 表示跌
                            return params.data[2] === 1 ? '#ef4444' : '#22c55e';
                        }
                    }
                }
            ]
        };
    };

    // Calculate difference for overlay
    let measurementInfo = null;
    if (selectedIndices.length === 2) {
        // We need to access prices here too, or just use data props?
        // Let's re-calculate prices or pass it out. 
        // Simpler: use the synthesized prices from getOption by extracting them or making them a helper.
        // For now, just redo the mapping to be safe/quick.
        const rawOpen = dailyInfo ? dailyInfo.open : (data[0] ? data[0].open : 0);
        const dayOpen = parseFloat(rawOpen);
        let chartPrices = data.map(item => item.close);
        if (data.length > 0) {
            const firstTime = data[0].timestamp.split(' ')[1];
            if (firstTime > '09:30' && firstTime <= '10:00') {
                chartPrices.unshift(dayOpen);
            }
        }

        const p1 = chartPrices[selectedIndices[0]];
        const p2 = chartPrices[selectedIndices[1]];
        if (p1 !== undefined && p2 !== undefined) {
            const diff = Math.abs(p1 - p2);
            const minP = Math.min(p1, p2);
            const diffPct = (diff / minP) * 100;
            measurementInfo = {
                diff: diff.toFixed(3),
                pct: diffPct.toFixed(2),
                p1: p1.toFixed(3),
                p2: p2.toFixed(3)
            };
        }
    }

    return (
        <div className="w-full h-full min-h-[500px] relative">
            <ReactECharts
                ref={chartRef}
                option={getOption()}
                style={{ height: '100%', width: '100%' }}
                theme="dark"
                onEvents={onEvents}
            />
            {measurementInfo && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-indigo-900/80 backdrop-blur-md border border-indigo-500/50 px-4 py-2 rounded-lg shadow-xl animate-in fade-in zoom-in duration-200">
                    <div className="flex items-center gap-4 text-sm font-medium">
                        <div className="flex flex-col">
                            <span className="text-indigo-300 text-[10px] uppercase tracking-wider">测距结果</span>
                            <span className="text-white text-lg">
                                {measurementInfo.diff} <span className="text-xs text-indigo-400 font-normal">({measurementInfo.pct}%)</span>
                            </span>
                        </div>
                        <div className="h-8 w-px bg-indigo-500/30 mx-2" />
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                            <span className="text-indigo-300">点1:</span> <span className="text-white font-mono">{measurementInfo.p1}</span>
                            <span className="text-indigo-300">点2:</span> <span className="text-white font-mono">{measurementInfo.p2}</span>
                        </div>
                        <button
                            onClick={() => setSelectedIndices([])}
                            className="ml-4 p-1 hover:bg-white/10 rounded-full transition-colors"
                            title="清除"
                        >
                            <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
            {!measurementInfo && selectedIndices.length === 1 && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-black/60 backdrop-blur-sm border border-white/10 px-3 py-1.5 rounded-full text-[10px] text-white/80 animate-pulse">
                    请点击图表上的第二个点以计算差值
                </div>
            )}
        </div>
    );
};

export default VolatilityChart;
