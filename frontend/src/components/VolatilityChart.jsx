import React, { useEffect, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';

const VolatilityChart = ({ data, dailyInfo, gridStep, initialPrice }) => {
    const chartRef = useRef(null);
    const [selectedIndices, setSelectedIndices] = useState([]);

    const onChartClick = (params) => {
        console.log("Chart clicked:", params.componentType, params.seriesName, "dataIndex:", params.dataIndex);
        // Only trigger on data points or the line series
        if (params.dataIndex !== undefined) {
            const index = params.dataIndex;
            setSelectedIndices(prev => {
                const newIndices = prev.length >= 2 ? [index] :
                    prev.includes(index) ? prev.filter(i => i !== index) :
                        [...prev, index];
                console.log("New selectedIndices:", newIndices);
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
        console.log("dailyInfo received:", dailyInfo);
        const rawOpen = dailyInfo ? dailyInfo.open : data[0].open;
        const rawClose = dailyInfo ? dailyInfo.close : data[data.length - 1].close;

        // Force Number type to avoid ECharts axis mismatch or string quoting
        const dayOpen = parseFloat(rawOpen);
        const dayClose = parseFloat(rawClose);
        console.log("dayOpen:", dayOpen, "dayClose:", dayClose);

        // Synthesize 09:30 data point if missing (common in minute data starting at 09:31)
        // This ensures the chart looks "connected" from the open.
        let chartDates = data.map(item => item.timestamp);
        let chartPrices = data.map(item => item.close);
        let chartVolumes = data.map((item, index) => [index, item.volume, item.open > item.close ? 1 : -1]);

        if (data.length > 0) {
            const firstTime = data[0].timestamp.split(' ')[1]; // HH:MM
            if (firstTime === '09:31') {
                const datePart = data[0].timestamp.split(' ')[0];
                const startTime = `${datePart} 09:30`;

                // Prepend 09:30 point
                chartDates.unshift(startTime);
                chartPrices.unshift(dayOpen); // Use Open price for 09:30 anchor
                // Volume for 09:30 is 0 or synthetic. ECharts bar chart will shift.
                // We need to re-map volumes index since we added a point at index 0.

                // Re-calculate volumes with offset
                chartVolumes = [
                    [0, 0, 1], // 09:30 dummy volume
                    ...data.map((item, index) => [index + 1, item.volume, item.open > item.close ? 1 : -1])
                ];
            }
        } else if (dailyInfo) {
            // If no minute data but we have daily info (e.g. market just opened), 
            // we could potentially show a single point, but let's leave empty for now.
        }

        // Use synthesized arrays for rendering
        const allPrices = [...chartPrices, dayOpen, dayClose];
        const prices = chartPrices;
        const dates = chartDates;
        const volumes = chartVolumes;

        const priceRange = Math.max(...allPrices) - Math.min(...allPrices);
        const padding = Math.max(priceRange * 0.2, 0.005); // Increase padding to 20%
        const yMin = Math.min(...allPrices) - padding;
        const yMax = Math.max(...allPrices) + padding;
        console.log("Y-axis range:", yMin, yMax, "padding:", padding);

        // Calculate Grid Lines
        const gridChartLines = [];

        // Note: Open and Close prices are now rendered as separate Series for precision.
        // We only add Grid Step lines (Buy/Sell) and Base Price here.


        if (gridStep && initialPrice) {
            const base = parseFloat(initialPrice);
            // Only add Base Line
            // Base Line is key, so we usually want to show it. 
            // Check overlap with Close line (now a series) - purely for visual overlap of the *Base Line* markLine.
            // Since Close is a series, it's always drawn. Base is a markLine.
            // If they overlap exactly, Base line (white) might cover Close line (blue) or vice versa depending on z-index.
            // MarkLines usually float on top.

            const baseOverlapsClose = Math.abs(base - dayClose) < 0.0001;

            if (!baseOverlapsClose) {
                gridChartLines.push({
                    yAxis: base,
                    label: {
                        formatter: '基准价',
                        position: 'end',
                        color: '#fff',
                        fontWeight: 'bold',
                        fontSize: 10
                    },
                    lineStyle: {
                        color: 'rgba(255, 255, 255, 0.3)',
                        type: 'solid',
                        width: 1
                    }
                });
            }
        }

        // Calculate default zoom start to show FULL DAY (0 to 100) since data is already filtered
        const defaultZoomStart = 0;

        console.log("Final gridChartLines:", JSON.stringify(gridChartLines));

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
                    const index = params[0].dataIndex;
                    if (!data[index]) return '';

                    const item = data[index];
                    const timeStr = item.timestamp.split(' ')[1];

                    // Find volume data in params (seriesName = '成交量')
                    const volSeries = params.find(p => p.seriesName === '成交量');
                    let volVal = 0;
                    if (volSeries && volSeries.data) {
                        // Volume data is [index, volume, sign]
                        volVal = volSeries.data[1];
                    } else {
                        volVal = item.volume;
                    }

                    const colorPrice = item.close >= item.open ? '#ef4444' : '#22c55e';
                    const diff = item.close - item.open;
                    const diffPct = (diff / item.open) * 100;
                    const sign = diff >= 0 ? '+' : '';

                    return `
    <div style="font-size:12px; min-width: 140px; font-family: sans-serif;">
                            <div style="font-weight:bold; margin-bottom:6px; color:#fff; border-bottom:1px solid #444; padding-bottom:4px;">
                                ${timeStr} 分时数据
                            </div>
                            <div style="display:grid; grid-template-columns: 40px 1fr; gap: 4px; line-height: 1.6;">
                                <span style="color:#888">开盘:</span> <span style="text-align:right; font-family:monospace; color:#ccc">${item.open.toFixed(3)}</span>
                                <span style="color:#888">最高:</span> <span style="text-align:right; font-family:monospace; color:#ccc">${item.high.toFixed(3)}</span>
                                <span style="color:#888">最低:</span> <span style="text-align:right; font-family:monospace; color:#ccc">${item.low.toFixed(3)}</span>
                                <span style="color:#888">收盘:</span> <span style="text-align:right; font-family:monospace; color:${colorPrice}">${item.close.toFixed(3)}</span>
                                <span style="color:#888">涨跌:</span> <span style="text-align:right; font-family:monospace; color:${colorPrice}">${sign}${diffPct.toFixed(2)}%</span>
                                <span style="color:#888">成交:</span> <span style="text-align:right; font-family:monospace; color:#ccc">${(volVal || 0).toLocaleString()}</span>
                            </div>
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
                    right: '60', // More space for labels
                    top: '30',
                    height: '60%'
                },
                {
                    left: '50',
                    right: '60',
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
                    // Add markPoints for selection
                    markPoint: {
                        data: selectedIndices.map((idx, i) => ({
                            name: `点${i + 1}`,
                            coord: [idx, prices[idx]],
                            value: prices[idx].toFixed(4),
                            itemStyle: { color: i === 0 ? '#38bdf8' : '#fbbf24' },
                            label: {
                                show: true,
                                position: 'top',
                                formatter: `{b}: {c}`,
                                fontSize: 10,
                                backgroundColor: 'rgba(0,0,0,0.7)',
                                padding: [2, 4],
                                borderRadius: 2
                            }
                        }))
                    }
                },
                // Reference Lines as Real Series for perfect alignment
                {
                    name: '开盘价',
                    type: 'line',
                    data: prices.map(() => dayOpen),
                    showSymbol: false,
                    lineStyle: { color: '#fbbf24', width: 2, type: 'solid' },
                    label: { show: false }, // Tooltip handles it
                    endLabel: {
                        show: true,
                        formatter: `开盘: ${dayOpen.toFixed(3)}`,
                        color: '#fbbf24',
                        offset: [-10, -10], // Adjust to sit above/below
                        fontSize: 11
                    },
                    z: 5
                },
                {
                    name: '收盘价',
                    type: 'line',
                    data: prices.map(() => dayClose),
                    showSymbol: false,
                    lineStyle: { color: '#38bdf8', width: 2, type: 'solid' },
                    label: { show: false },
                    endLabel: {
                        show: true,
                        formatter: `收盘: ${dayClose.toFixed(3)}`,
                        color: '#38bdf8',
                        offset: [-10, 10],
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
        if (data.length > 0 && data[0].timestamp.split(' ')[1] === '09:31') {
            chartPrices.unshift(dayOpen);
        }

        const p1 = chartPrices[selectedIndices[0]];
        const p2 = chartPrices[selectedIndices[1]];
        if (p1 !== undefined && p2 !== undefined) {
            const diff = Math.abs(p1 - p2);
            const minP = Math.min(p1, p2);
            const diffPct = (diff / minP) * 100;
            measurementInfo = {
                diff: diff.toFixed(4),
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

