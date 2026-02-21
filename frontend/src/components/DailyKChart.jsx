import React, { useState, useEffect, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { getDailyKlines } from '../lib/api';
import { Loader2, CalendarRange } from 'lucide-react';

const RANGES = [
    { label: '1周', days: 5 },
    { label: '2周', days: 10 },
    { label: '1个月', days: 22 },
    { label: '2个月', days: 44 },
    { label: '半年', days: 120 },
    { label: '今年', days: 'YTD' }, // Special logic for Year to date
    { label: '全部', days: 0 }
];

const DailyKChart = ({ symbol, startDate }) => {
    const chartRef = useRef(null);
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [activeRange, setActiveRange] = useState(120); // Default to '半年' (120 trading days) instead of '全部'

    // When data loads, potentially apply initial zoom if not '全部', 
    // but we default to '全部' (0) here, so option natively uses it.

    useEffect(() => {
        if (!symbol) return;

        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                // Fetch daily klines without date filter to get history
                const result = await getDailyKlines('', symbol);
                setData(result);
            } catch (err) {
                console.error("Failed to fetch daily klines:", err);
                setError(err.message || '获取日K线数据失败');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [symbol]);

    if (loading) {
        return (
            <div className="w-full h-[500px] flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-slate-400">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    <span className="text-sm font-medium tracking-widest uppercase">加载历史日K数据...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full h-[500px] flex items-center justify-center">
                <div className="text-rose-400 bg-rose-500/10 px-6 py-4 rounded-xl border border-rose-500/20 text-sm">
                    {error}
                </div>
            </div>
        );
    }

    if (!data || data.length === 0) {
        return (
            <div className="w-full h-[500px] flex items-center justify-center">
                <span className="text-slate-500 text-sm">暂无日K数据</span>
            </div>
        );
    }

    const handleRangeChange = (range) => {
        setActiveRange(range.days);
        const echartsInstance = chartRef.current?.getEchartsInstance();
        if (!echartsInstance || data.length === 0) return;

        let startValue, endValue;

        if (range.days === 0) {
            startValue = 0;
            endValue = 100;
        } else if (range.days === 'YTD') {
            // Find the start of the current year in data
            const currentYear = new Date().getFullYear().toString();
            let ytdIndex = data.findIndex(d => d.timestamp.startsWith(currentYear));

            // If current year is not found (e.g. 2026 data not yet available), 
            // fallback to the beginning of the latest available year in data
            if (ytdIndex === -1 && data.length > 0) {
                const latestYear = data[data.length - 1].timestamp.slice(0, 4);
                ytdIndex = data.findIndex(d => d.timestamp.startsWith(latestYear));
            }

            if (ytdIndex === -1) ytdIndex = 0; // ultimate fallback
            startValue = (ytdIndex / data.length) * 100;
            endValue = 100;
        } else {
            // Calculate percentage based on trading days
            const daysToFocus = range.days;
            const startIndex = Math.max(0, data.length - daysToFocus);
            startValue = (startIndex / data.length) * 100;
            endValue = 100;
        }

        echartsInstance.dispatchAction({
            type: 'dataZoom',
            start: startValue,
            end: endValue
        });
    };

    // Prepare ECharts Data
    // K-line data format: [open, close, lowest, highest]
    const dates = data.map(item => item.timestamp.slice(0, 10)); // YYYY-MM-DD
    const klineData = data.map(item => [item.open, item.close, item.low, item.high]);

    const upColor = '#ef4444'; // Red for up
    const upBorderColor = '#ef4444';
    const downColor = '#10b981'; // Green for down
    const downBorderColor = '#10b981';

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            axisPointer: {
                type: 'cross'
            },
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            borderColor: '#334155',
            borderWidth: 1,
            textStyle: {
                color: '#f8fafc',
                fontSize: 12
            },
            formatter: function (params) {
                if (!params || params.length === 0) return '';
                const param = params[0];
                if (param.componentSubType === 'candlestick') {
                    const dataIndex = param.dataIndex;
                    const item = data[dataIndex];

                    const isUp = item.close >= item.open;
                    const color = isUp ? upColor : downColor;
                    const changeVal = item.close - (dataIndex > 0 ? data[dataIndex - 1].close : item.open);
                    const changePct = dataIndex > 0 ? (changeVal / data[dataIndex - 1].close) * 100 : ((item.close - item.open) / item.open) * 100;

                    return `
                        <div style="font-family: monospace;">
                            <div style="margin-bottom:8px; border-bottom: 1px solid #334155; padding-bottom: 4px; font-weight: bold; color: #94a3b8;">
                                ${item.timestamp.slice(0, 10)}
                            </div>
                            <div style="display:flex; flex-direction:column; gap:4px;">
                                <div style="display:flex; justify-content:space-between; width:120px;">
                                    <span style="color:#64748b;">今开</span> 
                                    <span style="font-weight:bold;">${item.open.toFixed(3)}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; width:120px;">
                                    <span style="color:#64748b;">今收</span> 
                                    <span style="font-weight:bold; color:${color};">${item.close.toFixed(3)}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; width:120px;">
                                    <span style="color:#64748b;">最高</span> 
                                    <span style="font-weight:bold;">${item.high.toFixed(3)}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; width:120px;">
                                    <span style="color:#64748b;">最低</span> 
                                    <span style="font-weight:bold;">${item.low.toFixed(3)}</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; width:120px; margin-top:4px;">
                                    <span style="color:#64748b;">涨跌幅</span> 
                                    <span style="font-weight:bold; color:${color};">${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%</span>
                                </div>
                            </div>
                        </div>
                    `;
                }
                return '';
            }
        },
        grid: {
            left: '10%',
            right: '5%',
            bottom: '15%',
            top: '5%'
        },
        xAxis: {
            type: 'category',
            data: dates,
            scale: true,
            boundaryGap: true,
            axisLine: { onZero: false, lineStyle: { color: '#334155' } },
            splitLine: { show: false },
            min: 'dataMin',
            max: 'dataMax',
            axisLabel: {
                color: '#64748b',
                fontFamily: 'monospace'
            }
        },
        yAxis: {
            scale: true,
            splitArea: { show: false },
            splitLine: {
                lineStyle: {
                    color: 'rgba(255,255,255,0.05)',
                    type: 'dashed'
                }
            },
            axisLabel: {
                color: '#64748b',
                fontFamily: 'monospace',
                formatter: (value) => value.toFixed(3)
            }
        },
        dataZoom: [
            {
                type: 'inside',
                // We leave the initial zoom to default to last ~3 months visually unless activeRange dictates otherwise. 
                // But since activeRange default is 0 (all), we should initialize it to 0.
                // Wait, if activeRange is '全部', the initial zoom should be 0.
                start: activeRange === 0 ? 0 :
                    (activeRange === 'YTD' ?
                        (() => {
                            const currentYear = new Date().getFullYear().toString();
                            let idx = data.findIndex(d => d.timestamp.startsWith(currentYear));
                            if (idx === -1) {
                                const latestYear = data[data.length - 1].timestamp.slice(0, 4);
                                idx = data.findIndex(d => d.timestamp.startsWith(latestYear));
                            }
                            return idx === -1 ? 0 : (idx / data.length * 100);
                        })()
                        : Math.max(0, 100 - (activeRange / data.length * 100))),
                end: 100
            },
            {
                show: true,
                type: 'slider',
                bottom: 10,
                borderColor: '#1e293b',
                textStyle: { color: '#64748b' },
                dataBackground: {
                    lineStyle: { color: '#334155' },
                    areaStyle: { color: '#0f172a' }
                },
                selectedDataBackground: {
                    lineStyle: { color: '#6366f1' },
                    areaStyle: { color: 'rgba(99, 102, 241, 0.2)' }
                },
                handleStyle: {
                    color: '#6366f1',
                    borderColor: '#4f46e5'
                }
            }
        ],
        series: [
            {
                name: 'K-line',
                type: 'candlestick',
                data: klineData,
                barMaxWidth: 35, // Prevent columns from becoming too wide visually when selecting 1 week
                barMinWidth: 4,
                itemStyle: {
                    color: upColor,
                    color0: downColor,
                    borderColor: upBorderColor,
                    borderColor0: downBorderColor
                }
            }
        ]
    };

    return (
        <div className="w-full h-full min-h-[500px] p-2 flex flex-col">
            {/* Header: Date Range Selector */}
            <div className="flex items-center gap-4 px-4 py-2 mb-2">
                <div className="flex items-center gap-1.5 text-slate-400">
                    <CalendarRange className="w-4 h-4" />
                    <span className="text-xs font-medium uppercase tracking-wider">时间范围</span>
                </div>
                <div className="flex items-center bg-black/20 p-1 rounded-lg border border-white/5">
                    {RANGES.map(range => (
                        <button
                            key={range.label}
                            onClick={() => handleRangeChange(range)}
                            className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all duration-200 ${activeRange === range.days
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20'
                                : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                                }`}
                        >
                            {range.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Chart */}
            <div className="flex-1 relative min-h-0">
                <ReactECharts
                    ref={chartRef}
                    option={option}
                    style={{ height: '100%', width: '100%', position: 'absolute' }}
                    theme="dark"
                    notMerge={false} // Allow incremental updates safely
                />
            </div>
        </div>
    );
};

export default DailyKChart;
