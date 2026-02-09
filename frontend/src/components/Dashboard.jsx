import React, { useState, useEffect } from 'react';
import VolatilityChart from './VolatilityChart';
import { getKlines, getDailyKlines, getAvailableDates, getSymbols, addSymbol, runSimulation, refreshData } from '../lib/api';
import { Settings, RefreshCw, TrendingUp, DollarSign, Plus, Loader2, Search, ChevronDown, Check, X, BarChart3, LineChart, MoveHorizontal, Play, Trash2 } from 'lucide-react';
import SimulationPanel from './SimulationPanel';
import CyberDatePicker from './CyberDatePicker';

const Dashboard = () => {
    // === Domain State ===
    const [data, setData] = useState([]);
    const [currentDayInfo, setCurrentDayInfo] = useState(null);
    const [loading, setLoading] = useState(false);
    const [availableDates, setAvailableDates] = useState([]);
    const [selectedDate, setSelectedDate] = useState(localStorage.getItem('selectedDate') || '');

    // Symbol & Asset State
    const [selectedSymbol, setSelectedSymbol] = useState(localStorage.getItem('selectedSymbol') || '512890');
    const [supportedSymbols, setSupportedSymbols] = useState([]);

    // Adding New Symbol State
    const [newSymbol, setNewSymbol] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [addingLoading, setAddingLoading] = useState(false);

    // Asset Switcher UI State
    const [isAssetSwitcherOpen, setIsAssetSwitcherOpen] = useState(false);
    const [assetSearchTerm, setAssetSearchTerm] = useState('');

    // Date Picker UI State
    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

    // Chart Settings
    const [gridStep, setGridStep] = useState(parseFloat(localStorage.getItem('gridStep')) || 0.5);
    const [gridStepUnit, setGridStepUnit] = useState(localStorage.getItem('gridStepUnit') || 'percent'); // 'percent' | 'value'
    const [initialPrice, setInitialPrice] = useState(localStorage.getItem('initialPrice') || '');
    const [stats, setStats] = useState({ volatility: 0, range: 0, spread: 0 });
    const [simulatedTrades, setSimulatedTrades] = useState([]);
    const [showLiveTrades, setShowLiveTrades] = useState(false);
    const [preClose, setPreClose] = useState(null);

    // UI Tab State
    const [activeTab, setActiveTab] = useState('chart'); // 'chart' | 'simulation'

    // === Effects & Logic ===

    // 0. Fetch Symbols
    const fetchSymbols = async () => {
        try {
            const syms = await getSymbols();
            if (syms && syms.length > 0) {
                const mapped = syms.map(s => ({
                    code: s.symbol,
                    name: s.name,
                    market: s.market === 1 ? 'SH' : 'SZ'
                }));
                if (mapped.length === 0) {
                    setSupportedSymbols([
                        { code: '512890', name: '红利低波', market: 'SH' },
                        { code: '510300', name: '沪深300', market: 'SH' },
                        { code: '159915', name: '创业板指', market: 'SZ' }
                    ]);
                } else {
                    setSupportedSymbols(mapped);
                }
            } else {
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
            setTimeout(async () => {
                await fetchSymbols();
                setSelectedSymbol(newSymbol);
                setIsAdding(false);
                setNewSymbol('');
                setAddingLoading(false);
                setIsAssetSwitcherOpen(false); // Close dropdown
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
    }, [selectedSymbol]);

    // 2. Fetch Detailed Klines & Daily Info when Date Selected
    const fetchData = async () => {
        if (!selectedDate) return;
        setLoading(true);
        try {
            const [klines, dailies] = await Promise.all([
                getKlines(selectedDate, selectedSymbol),
                getDailyKlines(selectedDate, selectedSymbol)
            ]);

            setData(klines);
            setCurrentDayInfo(dailies.length > 0 ? dailies[0] : null);

            // Fetch Pre-Close (Yesterday's Close)
            let preCloseVal = null;
            if (availableDates.length > 0) {
                const idx = availableDates.indexOf(selectedDate);
                if (idx > 0) {
                    const prevDate = availableDates[idx - 1];
                    try {
                        const prevDailies = await getDailyKlines(prevDate, selectedSymbol);
                        if (prevDailies.length > 0) {
                            preCloseVal = prevDailies[0].close;
                        }
                    } catch (e) {
                        console.error("Failed to fetch pre-close", e);
                    }
                } else if (dailies.length > 0 && dailies[0].pre_close) {
                    // Fallback to pre_close field from current day record if provided by backend
                    preCloseVal = dailies[0].pre_close;
                }
            }
            setPreClose(preCloseVal);

            if (klines.length > 0 && !initialPrice) {
                setInitialPrice(klines[0].open.toFixed(3));
            }

            calculateStats(klines);
            // Don't clear trades automatically here, let the [selectedSymbol] effect handle it
        } catch (err) {
            console.error("Fetch failed", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        // 移除自动刷新，避免干扰用户分析
        // const interval = setInterval(fetchData, 60000);
        // return () => clearInterval(interval);
    }, [selectedDate, selectedSymbol, availableDates]);

    // Sync state to localStorage
    useEffect(() => { localStorage.setItem('selectedSymbol', selectedSymbol); }, [selectedSymbol]);
    useEffect(() => { localStorage.setItem('selectedDate', selectedDate); }, [selectedDate]);
    useEffect(() => { localStorage.setItem('gridStep', gridStep); }, [gridStep]);
    useEffect(() => { localStorage.setItem('gridStepUnit', gridStepUnit); }, [gridStepUnit]);
    useEffect(() => { localStorage.setItem('initialPrice', initialPrice); }, [initialPrice]);

    // Clear simulation markers IF AND ONLY IF asset changes, NOT for every fetch
    useEffect(() => {
        setShowLiveTrades(false);
        setSimulatedTrades([]);
    }, [selectedSymbol]);

    // Clear simulation markers if core grid settings change
    useEffect(() => {
        setShowLiveTrades(false);
        setSimulatedTrades([]);
    }, [gridStep, gridStepUnit, initialPrice]);

    // Update stats when data changes
    useEffect(() => {
        if (data && data.length > 0) {
            calculateStats(data);
        }
    }, [data]);

    const calculateStats = (klines) => {
        if (!klines || klines.length === 0) return;
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const max = Math.max(...highs);
        const min = Math.min(...lows);
        const range = ((max - min) / min) * 100;
        const spread = max - min;

        setStats({
            range: range.toFixed(2),
            volatility: (range / 4).toFixed(2),
            spread: spread.toFixed(3)
        });
    };

    const handleRunSimulation = async () => {
        if (!data || data.length === 0 || !initialPrice || !gridStep) return;

        setLoading(true);
        try {
            // 1. Construct Config for Backend
            const config = {
                symbol: selectedSymbol,
                startDate: selectedDate,
                basePrice: parseFloat(initialPrice),
                gridStep: parseFloat(gridStep),
                gridStepType: gridStepUnit === 'value' ? 'absolute' : 'percent', // Map 'value' to 'absolute' for backend
                amountPerGrid: 100, // Default or add UI input later
                commissionRate: 0.0001,
                minCommission: 0.1,
                usePenetration: false
            };

            // 2. Call Backend API
            const res = await runSimulation(config);

            if (res && res.trades) {
                // 3. Map Backend Trades to Chart Indices
                // Create a map for O(1) lookup: "HH:MM" -> index
                // Note: Backend returns full timestamp "YYYY-MM-DD HH:MM:SS", Frontend data has "YYYY-MM-DD HH:MM:SS"
                const timeToIndex = new Map();
                data.forEach((item, index) => {
                    timeToIndex.set(item.timestamp, index);
                });

                const mappedTrades = res.trades.map(t => {
                    const idx = timeToIndex.get(t.time);
                    if (idx !== undefined) {
                        return {
                            type: t.type === 'BUY' ? 'B' : 'S',
                            index: idx,
                            price: t.price,
                            time: t.time
                        };
                    }
                    return null;
                }).filter(t => t !== null);

                setSimulatedTrades(mappedTrades);
                setShowLiveTrades(true);
            } else {
                setSimulatedTrades([]);
            }
        } catch (err) {
            console.error("Simulation failed:", err);
            alert("模拟失败: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleClearSimulation = () => {
        setShowLiveTrades(false);
        setSimulatedTrades([]);
    };

    const handleRefresh = async () => {
        setLoading(true);
        try {
            await refreshData(selectedSymbol);
            // Wait a bit for backend script to finish (though it's async, we just ack start)
            // Ideally backend should wait but we made it async. 
            // Let's polling or just wait fixed time to allow script some headstart
            setTimeout(async () => {
                // Refresh available dates and switch to latest
                try {
                    const dates = await getAvailableDates(selectedSymbol);
                    setAvailableDates(dates);
                    if (dates.length > 0) {
                        const latest = dates[dates.length - 1];
                        if (latest !== selectedDate) {
                            setSelectedDate(latest);
                        } else {
                            // If date explains same, just fetch data
                            fetchData();
                        }
                    }
                } catch (err) {
                    console.error("Refresh dates failed", err);
                }
            }, 2000);
        } catch (e) {
            console.error("Refresh failed", e);
            alert("刷新失败: " + e.message);
            setLoading(false);
        }
    };

    // Derived State for Switcher
    const currentSymbolObj = supportedSymbols.find(s => s.code === selectedSymbol);
    const currentSymbolName = currentSymbolObj?.name || selectedSymbol;
    const currentMarket = currentSymbolObj?.market || 'SH';

    const filteredSymbols = supportedSymbols.filter(s =>
        s.code.includes(assetSearchTerm) || s.name.includes(assetSearchTerm)
    );

    return (
        <div className="flex flex-col h-screen text-slate-100 font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
            {/* Header */}
            <header className="flex items-center justify-between px-6 py-4 glass-panel border-b-0 m-4 mb-0 rounded-2xl z-50 animate-slide-up">
                <div className="flex items-center gap-6 md:gap-8">
                    {/* Logo Area */}
                    <div className="flex items-center gap-3 group cursor-pointer select-none">
                        <div className="relative p-2.5 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-500/20 group-hover:shadow-indigo-500/40 transition-all duration-300">
                            <TrendingUp className="w-6 h-6 text-white" />
                            <div className="absolute inset-0 bg-white/20 rounded-xl animate-pulse opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        </div>
                        <div className="hidden sm:block">
                            <h1 className="text-xl font-bold tracking-tight text-white group-hover:text-glow transition-all">GridMaster</h1>
                            <p className="text-[10px] text-indigo-200/60 font-mono tracking-wider uppercase">Quantitative Trading</p>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="h-8 w-px bg-white/10 hidden md:block"></div>

                    {/* Asset Switcher */}
                    <div className="relative">
                        <button
                            onClick={() => setIsAssetSwitcherOpen(!isAssetSwitcherOpen)}
                            className="flex items-center gap-4 pl-3 pr-4 py-2 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 rounded-xl transition-all duration-200 group w-auto md:w-64 justify-between"
                        >
                            <div className="flex items-center gap-3">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${currentMarket === 'SH' ? 'bg-rose-500/20 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.1)]' : 'bg-emerald-500/20 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.1)]'}`}>
                                    {currentMarket}
                                </span>
                                <div className="flex flex-col items-start gap-0.5 text-left">
                                    <span className="text-sm font-bold text-white group-hover:text-indigo-300 transition-colors whitespace-nowrap">{currentSymbolName}</span>
                                    <span className="text-[10px] text-slate-400 font-mono tracking-wider">{selectedSymbol}</span>
                                </div>
                            </div>
                            <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform duration-300 hidden md:block ${isAssetSwitcherOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {/* Switcher Dropdown */}
                        {isAssetSwitcherOpen && (
                            <div className="absolute top-full left-0 mt-3 w-72 glass-panel rounded-xl shadow-2xl shadow-black/50 overflow-hidden animate-in slide-in-from-top-2 fade-in duration-200 flex flex-col z-50">
                                <div className="p-3 border-b border-white/5 relative bg-white/[0.02]">
                                    <Search className="w-4 h-4 text-slate-400 absolute left-6 top-1/2 -translate-y-1/2" />
                                    <input
                                        autoFocus
                                        type="text"
                                        placeholder="搜索股票代码/名称..."
                                        className="w-full bg-black/20 border border-white/5 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50 transition-colors placeholder:text-slate-600"
                                        value={assetSearchTerm}
                                        onChange={(e) => setAssetSearchTerm(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </div>

                                <div className="max-h-60 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                                    {filteredSymbols.map(s => (
                                        <button
                                            key={s.code}
                                            onClick={() => {
                                                setSelectedSymbol(s.code);
                                                setSelectedDate('');
                                                setInitialPrice('');
                                                setIsAssetSwitcherOpen(false);
                                                setAssetSearchTerm('');
                                            }}
                                            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors group/item ${selectedSymbol === s.code ? 'bg-indigo-500/20 shadow-[inset_0_0_10px_rgba(99,102,241,0.2)] border border-indigo-500/30' : 'border border-transparent hover:bg-white/5'}`}
                                        >
                                            <div className="flex flex-col gap-0.5">
                                                <span className={`text-sm font-medium ${selectedSymbol === s.code ? 'text-indigo-300' : 'text-slate-300 group-hover/item:text-slate-100'}`}>{s.name}</span>
                                                <span className="text-[10px] text-slate-500 font-mono group-hover/item:text-slate-400">{s.code}</span>
                                            </div>
                                            {selectedSymbol === s.code && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                                        </button>
                                    ))}
                                </div>

                                <div className="p-3 border-t border-white/5 bg-white/[0.02]">
                                    {!isAdding ? (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setIsAdding(true); }}
                                            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-white/10 text-xs text-slate-400 hover:text-indigo-400 hover:border-indigo-500/30 hover:bg-indigo-500/10 transition-all group"
                                        >
                                            <Plus className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                                            <span>添加新股票</span>
                                        </button>
                                    ) : (
                                        <div className="flex items-center gap-2 animate-in slide-in-from-bottom-2 duration-200">
                                            <input
                                                autoFocus
                                                type="text"
                                                placeholder="6位代码"
                                                className="flex-1 bg-black/20 border border-indigo-500/50 rounded-lg px-3 py-2 text-xs text-white focus:outline-none font-mono"
                                                value={newSymbol}
                                                onChange={(e) => setNewSymbol(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleAddSymbol();
                                                    if (e.key === 'Escape') setIsAdding(false);
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                            <button
                                                onClick={handleAddSymbol}
                                                disabled={addingLoading}
                                                className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg p-2 transition-colors disabled:opacity-50 shadow-lg shadow-indigo-500/20"
                                            >
                                                {addingLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {isAssetSwitcherOpen && (
                            <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" onClick={() => setIsAssetSwitcherOpen(false)}></div>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="bg-black/20 p-1 rounded-xl border border-white/5 flex gap-1 backdrop-blur-md">
                        <button
                            onClick={() => setActiveTab('chart')}
                            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-300 relative overflow-hidden flex items-center gap-2 ${activeTab === 'chart' ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            {activeTab === 'chart' && (
                                <div className="absolute inset-0 bg-indigo-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] rounded-lg"></div>
                            )}
                            <LineChart className="w-4 h-4 relative z-10" />
                            <span className="relative z-10 hidden sm:inline">实时图表</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('simulation')}
                            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-300 relative overflow-hidden flex items-center gap-2 ${activeTab === 'simulation' ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            {activeTab === 'simulation' && (
                                <div className="absolute inset-0 bg-indigo-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] rounded-lg"></div>
                            )}
                            <BarChart3 className="w-4 h-4 relative z-10" />
                            <span className="relative z-10 hidden sm:inline">网格回测</span>
                        </button>
                    </div>

                    <button
                        onClick={handleRefresh}
                        className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 text-indigo-400 hover:text-indigo-300 transition-all active:scale-95 duration-200 group relative overflow-hidden"
                        title="刷新数据"
                        disabled={loading}
                    >
                        <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} />
                    </button>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden p-4 pt-0 gap-4">
                {activeTab === 'chart' && (
                    <aside className="w-80 glass-panel rounded-2xl p-6 flex flex-col gap-5 overflow-y-auto hidden md:flex animate-slide-up" style={{ animationDelay: '0.1s' }}>
                        {/* Time Machine */}
                        <div className="space-y-3 relative z-30">
                            <div className="flex items-center gap-2 text-indigo-400 mb-1">
                                <div className="w-1.5 h-4 bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.5)]"></div>
                                <h2 className="text-xs font-bold uppercase tracking-widest text-indigo-300/80">Time Machine</h2>
                            </div>

                            <div className="relative">
                                <button
                                    onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
                                    className="w-full flex items-center justify-between bg-black/20 hover:bg-black/30 border border-white/10 hover:border-indigo-500/30 rounded-xl px-4 py-3 text-sm transition-all text-slate-200 group focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                                >
                                    <span className="font-mono">{selectedDate || 'Select Date'}</span>
                                    <ChevronDown className={`w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-transform duration-300 ${isDatePickerOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {isDatePickerOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setIsDatePickerOpen(false)}></div>
                                        <div className="absolute top-full left-0 mt-2 glass-panel rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50 animate-in slide-in-from-top-2 fade-in duration-200">
                                            <CyberDatePicker
                                                selectedDate={selectedDate}
                                                availableDates={availableDates}
                                                onSelect={(date) => {
                                                    setSelectedDate(date);
                                                    setIsDatePickerOpen(false);
                                                }}
                                                onClose={() => setIsDatePickerOpen(false)}
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>

                        {/* Grid Settings */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 text-indigo-400">
                                    <div className="w-1.5 h-4 bg-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.5)]"></div>
                                    <h2 className="text-xs font-bold uppercase tracking-widest text-indigo-300/80">Grid Settings</h2>
                                </div>
                                {/* Unit Toggle */}
                                <div className="flex bg-black/30 p-0.5 rounded-lg border border-white/5">
                                    <button
                                        onClick={() => setGridStepUnit('percent')}
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${gridStepUnit === 'percent' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                                    >
                                        %
                                    </button>
                                    <button
                                        onClick={() => setGridStepUnit('value')}
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${gridStepUnit === 'value' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                                    >
                                        点
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                                        步幅 {gridStepUnit === 'percent' ? '(%)' : '(点)'}
                                    </label>
                                    <input
                                        type="number"
                                        step={gridStepUnit === 'percent' ? "0.1" : "0.01"}
                                        value={gridStep}
                                        onChange={(e) => setGridStep(e.target.value)}
                                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-indigo-500/50 focus:outline-none transition-colors"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">基准价格</label>
                                    <input
                                        type="number"
                                        step="0.001"
                                        value={initialPrice}
                                        onChange={(e) => setInitialPrice(e.target.value)}
                                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-indigo-500/50 focus:outline-none transition-colors"
                                        placeholder="Auto"
                                    />
                                </div>
                            </div>

                            {/* Simulation Actions */}
                            <div className="flex gap-2">
                                <button
                                    onClick={handleRunSimulation}
                                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-500/20 transition-all active:scale-95 group"
                                >
                                    <Play className="w-3.5 h-3.5 fill-current group-hover:scale-110 transition-transform" />
                                    模拟成交
                                </button>
                                <button
                                    onClick={handleClearSimulation}
                                    className={`p-2 rounded-xl border border-white/10 text-slate-400 hover:text-rose-400 hover:border-rose-500/30 hover:bg-rose-500/5 transition-all ${showLiveTrades ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}
                                    title="清除标记"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <div className="w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>

                        {/* Stats Cards */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-emerald-400 mb-1">
                                <div className="w-1.5 h-4 bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
                                <h2 className="text-xs font-bold uppercase tracking-widest text-emerald-300/80">Daily Stats ({selectedDate.slice(5)})</h2>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="group bg-white/5 hover:bg-white/[0.08] p-3 rounded-2xl border border-white/5 hover:border-white/10 transition-all duration-300">
                                    <p className="text-[10px] text-slate-400 mb-1 uppercase tracking-wider">振幅 Range</p>
                                    <p className="text-lg font-bold font-mono text-white group-hover:text-glow transition-all">{stats.range}%</p>
                                </div>
                                <div className="group bg-white/5 hover:bg-white/[0.08] p-3 rounded-2xl border border-white/5 hover:border-white/10 transition-all duration-300">
                                    <p className="text-[10px] text-slate-400 mb-1 uppercase tracking-wider">波动 Volatility</p>
                                    <p className="text-lg font-bold font-mono text-white group-hover:text-glow transition-all">{stats.volatility}</p>
                                </div>
                            </div>
                            <div className="group bg-white/5 hover:bg-white/[0.08] p-3 rounded-2xl border border-white/5 hover:border-white/10 transition-all duration-300 flex items-center justify-between">
                                <div>
                                    <p className="text-[10px] text-slate-400 mb-1 uppercase tracking-wider">日内价差 Spread</p>
                                    <p className="text-lg font-bold font-mono text-emerald-300 group-hover:text-glow transition-all">{stats.spread}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] text-slate-400 mb-1 uppercase tracking-wider">模拟网格成交</p>
                                    <p className="text-lg font-bold font-mono text-indigo-300 group-hover:text-glow transition-all">{simulatedTrades.length} <span className="text-xs text-slate-500 font-normal">笔</span></p>
                                </div>
                            </div>
                        </div>
                    </aside>
                )}

                {/* Main Content Area */}
                <main className={`flex-1 relative transition-all duration-300 ${activeTab === 'simulation' ? 'overflow-y-auto rounded-2xl custom-scrollbar' : 'overflow-hidden'}`}>
                    {activeTab === 'chart' ? (
                        loading ? (
                            <div className="w-full h-full glass-panel rounded-2xl flex items-center justify-center animate-pulse border border-white/5">
                                <div className="flex flex-col items-center gap-6">
                                    <div className="relative">
                                        <div className="w-16 h-16 rounded-full border-4 border-indigo-500/30 border-t-indigo-500 animate-spin"></div>
                                        <div className="absolute inset-0 flex items-center justify-center">
                                            <TrendingUp className="w-6 h-6 text-indigo-400" />
                                        </div>
                                    </div>
                                    <p className="text-slate-400 text-sm font-medium tracking-wide">LOADING DATA...</p>
                                </div>
                            </div>
                        ) : (
                            <div className="w-full h-full glass-panel rounded-2xl border border-white/5 shadow-2xl overflow-hidden relative group animate-slide-up" style={{ animationDelay: '0.05s' }}>
                                <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] bg-indigo-500/20 rounded-full blur-[120px] pointer-events-none opacity-50"></div>
                                <div className="absolute bottom-[-20%] left-[-10%] w-[400px] h-[400px] bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none opacity-50"></div>

                                <div className="w-full h-full relative z-10 p-2">
                                    <VolatilityChart
                                        data={data}
                                        dailyInfo={currentDayInfo}
                                        gridStep={gridStep}
                                        gridStepUnit={gridStepUnit}
                                        initialPrice={initialPrice}
                                        tradePoints={showLiveTrades ? simulatedTrades : []}
                                        preClose={preClose}
                                    />
                                </div>
                            </div>
                        )
                    ) : (
                        <div className="glass-panel min-h-full rounded-2xl p-8 border border-white/5 animate-slide-up">
                            <SimulationPanel availableDates={availableDates} initialBasePrice={initialPrice} symbol={selectedSymbol} />
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default Dashboard;
