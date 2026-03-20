import React, { useState, useEffect } from 'react';
import VolatilityChart from './VolatilityChart';
import { getKlines, getDailyKlines, getAvailableDates, getSymbols, addSymbol, deleteSymbol, runSimulation, refreshData } from '../lib/api';
import { Settings, RefreshCw, TrendingUp, DollarSign, Plus, Loader2, Search, ChevronDown, ChevronLeft, ChevronRight, Check, X, BarChart3, LineChart, MoveHorizontal, Play, Trash2, Calendar, Palette } from 'lucide-react';
import SimulationPanel from './SimulationPanel';
import CyberDatePicker from './CyberDatePicker';
import DailyKChart from './DailyKChart';
import { useTheme, THEMES } from '../lib/ThemeContext.jsx';

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
    const [isSyncing, setIsSyncing] = useState(false);

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
    const [showGridLines, setShowGridLines] = useState(localStorage.getItem('showGridLines') !== 'false');
    const [showVolumeProfile, setShowVolumeProfile] = useState(localStorage.getItem('showVolumeProfile') !== 'false');
    const [vpvrColor, setVpvrColor] = useState(localStorage.getItem('vpvrColor') || 'indigo'); // 'indigo' | 'emerald' | 'amber' | 'rose' | 'slate'
    const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(localStorage.getItem('autoRefreshEnabled') !== 'false');
    const [goldPriceUnit, setGoldPriceUnit] = useState(localStorage.getItem('goldPriceUnit') || 'USD/oz'); // 'USD/oz' | 'RMB/g'
    const [usdCnyRate, setUsdCnyRate] = useState(parseFloat(localStorage.getItem('usdCnyRate')) || 7.2);
    const [goldAdjustment, setGoldAdjustment] = useState(parseFloat(localStorage.getItem('goldAdjustment')) || 0);

    // Simulation Params
    const [simCommissionRate, setSimCommissionRate] = useState(parseFloat(localStorage.getItem('simCommissionRate')) || 0.0001);
    const [simMinCommission, setSimMinCommission] = useState(parseFloat(localStorage.getItem('simMinCommission')) || 0.1);
    const [simAmountPerGrid, setSimAmountPerGrid] = useState(parseInt(localStorage.getItem('simAmountPerGrid')) || 100);
    const [simUsePenetration, setSimUsePenetration] = useState(localStorage.getItem('simUsePenetration') === 'true');

    const now = new Date();
    const bjMs = now.getTime() + 8 * 3600 * 1000;
    const bj = new Date(bjMs);
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())}`;

    // Theme Panel
    const [isThemePanelOpen, setIsThemePanelOpen] = useState(false);
    const { themeId, setThemeId, themes } = useTheme();

    // === Effects & Logic ===

    // 0. Fetch Symbols
    const fetchSymbols = async () => {
        try {
            const syms = await getSymbols();
            if (syms && syms.length > 0) {
                const mapped = syms.map(s => ({
                    code: s.symbol,
                    name: s.name,
                    market: s.market === 1 ? 'SH' : (s.market === 100 ? 'INTL' : 'SZ')
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
        const symbolUpper = newSymbol.toUpperCase();
        const isXAU = symbolUpper === 'XAU';
        const isUSDT = symbolUpper.endsWith('USDT');
        const isSixDigit = /^\d{6}$/.test(newSymbol);

        if (!newSymbol || (!isSixDigit && !isXAU && !isUSDT)) {
            alert("请输入有效代码（如股票6位数字、XAU 或 BTCUSDT）");
            return;
        }
        setAddingLoading(true);
        setIsSyncing(true);
        try {
            await addSymbol(newSymbol);
            await fetchSymbols();
            setSelectedSymbol(newSymbol);
            setIsAdding(false);
            setNewSymbol('');
            setAddingLoading(false);
            setIsAssetSwitcherOpen(false); // Close dropdown
        } catch (e) {
            alert("添加失败: " + e.message);
            setAddingLoading(false);
            setIsSyncing(false);
        }
    }

    const handleDeleteSymbol = async (e, symbolCode) => {
        e.stopPropagation();
        if (!window.confirm(`确定要删除 ${symbolCode} 及其所有历史数据吗？`)) {
            return;
        }

        try {
            await deleteSymbol(symbolCode);
            await fetchSymbols();
            // If the deleted symbol was the selected one, switch to another
            if (selectedSymbol === symbolCode) {
                setSelectedSymbol('512890'); // Fallback to default
                setSelectedDate('');
            }
        } catch (e) {
            alert("删除失败: " + e.message);
        }
    };

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

    useEffect(() => {
        localStorage.setItem('usdCnyRate', usdCnyRate);
    }, [usdCnyRate]);

    useEffect(() => {
        localStorage.setItem('goldAdjustment', goldAdjustment);
    }, [goldAdjustment]);

    // 2. Fetch Detailed Klines & Daily Info when Date Selected
    const fetchData = async (isSilent = false) => {
        if (!selectedDate) return;
        if (!isSilent) setLoading(true);
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

            if (klines.length > 0) {
                setInitialPrice(klines[0].open.toFixed(3));
            }

            calculateStats(klines);
            // Don't clear trades automatically here, let the [selectedSymbol] effect handle it
        } catch (err) {
            console.error("Fetch failed", err);
        } finally {
            if (!isSilent) setLoading(false);
        }
    };

    useEffect(() => {
        fetchData(false);
    }, [selectedDate, selectedSymbol]);

    // 3. Background Fetch for Auto Refresh (Silent, no loading indicator)
    const backgroundFetchData = async () => {
        await fetchData(true);
    };

    // 自动刷新机制：仅在未进行模拟且查看当日图表时运行
    useEffect(() => {
        // 如果自动刷新被禁用，或者处于网格回测标签页，或者图表上正在显示回测点位，则不要刷新
        if (!autoRefreshEnabled || activeTab === 'simulation' || showLiveTrades) return;

        // 仅在查看当日数据时自动刷新
        // 使用北京时间获取今天的日期字符串
        const now = new Date();
        const bjMs = now.getTime() + 8 * 3600 * 1000;
        const bj = new Date(bjMs);
        const pad = (n) => String(n).padStart(2, '0');
        const todayStr = `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())}`;
        if (selectedDate !== todayStr) return;

        const interval = setInterval(backgroundFetchData, 60000); // 60秒轮询，因为后端数据通常是分钟级的
        return () => clearInterval(interval);
    }, [selectedDate, selectedSymbol, availableDates, activeTab, showLiveTrades, autoRefreshEnabled]);

    // Sync state to localStorage
    useEffect(() => { localStorage.setItem('selectedSymbol', selectedSymbol); }, [selectedSymbol]);
    useEffect(() => { localStorage.setItem('selectedDate', selectedDate); }, [selectedDate]);
    useEffect(() => { localStorage.setItem('gridStep', gridStep); }, [gridStep]);
    useEffect(() => { localStorage.setItem('gridStepUnit', gridStepUnit); }, [gridStepUnit]);
    useEffect(() => { localStorage.setItem('initialPrice', initialPrice); }, [initialPrice]);
    useEffect(() => { localStorage.setItem('showGridLines', showGridLines); }, [showGridLines]);
    useEffect(() => { localStorage.setItem('showVolumeProfile', showVolumeProfile); }, [showVolumeProfile]);
    useEffect(() => { localStorage.setItem('vpvrColor', vpvrColor); }, [vpvrColor]);
    useEffect(() => { localStorage.setItem('autoRefreshEnabled', autoRefreshEnabled); }, [autoRefreshEnabled]);
    useEffect(() => { localStorage.setItem('simCommissionRate', simCommissionRate); }, [simCommissionRate]);
    useEffect(() => { localStorage.setItem('simMinCommission', simMinCommission); }, [simMinCommission]);
    useEffect(() => { localStorage.setItem('simAmountPerGrid', simAmountPerGrid); }, [simAmountPerGrid]);
    useEffect(() => { localStorage.setItem('simUsePenetration', simUsePenetration); }, [simUsePenetration]);

    // Clear simulation markers IF AND ONLY IF asset or date changes, NOT for every fetch
    useEffect(() => {
        setShowLiveTrades(false);
        setSimulatedTrades([]);
    }, [selectedSymbol, selectedDate]);

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
        let max = Math.max(...highs);
        let min = Math.min(...lows);
        const range = ((max - min) / min) * 100;
        let spread = max - min;

        // Unit conversion for Gold stats display
        if (selectedSymbol === 'XAU' && goldPriceUnit === 'RMB/g') {
            const factor = (parseFloat(usdCnyRate) || 7.2) / 31.1035;
            spread = spread * factor + (parseFloat(goldAdjustment) || 0);
        }

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
                gridStepType: gridStepUnit === 'value' ? 'absolute' : 'percent',
                amountPerGrid: simAmountPerGrid,
                commissionRate: simCommissionRate,
                minCommission: simMinCommission,
                usePenetration: simUsePenetration
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
        setIsSyncing(true);
        try {
            await refreshData(selectedSymbol);
            const dates = await getAvailableDates(selectedSymbol);
            setAvailableDates(dates);
            await fetchData(false);
        } catch (e) {
            console.error("Refresh failed", e);
            alert("刷新失败: " + e.message);
        } finally {
            setIsSyncing(false);
        }
    };

    // New: Polling Effect for Auto-Sync
    useEffect(() => {
        if (!isSyncing) return;

        console.log("Auto-sync active: Polling for data...");
        
        // Poll every 5 seconds
        const pollInterval = setInterval(async () => {
            try {
                const dates = await getAvailableDates(selectedSymbol);
                // If we got new dates, or current date has more data
                setAvailableDates(prev => {
                    if (dates.length > prev.length) {
                        console.log("New data detected via auto-sync.");
                        return dates;
                    }
                    return prev;
                });
                
                // Silent refresh of current chart data
                fetchData(true);
            } catch (e) {
                console.error("Polling failed", e);
            }
        }, 5000);

        // Stop polling after 5 minutes
        const stopPolling = setTimeout(() => {
            setIsSyncing(false);
            clearInterval(pollInterval);
            console.log("Auto-sync stopped after timeout.");
        }, 300000);

        return () => {
            clearInterval(pollInterval);
            clearTimeout(stopPolling);
        };
    }, [isSyncing, selectedSymbol]);

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
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl font-bold tracking-tight text-white group-hover:text-glow transition-all">GridMaster</h1>
                                {isSyncing && (
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-indigo-500/20 border border-indigo-500/30 rounded-full animate-pulse">
                                        <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-ping"></div>
                                        <span className="text-[9px] font-bold text-indigo-300 uppercase tracking-tighter">Syncing</span>
                                    </div>
                                )}
                            </div>
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
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${currentMarket === 'SH' ? 'bg-rose-500/20 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.1)]' : (currentMarket === 'INTL' ? 'bg-amber-500/20 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.1)]' : 'bg-emerald-500/20 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.1)]')}`}>
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
                                        <div
                                            key={s.code}
                                            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors group/item relative ${selectedSymbol === s.code ? 'bg-indigo-500/20 shadow-[inset_0_0_10px_rgba(99,102,241,0.2)] border border-indigo-500/30' : 'border border-transparent hover:bg-white/5'}`}
                                            onClick={() => {
                                                setSelectedSymbol(s.code);
                                                setSelectedDate('');
                                                setInitialPrice('');
                                                setIsAssetSwitcherOpen(false);
                                                setAssetSearchTerm('');
                                            }}
                                        >
                                            <div className="flex flex-col gap-0.5 cursor-pointer flex-1">
                                                <span className={`text-sm font-medium ${selectedSymbol === s.code ? 'text-indigo-300' : 'text-slate-300 group-hover/item:text-slate-100'}`}>{s.name}</span>
                                                <span className="text-[10px] text-slate-500 font-mono group-hover/item:text-slate-400">{s.code}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {selectedSymbol === s.code && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                                                <button
                                                    onClick={(e) => handleDeleteSymbol(e, s.code)}
                                                    className="p-1.5 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover/item:opacity-100 transition-all"
                                                    title="删除此股票"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
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
                        <button
                            onClick={() => setActiveTab('daily-k')}
                            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-300 relative overflow-hidden flex items-center gap-2 ${activeTab === 'daily-k' ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}
                        >
                            {activeTab === 'daily-k' && (
                                <div className="absolute inset-0 bg-indigo-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] rounded-lg"></div>
                            )}
                            <Calendar className="w-4 h-4 relative z-10" />
                            <span className="relative z-10 hidden sm:inline">历史日K</span>
                        </button>
                    </div>

                    {/* Theme Switcher */}
                    <div className="relative">
                        <button
                            onClick={() => setIsThemePanelOpen(!isThemePanelOpen)}
                            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 text-slate-400 hover:text-purple-300 transition-all active:scale-95 duration-200 group relative overflow-hidden"
                            title="切换主题"
                        >
                            <Palette className="w-5 h-5 group-hover:rotate-12 transition-transform duration-300" />
                        </button>

                        {isThemePanelOpen && (
                            <>
                                <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setIsThemePanelOpen(false)}
                                />
                                <div className="absolute right-0 top-full mt-3 w-72 glass-panel rounded-2xl shadow-2xl shadow-black/60 overflow-hidden z-50 animate-in slide-in-from-top-2 fade-in duration-200">
                                    {/* Panel Header */}
                                    <div className="px-4 pt-4 pb-3 border-b border-white/5">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Palette className="w-4 h-4 text-purple-400" />
                                                <span className="text-sm font-bold text-white">主题配色</span>
                                            </div>
                                            <button
                                                onClick={() => setIsThemePanelOpen(false)}
                                                className="p-1 rounded-lg hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors"
                                            >
                                                <X className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                        <p className="text-[10px] text-slate-500 mt-1 font-mono">SELECT VISUAL THEME</p>
                                    </div>

                                    {/* Theme Cards Grid */}
                                    <div className="p-3 grid grid-cols-2 gap-2">
                                        {themes.map(theme => (
                                            <button
                                                key={theme.id}
                                                onClick={() => {
                                                    setThemeId(theme.id);
                                                    setIsThemePanelOpen(false);
                                                }}
                                                className={`relative group flex flex-col gap-2 p-3 rounded-xl border transition-all duration-200 text-left overflow-hidden ${themeId === theme.id
                                                    ? 'border-white/30 bg-white/10 shadow-lg'
                                                    : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/15'
                                                    }`}
                                            >
                                                {/* Color Preview Bands */}
                                                <div className="flex gap-1 h-5 rounded-lg overflow-hidden">
                                                    {theme.preview.map((color, i) => (
                                                        <div
                                                            key={i}
                                                            className="flex-1 rounded-sm"
                                                            style={{ backgroundColor: color }}
                                                        />
                                                    ))}
                                                </div>

                                                {/* Theme Name */}
                                                <div>
                                                    <p className="text-xs font-bold text-slate-200 group-hover:text-white transition-colors">{theme.name}</p>
                                                    <p className="text-[9px] text-slate-500 font-mono uppercase tracking-wider">{theme.nameEn}</p>
                                                </div>

                                                {/* Active Checkmark */}
                                                {themeId === theme.id && (
                                                    <div
                                                        className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center"
                                                        style={{ backgroundColor: theme.accent }}
                                                    >
                                                        <Check className="w-2.5 h-2.5 text-white" />
                                                    </div>
                                                )}

                                                {/* Glow on active */}
                                                {themeId === theme.id && (
                                                    <div
                                                        className="absolute inset-0 rounded-xl opacity-20 pointer-events-none"
                                                        style={{ boxShadow: `inset 0 0 20px ${theme.accent}` }}
                                                    />
                                                )}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Footer tip */}
                                    <div className="px-4 pb-3 pt-0">
                                        <p className="text-[9px] text-slate-600 text-center font-mono">THEME IS SAVED AUTOMATICALLY</p>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    <button
                        onClick={() => setAutoRefreshEnabled(!autoRefreshEnabled)}
                        className={`p-2.5 rounded-xl border transition-all active:scale-95 duration-200 group relative flex items-center gap-2 ${autoRefreshEnabled
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                            : 'bg-white/5 border-white/5 text-slate-500 hover:text-slate-400 hover:bg-white/10'
                            }`}
                        title={autoRefreshEnabled ? "点击关闭自动刷新" : "点击开启自动刷新"}
                    >
                        <div className="relative">
                            <RefreshCw className={`w-5 h-5 ${autoRefreshEnabled ? 'animate-spin-slow' : ''}`} />
                            {!autoRefreshEnabled && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-5 h-0.5 bg-slate-500 rotate-45 rounded-full" />
                                </div>
                            )}
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider hidden lg:inline">
                            {autoRefreshEnabled ? 'Auto On' : 'Auto Off'}
                        </span>
                        {autoRefreshEnabled && (
                            <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
                        )}
                    </button>

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

                            <div className="flex items-center gap-2 relative">
                                <button
                                    onClick={() => {
                                        const idx = availableDates.indexOf(selectedDate);
                                        if (idx > 0) setSelectedDate(availableDates[idx - 1]);
                                    }}
                                    disabled={!availableDates.length || availableDates.indexOf(selectedDate) <= 0}
                                    className="p-3 bg-black/20 hover:bg-black/30 border border-white/10 hover:border-indigo-500/30 rounded-xl text-slate-400 hover:text-indigo-400 transition-all disabled:opacity-30 disabled:pointer-events-none"
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>

                                <div className="relative flex-1">
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
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 glass-panel rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50 animate-in slide-in-from-top-2 fade-in duration-200">
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

                                <button
                                    onClick={() => {
                                        const idx = availableDates.indexOf(selectedDate);
                                        if (idx >= 0 && idx < availableDates.length - 1) setSelectedDate(availableDates[idx + 1]);
                                    }}
                                    disabled={!availableDates.length || availableDates.indexOf(selectedDate) === -1 || availableDates.indexOf(selectedDate) >= availableDates.length - 1}
                                    className="p-3 bg-black/20 hover:bg-black/30 border border-white/10 hover:border-indigo-500/30 rounded-xl text-slate-400 hover:text-indigo-400 transition-all disabled:opacity-30 disabled:pointer-events-none"
                                >
                                    <ChevronRight className="w-4 h-4" />
                                </button>
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
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                    {/* Grid Lines Toggle */}
                                    <label className="flex items-center gap-1.5 cursor-pointer group">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only"
                                                checked={showGridLines}
                                                onChange={() => setShowGridLines(!showGridLines)}
                                            />
                                            <div className={`block w-7 h-4 rounded-full transition-colors ${showGridLines ? 'bg-indigo-500' : 'bg-slate-700'}`}></div>
                                            <div className={`absolute left-0.5 top-0.5 bg-white w-3 h-3 rounded-full transition-transform ${showGridLines ? 'translate-x-3' : 'translate-x-0'}`}></div>
                                        </div>
                                        <span className="text-[10px] text-slate-400 font-medium group-hover:text-slate-300 transition-colors uppercase tracking-wider">网格线</span>
                                    </label>

                                    {/* VPVR Toggle & Color Picker */}
                                    <div className="flex items-center gap-2 group">
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                            <div className="relative">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only"
                                                    checked={showVolumeProfile}
                                                    onChange={() => setShowVolumeProfile(!showVolumeProfile)}
                                                />
                                                <div className={`block w-7 h-4 rounded-full transition-colors ${showVolumeProfile ? 'bg-emerald-500' : 'bg-slate-700'}`}></div>
                                                <div className={`absolute left-0.5 top-0.5 bg-white w-3 h-3 rounded-full transition-transform ${showVolumeProfile ? 'translate-x-3' : 'translate-x-0'}`}></div>
                                            </div>
                                            <span className="text-[10px] text-slate-400 font-medium group-hover:text-slate-300 transition-colors uppercase tracking-wider tooltip" title="筹码分布墙 (Volume Profile)">筹码墙</span>
                                        </label>

                                        {/* Simple Color Picker for VPVR */}
                                        {showVolumeProfile && (
                                            <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-white/10 transition-all duration-300">
                                                {['indigo', 'emerald', 'amber', 'rose', 'slate'].map(color => {
                                                    const colorClasses = {
                                                        indigo: 'bg-indigo-500',
                                                        emerald: 'bg-emerald-500',
                                                        amber: 'bg-amber-500',
                                                        rose: 'bg-rose-500',
                                                        slate: 'bg-slate-500'
                                                    };
                                                    return (
                                                        <button
                                                            key={color}
                                                            onClick={(e) => { e.preventDefault(); setVpvrColor(color); }}
                                                            className={`w-3 h-3 rounded-full transition-all ${vpvrColor === color ? 'ring-2 ring-white scale-110' : 'opacity-50 hover:opacity-100'} ${colorClasses[color]}`}
                                                            title={`选择颜色: ${color}`}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        )}
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

                                    {/* Gold Unit Toggle (XAU Only) */}
                                    {selectedSymbol === 'XAU' && (
                                        <div className="flex bg-black/30 p-0.5 rounded-lg border border-amber-500/20 ml-1">
                                            <button
                                                onClick={() => {
                                                    const next = 'USD/oz';
                                                    setGoldPriceUnit(next);
                                                    localStorage.setItem('goldPriceUnit', next);
                                                }}
                                                className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${goldPriceUnit === 'USD/oz' ? 'bg-amber-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                                            >
                                                $/oz
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const next = 'RMB/g';
                                                    setGoldPriceUnit(next);
                                                    localStorage.setItem('goldPriceUnit', next);
                                                }}
                                                className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${goldPriceUnit === 'RMB/g' ? 'bg-amber-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                                            >
                                                ￥/g
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Gold Calibration (XAU Only) */}
                            {selectedSymbol === 'XAU' && goldPriceUnit === 'RMB/g' && (
                                <div className="grid grid-cols-2 gap-3 mb-4 animate-in slide-in-from-top-1 duration-200">
                                    <div className="space-y-1">
                                        <label className="text-[10px] text-amber-500/80 uppercase font-bold tracking-wider flex items-center justify-between">
                                            <span>黄金汇率</span>
                                            <span className="text-[8px] opacity-40 font-mono">RATE</span>
                                        </label>
                                        <input
                                            type="number" step="0.01"
                                            className="w-full bg-black/40 border border-amber-500/20 rounded-xl px-3 py-2 text-xs text-amber-200 focus:outline-none focus:border-amber-500/50 font-mono"
                                            value={usdCnyRate}
                                            onChange={e => setUsdCnyRate(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] text-amber-500/80 uppercase font-bold tracking-wider flex items-center justify-between">
                                            <span>价格修正 (元)</span>
                                            <span className="text-[8px] opacity-40 font-mono">CALI</span>
                                        </label>
                                        <input
                                            type="number" step="0.1"
                                            className="w-full bg-black/40 border border-amber-500/20 rounded-xl px-3 py-2 text-xs text-amber-200 focus:outline-none focus:border-amber-500/50 font-mono"
                                            value={goldAdjustment}
                                            placeholder="如 -1.5"
                                            onChange={e => setGoldAdjustment(e.target.value)}
                                        />
                                    </div>
                                </div>
                            )}

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

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">佣金费率</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="0.0001"
                                            value={simCommissionRate}
                                            onChange={(e) => setSimCommissionRate(parseFloat(e.target.value) || 0)}
                                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-indigo-500/50 focus:outline-none transition-colors"
                                        />
                                        <span className="absolute right-3 top-2.5 text-slate-500 text-xs">万{(simCommissionRate * 10000).toFixed(1)}</span>
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">最低佣金</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={simMinCommission}
                                            onChange={(e) => setSimMinCommission(parseFloat(e.target.value) || 0)}
                                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-indigo-500/50 focus:outline-none transition-colors"
                                        />
                                        <span className="absolute right-3 top-2.5 text-slate-500 text-xs">元</span>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">单笔数量</label>
                                    <input
                                        type="number"
                                        step="100"
                                        value={simAmountPerGrid}
                                        onChange={(e) => setSimAmountPerGrid(parseInt(e.target.value) || 100)}
                                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-indigo-500/50 focus:outline-none transition-colors"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">成交模式</label>
                                    <select
                                        value={simUsePenetration ? 'true' : 'false'}
                                        onChange={(e) => setSimUsePenetration(e.target.value === 'true')}
                                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500/50 focus:outline-none transition-colors"
                                    >
                                        <option value="false" className="bg-slate-900">触价即成</option>
                                        <option value="true" className="bg-slate-900">穿透方成</option>
                                    </select>
                                </div>
                            </div>

                            {/* Simulation Actions */}
                            <div className="flex gap-2">
                                <button
                                    onClick={handleRunSimulation}
                                    className="flex-1 flex items-center justify-center gap-2 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-500/20 transition-all active:scale-95 group"
                                >
                                    {loading ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <Play className="w-3.5 h-3.5 fill-current group-hover:scale-110 transition-transform" />
                                    )}
                                    {loading ? '模拟中...' : '模拟成交'}
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
                                        onBaselineChange={setInitialPrice}
                                        tradePoints={showLiveTrades ? simulatedTrades : []}
                                        preClose={preClose}
                                        isLive={selectedDate === todayStr}
                                        showGridLines={showGridLines}
                                        showVolumeProfile={showVolumeProfile}
                                        vpvrColor={vpvrColor}
                                        goldPriceUnit={goldPriceUnit}
                                        usdCnyRate={usdCnyRate}
                                        goldAdjustment={goldAdjustment}
                                        selectedSymbol={selectedSymbol}
                                    />
                                </div>
                            </div>
                        )
                    ) : activeTab === 'simulation' ? (
                        <div className="glass-panel min-h-full rounded-2xl p-8 border border-white/5 animate-slide-up">
                            <SimulationPanel
                                availableDates={availableDates}
                                initialBasePrice={initialPrice}
                                symbol={selectedSymbol}
                                goldPriceUnit={goldPriceUnit}
                                usdCnyRate={usdCnyRate}
                                goldAdjustment={goldAdjustment}
                            />
                        </div>
                    ) : (
                        <div className="w-full h-full glass-panel rounded-2xl border border-white/5 shadow-2xl overflow-hidden relative group animate-slide-up" style={{ animationDelay: '0.05s' }}>
                            <div className="p-4 h-full relative z-10">
                                <DailyKChart symbol={selectedSymbol} />
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default Dashboard;
