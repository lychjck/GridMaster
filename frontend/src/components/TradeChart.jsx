import React, { useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';

const TradeChart = ({ data, trades }) => {
    const chartRef = useRef(null);

    // 1. Prepare Data
    if (!data || data.length === 0) return <div className="text-slate-500 text-center py-10">暂无图表数据</div>;

    const dates = data.map(item => item.timestamp);
    const prices = data.map(item => item.close);
    const timestamps = data.map(item => item.timestamp); // For mapping trades

    // 2. Map Trades to Chart Points
    // We need to find the closest data index for each trade
    const buyPoints = [];
    const sellPoints = [];

    // Helper map for O(1) lookup if timestamps match exactly, or O(N) scan.
    // Since data is sorted, we can do binary search or simpler map if simple strings.
    // Let's rely on simple string matching first.
    const timeToIndex = {};
    data.forEach((item, idx) => {
        timeToIndex[item.timestamp] = idx;
    });

    trades.forEach(trade => {
        const idx = timeToIndex[trade.time];
        if (idx !== undefined) {
            const point = {
                coord: [idx, trade.price],
                value: trade.price.toFixed(3),
                itemStyle: { color: trade.type === 'BUY' ? '#10b981' : '#f43f5e' }, // Emerald-500 : Rose-500
                label: {
                    formatter: trade.type === 'BUY' ? 'B' : 'S',
                    fontSize: 10,
                    offset: [0, -5]
                },
                tooltip: {
                    formatter: `${trade.type === 'BUY' ? '买入' : '卖出'} <br/>价格: ${trade.price}<br/>时间: ${trade.time}`
                }
            };

            if (trade.type === 'BUY') {
                buyPoints.push(point);
            } else {
                sellPoints.push(point);
            }
        }
    });

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            backgroundColor: 'rgba(20, 20, 25, 0.9)',
            borderColor: '#444',
            textStyle: { color: '#eee' },
            formatter: function (params) {
                if (!params || params.length === 0) return '';
                const idx = params[0].dataIndex;
                const item = data[idx];
                return `
                    <div style="font-size:12px;">
                        <div style="margin-bottom:4px; font-weight:bold;">${item.timestamp}</div>
                        <div>价格: <span style="color:#38bdf8">${item.close.toFixed(4)}</span></div>
                    </div>
                `;
            }
        },
        grid: {
            left: '50',
            right: '20',
            top: '30',
            bottom: '60'
        },
        dataZoom: [
            {
                type: 'inside',
                start: 0,
                end: 100
            },
            {
                show: true,
                type: 'slider',
                bottom: 10,
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
        xAxis: {
            type: 'category',
            data: dates,
            axisLine: { lineStyle: { color: '#444' } },
            axisLabel: { color: '#888' },
        },
        yAxis: {
            type: 'value',
            scale: true,
            axisLabel: {
                color: '#888',
                formatter: (value) => value.toFixed(3)
            },
            splitLine: {
                lineStyle: { color: 'rgba(255,255,255,0.05)' }
            }
        },
        series: [
            {
                name: 'Price',
                type: 'line',
                data: prices,
                showSymbol: false,
                lineStyle: {
                    color: '#38bdf8',
                    width: 2
                },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(56, 189, 248, 0.2)' },
                        { offset: 1, color: 'rgba(56, 189, 248, 0.0)' }
                    ])
                },
                markPoint: {
                    symbol: 'pin',
                    symbolSize: 30,
                    data: [...buyPoints, ...sellPoints],
                    label: {
                        color: '#fff',
                        fontWeight: 'bold'
                    }
                }
            }
        ]
    };

    return (
        <div className="w-full h-[500px]">
            <ReactECharts
                ref={chartRef}
                option={option}
                style={{ height: '100%', width: '100%' }}
                theme="dark"
            />
        </div>
    );
};

export default TradeChart;
