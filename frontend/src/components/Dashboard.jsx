
import React, { useState, useEffect, useMemo } from 'react';
import VolatilityChart from './VolatilityChart';
import { getKlines, getDailyKlines, getAvailableDates } from '../lib/api';
import { Settings, RefreshCw, TrendingUp, DollarSign } from 'lucide-react';

const Dashboard = () => {
    const [data, setData] = useState([]); // Current displayed klines (for selected date)
    const [currentDayInfo, setCurrentDayInfo] = useState(null);
    const [loading, setLoading] = useState(false);
    const [availableDates, setAvailableDates] = useState([]);
    const [selectedDate, setSelectedDate] = useState('');

    const [gridStep, setGridStep] = useState(0.5);
    const [initialPrice, setInitialPrice] = useState('');
    const [stats, setStats] = useState({ volatility: 0, range: 0 });

    // 1. Initial Load: Just get available dates
    const initData = async () => {
        try {
            const dates = await getAvailableDates();
            setAvailableDates(dates);

            // Auto Select Latest Date
            if (dates.length > 0 && !selectedDate) {
                const latest = dates[dates.length - 1];
                setSelectedDate(latest);
            }
        } catch (err) {
            console.error("Init failed", err);
        }
    };

    useEffect(() => {
        initData();
    }, []);

    // 2. Fetch Detailed Klines & Daily Info when Date Selected
    const fetchData = async () => {
        if (!selectedDate) return;
        setLoading(true);
        try {
            console.log("Fetching data for:", selectedDate);
            const [klines, dailies] = await Promise.all([
                getKlines(selectedDate),
                getDailyKlines(selectedDate)
            ]);

            setData(klines);
            setCurrentDayInfo(dailies.length > 0 ? dailies[0] : null);

            // Set Initial Price default
            if (klines.length > 0 && !initialPrice) {
                setInitialPrice(klines[klines.length - 1].close);
            }
            calculateStats(klines);
        } catch (err) {
            console.error("Fetch failed", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000);
        return () => clearInterval(interval);
    }, [selectedDate]);

    const calculateStats = (klines) => {
        if (!klines || klines.length === 0) return;
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const max = Math.max(...highs);
        const min = Math.min(...lows);
        const range = ((max - min) / min) * 100;

        setStats({
            range: range.toFixed(2),
            volatility: (range / 4).toFixed(2)
        });
    };



    return (
        <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white">
            {/* Header */}
            <header className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/5 backdrop-blur-md sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-500 rounded-lg shadow-lg shadow-indigo-500/20">
                        <TrendingUp className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">红利低波网格分析</h1>
                        <p className="text-xs text-slate-400 font-medium tracking-wide">512890 华泰柏瑞红利低波ETF</p>
                    </div>
                </div>
                <button
                    onClick={fetchData}
                    className="p-2 rounded-full hover:bg-white/10 transition-colors active:scale-95 duration-200"
                    title="刷新数据"
                >
                    <RefreshCw className={`w-5 h-5 text-indigo-400 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </header>

            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar Controls */}
                <aside className="w-80 border-r border-white/10 bg-white/5 p-6 flex flex-col gap-6 overflow-y-auto hidden md:flex">

                    {/* Date Selector */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-indigo-400 mb-2">
                            <div className="w-4 h-4 rounded-full border-2 border-indigo-400"></div>
                            <h2 className="text-sm font-semibold uppercase tracking-wider">选择日期</h2>
                        </div>
                        <div className="relative">
                            <select
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all font-mono appearance-none"
                            >
                                {availableDates.map(date => (
                                    <option key={date} value={date} className="bg-slate-900 text-slate-200">{date}</option>
                                ))}
                            </select>
                            <div className="absolute right-4 top-3.5 pointer-events-none text-slate-500">
                                ▼
                            </div>
                        </div>
                    </div>

                    <div className="w-full h-px bg-white/5 my-2"></div>

                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-indigo-400 mb-2">
                            <Settings className="w-4 h-4" />
                            <h2 className="text-sm font-semibold uppercase tracking-wider">网格设置</h2>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-400 ml-1">网格步长 (Ratio)</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    step="0.1"
                                    value={gridStep}
                                    onChange={(e) => setGridStep(e.target.value)}
                                    className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all font-mono"
                                />
                                <span className="absolute right-4 top-3 text-slate-500 text-xs font-bold">%</span>
                            </div>
                            <p className="text-[10px] text-slate-500 px-1">建议: 0.5% - 1.0% (低波)</p>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-400 ml-1">基准价格 (Base Price)</label>
                            <div className="relative">
                                <div className="absolute left-4 top-3 text-slate-500">
                                    <DollarSign className="w-3.5 h-3.5" />
                                </div>
                                <input
                                    type="number"
                                    step="0.001"
                                    value={initialPrice}
                                    onChange={(e) => setInitialPrice(e.target.value)}
                                    className="w-full bg-black/20 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all font-mono"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-emerald-400 mb-2">
                            <TrendingUp className="w-4 h-4" />
                            <h2 className="text-sm font-semibold uppercase tracking-wider">当日统计 ({selectedDate.slice(5)})</h2>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                                <p className="text-xs text-slate-400 mb-1">振幅 (Range)</p>
                                <p className="text-xl font-bold font-mono text-white">{stats.range}%</p>
                            </div>
                            <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                                <p className="text-xs text-slate-400 mb-1">波动因子</p>
                                <p className="text-xl font-bold font-mono text-white">{stats.volatility}</p>
                            </div>
                        </div>
                    </div>

                    <div className="mt-auto p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                        <p className="text-xs text-indigo-200 leading-relaxed">
                            <strong>提示:</strong> 如果价格曲线在一天内频繁穿过黄色的网格线，说明该步长适合“吃肉”。
                        </p>
                    </div>
                </aside>

                {/* Main Chart Area */}
                <main className="flex-1 relative bg-gradient-to-br from-slate-950 to-slate-900">
                    {loading ? (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="flex flex-col items-center gap-4">
                                <RefreshCw className="w-10 h-10 text-indigo-500 animate-spin" />
                                <p className="text-slate-400 animate-pulse text-sm font-medium">Loading Market Data...</p>
                            </div>
                        </div>
                    ) : (
                        <div className="w-full h-full p-6">
                            <div className="w-full h-full bg-black/20 rounded-3xl border border-white/5 shadow-2xl overflow-hidden backdrop-blur-sm">
                                <VolatilityChart data={data} dailyInfo={currentDayInfo} gridStep={gridStep} initialPrice={initialPrice} />
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default Dashboard;
