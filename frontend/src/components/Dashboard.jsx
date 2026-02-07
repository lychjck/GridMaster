
import React, { useState, useEffect, useMemo } from 'react';
import VolatilityChart from './VolatilityChart';
import { getKlines, getDailyKlines, getAvailableDates, getSymbols, addSymbol } from '../lib/api';
import { Settings, RefreshCw, TrendingUp, DollarSign, Plus, Loader2 } from 'lucide-react';
import SimulationPanel from './SimulationPanel';

const Dashboard = () => {
    const [data, setData] = useState([]); // Current displayed klines (for selected date)
    const [currentDayInfo, setCurrentDayInfo] = useState(null);
    const [loading, setLoading] = useState(false);
    const [availableDates, setAvailableDates] = useState([]);
    const [selectedDate, setSelectedDate] = useState('');

    // Symbol State
    const [selectedSymbol, setSelectedSymbol] = useState('512890');
    const [supportedSymbols, setSupportedSymbols] = useState([]);
    const [newSymbol, setNewSymbol] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [addingLoading, setAddingLoading] = useState(false);

    const [gridStep, setGridStep] = useState(0.5);
    const [initialPrice, setInitialPrice] = useState('');
    const [stats, setStats] = useState({ volatility: 0, range: 0 });

    // 0. Fetch Symbols
    const fetchSymbols = async () => {
        try {
            const syms = await getSymbols();
            if (syms && syms.length > 0) {
                // Map API format to UI format
                // API: {symbol, name, market}
                const mapped = syms.map(s => ({
                    code: s.symbol,
                    name: s.name,
                    market: s.market === 1 ? 'SH' : 'SZ'
                }));
                // Manually add default if database is empty initially, or just rely on DB
                if (mapped.length === 0) {
                    // Fallback defaults or empty
                    setSupportedSymbols([
                        { code: '512890', name: '红利低波', market: 'SH' },
                        { code: '510300', name: '沪深300', market: 'SH' },
                        { code: '159915', name: '创业板指', market: 'SZ' }
                    ]);
                } else {
                    setSupportedSymbols(mapped);
                }
            } else {
                // Fallback defaults
                setSupportedSymbols([
                    { code: '512890', name: '红利低波', market: 'SH' },
                    { code: '510300', name: '沪深300', market: 'SH' },
                    { code: '159915', name: '创业板指', market: 'SZ' }
                ]);
            }
        } catch (e) {
            console.error("Failed to fetch symbols", e);
        }
    };

    const handleAddSymbol = async () => {
        if (!newSymbol || newSymbol.length !== 6) {
            alert("请输入6位股票代码");
            return;
        }
        setAddingLoading(true);
        try {
            await addSymbol(newSymbol);
            // Wait a bit for backend to start fetching, then start polling or just reload symbols
            // Ideally we wait for fetch implementation result via SSE or just notify user "Started".
            // Since backend returns "Accepted", we can assume it starts.
            // But we want to select it when it's ready. 
            // For now, let's just refresh list after a short delay or let user wait.
            // A better UX: "Fetching..." then auto refresh.
            // Let's optimize: reload symbols after 2 seconds.
            setTimeout(async () => {
                await fetchSymbols();
                setSelectedSymbol(newSymbol);
                setIsAdding(false);
                setNewSymbol('');
                setAddingLoading(false);
            }, 2000);
        } catch (e) {
            alert("添加失败: " + e.message);
            setAddingLoading(false);
        }
    }

    useEffect(() => {
        fetchSymbols();
    }, []);

    // 1. Initial Load: Just get available dates
    const initData = async () => {
        try {
            const dates = await getAvailableDates(selectedSymbol);
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
    }, [selectedSymbol]); // Re-fetch dates when symbol changes

    // 2. Fetch Detailed Klines & Daily Info when Date Selected
    const fetchData = async () => {
        if (!selectedDate) return;
        setLoading(true);
        try {
            console.log("Fetching data for:", selectedSymbol, selectedDate);
            const [klines, dailies] = await Promise.all([
                getKlines(selectedDate, selectedSymbol),
                getDailyKlines(selectedDate, selectedSymbol)
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
    }, [selectedDate, selectedSymbol]); // Fetch on Symbol or Date change

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



    const [activeTab, setActiveTab] = useState('chart'); // 'chart' | 'simulation'

    const currentSymbolName = supportedSymbols.find(s => s.code === selectedSymbol)?.name || selectedSymbol;

    return (
        <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white">
            {/* Header */}
            <header className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/5 backdrop-blur-md sticky top-0 z-10">
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500 rounded-lg shadow-lg shadow-indigo-500/20">
                            <TrendingUp className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight">GridMaster</h1>
                            <div className="flex items-center gap-2 mt-1">
                                <select
                                    value={selectedSymbol}
                                    onChange={(e) => {
                                        setSelectedSymbol(e.target.value);
                                        setSelectedDate(''); // Reset date on symbol switch
                                        setInitialPrice('');
                                    }}
                                    className="bg-black/30 border border-white/10 rounded px-2 py-0.5 text-xs text-indigo-300 font-mono focus:outline-none hover:bg-black/50 transition-colors"
                                >
                                    {supportedSymbols.map(s => (
                                        <option key={s.code} value={s.code}>{s.code} {s.name}</option>
                                    ))}
                                </select>

                                {/* Add Symbol Button */}
                                {!isAdding ? (
                                    <button
                                        onClick={() => setIsAdding(true)}
                                        className="text-white/40 hover:text-indigo-400 transition-colors"
                                        title="添加新股票"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-1 animate-in slide-in-from-left-2 fade-in duration-200">
                                        <input
                                            autoFocus
                                            type="text"
                                            placeholder="代码"
                                            className="w-16 bg-black/40 border border-indigo-500/50 rounded px-1 py-0.5 text-xs text-white focus:outline-none font-mono"
                                            value={newSymbol}
                                            onChange={(e) => setNewSymbol(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleAddSymbol();
                                                if (e.key === 'Escape') setIsAdding(false);
                                            }}
                                        />
                                        <button
                                            onClick={handleAddSymbol}
                                            disabled={addingLoading}
                                            className="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                                        >
                                            {addingLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : '确定'}
                                        </button>
                                        <button
                                            onClick={() => setIsAdding(false)}
                                            className="text-white/40 hover:text-white text-[10px] px-1"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                )}

                            </div>
                        </div>
                    </div>

                    {/* Tab Navigation */}
                    <div className="bg-black/20 p-1 rounded-lg border border-white/5 flex gap-1 ml-8">
                        <button
                            onClick={() => setActiveTab('chart')}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'chart'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'text-slate-400 hover:text-white hover:bg-white/5'
                                }`}
                        >
                            实时图表
                        </button>
                        <button
                            onClick={() => setActiveTab('simulation')}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'simulation'
                                ? 'bg-indigo-600 text-white shadow-md'
                                : 'text-slate-400 hover:text-white hover:bg-white/5'
                                }`}
                        >
                            网格回测
                        </button>
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
                {/* Sidebar Controls - Only visible for Chart Tab */}
                {activeTab === 'chart' && (
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
                                <strong>提示:</strong> 切换到“网格回测”标签页可进行详细的历史策略回测。
                            </p>
                        </div>
                    </aside>
                )}

                {/* Main Content Area */}
                <main className={`flex-1 relative bg-gradient-to-br from-slate-950 to-slate-900 ${activeTab === 'simulation' ? 'p-8 overflow-y-auto' : ''}`}>
                    {activeTab === 'chart' ? (
                        loading ? (
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
                        )
                    ) : (
                        // Simulation Tab Content - Full Screen
                        <div className="max-w-6xl mx-auto">
                            <SimulationPanel availableDates={availableDates} initialBasePrice={initialPrice} symbol={selectedSymbol} />
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default Dashboard;
