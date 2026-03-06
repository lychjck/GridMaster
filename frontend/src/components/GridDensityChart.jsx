import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

export default function GridDensityChart({ data }) {
    const options = useMemo(() => {
        if (!data || data.length === 0) return {};

        // Sort data by price level (ascending) for Y-axis
        const sortedData = [...data].sort((a, b) => a.priceLevel - b.priceLevel);

        const yAxisData = sortedData.map(d => d.priceLevel.toFixed(3));
        const seriesData = sortedData.map(d => d.tradeCount);

        return {
            title: {
                text: '网格成交密度分布 (Grid Density)',
                left: 'center',
                textStyle: {
                    color: '#cbd5e1', // text-slate-300
                    fontSize: 14,
                    fontWeight: 'normal',
                }
            },
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                textStyle: { color: '#f8fafc' },
                axisPointer: {
                    type: 'shadow'
                },
                formatter: (params) => {
                    const p = params[0];
                    return `网格线: <b>${p.name}</b><br/>共成交: <b>${p.value}</b> 次 (买+卖)`;
                }
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                containLabel: true
            },
            xAxis: {
                type: 'value',
                name: '成交频次',
                nameTextStyle: { color: '#94a3b8' },
                axisLabel: { color: '#94a3b8' },
                minInterval: 1,
                splitLine: {
                    lineStyle: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    }
                }
            },
            yAxis: {
                type: 'category',
                name: '价格区间',
                nameTextStyle: { color: '#94a3b8' },
                data: yAxisData,
                axisLabel: {
                    color: '#cbd5e1',
                    formatter: (value) => Number(value).toFixed(2)
                },
                axisTick: { show: false },
                axisLine: {
                    lineStyle: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            },
            series: [
                {
                    name: '成交次数',
                    type: 'bar',
                    data: seriesData,
                    itemStyle: {
                        color: '#3b82f6', // blue-500 baseline
                        borderRadius: [0, 4, 4, 0]
                    },
                    // Custom color intensity based on value
                    visualMap: {
                        show: false,
                        min: 0,
                        max: Math.max(...seriesData, 1),
                        inRange: {
                            color: ['#93c5fd', '#3b82f6', '#1d4ed8'] // blue-300 to blue-700
                        }
                    }
                }
            ]
        };
    }, [data]);

    if (!data || data.length === 0) {
        return null;
    }

    return (
        <div className="w-full h-full p-4">
            <ReactECharts
                option={options}
                style={{ height: '350px', width: '100%' }}
                opts={{ renderer: 'canvas' }}
            />
        </div>
    );
}
