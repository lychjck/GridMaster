import React, { useState } from 'react';
import { runSimulation, getDailyKlines } from '../lib/api';
import { RefreshCw, Calculator, TrendingUp, DollarSign, Play, List, Calendar, ChevronDown, MoveHorizontal } from 'lucide-react';
import TradeChart from './TradeChart';
import CyberDatePicker from './CyberDatePicker';

const SimulationPanel = ({ availableDates, initialBasePrice, symbol }) => {
    const [config, setConfig] = useState(() => {
        const saved = localStorage.getItem('sim_config');
        return saved ? JSON.parse(saved) : {
            startDate: availableDates.length > 0 ? availableDates[availableDates.length - 1] : '2026-01-01',
            basePrice: initialBasePrice || 1.100,
            gridStep: 0.005,
            gridStepType: 'percent', // 默认改用百分比，更符合常用直觉
            amountPerGrid: 2000,
            commissionRate: 0.0001, // 万1
            minCommission: 0.2,
            usePenetration: false
        };
    });

    const [result, setResult] = useState(null);

    const [loading, setLoading] = useState(false);
    const [viewMode, setViewMode] = useState('daily'); // 'daily' | 'trades' | 'chart'
    const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
    const hasAutoSyncedDate = React.useRef(false);

    // Initial buildup/cleanup
    React.useEffect(() => {
        try {
            localStorage.removeItem('sim_result');
        } catch (e) { }
    }, []);

    React.useEffect(() => {
        if (config) {
            try {
                localStorage.setItem('sim_config', JSON.stringify(config));
            } catch (e) {
                console.warn("Failed to save sim_config to localStorage", e);
            }
        }
    }, [config]);

    // Important: Update default date when availableDates changes
    React.useEffect(() => {
        if (availableDates.length > 0 && !hasAutoSyncedDate.current) {
            const latestDate = availableDates[availableDates.length - 1];
            // If current startDate is not the latest one, force it to the latest on first load
            if (config.startDate !== latestDate) {
                setConfig(prev => ({
                    ...prev,
                    startDate: latestDate
                }));
            }
            hasAutoSyncedDate.current = true;
        }
    }, [availableDates, config.startDate]);

    // Fetch and set opening price as base price when date or symbol changes
    React.useEffect(() => {
        if (!config.startDate || !symbol) return;

        const fetchOpeningPrice = async () => {
            try {
                const dailies = await getDailyKlines(config.startDate, symbol);
                if (dailies && dailies.length > 0) {
                    const openPrice = dailies[0].open;
                    if (openPrice) {
                        setConfig(prev => ({
                            ...prev,
                            basePrice: openPrice.toFixed(3)
                        }));
                    }
                }
            } catch (err) {
                console.error("Failed to fetch opening price:", err);
            }
        };

        fetchOpeningPrice();
    }, [config.startDate, symbol]);

    const handleSimulate = async () => {
        setLoading(true);
        try {
            const res = await runSimulation({
                ...config,
                symbol: symbol, // Pass symbol from props
                basePrice: parseFloat(config.basePrice),
                gridStep: parseFloat(config.gridStep),
                amountPerGrid: parseFloat(config.amountPerGrid),
                commissionRate: parseFloat(config.commissionRate),
                minCommission: parseFloat(config.minCommission)
            });
            console.log("Simulation Result:", res);
            setResult(res);
            // If we are in chart mode but no data, it's fine, but if we are in trades mode with 0 trades, show it.
        } catch (err) {
            console.error(err);
            alert("Simulation failed: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col gap-6 h-full pb-12">
            {/* Control Bar */}
            <div className="bg-slate-800/50 backdrop-blur-md border border-white/10 rounded-2xl p-6 shadow-xl shrink-0 relative z-30">
                <div className="flex items-center gap-2 text-indigo-400 font-semibold border-b border-white/5 pb-4 mb-6">
                    <Calculator className="w-5 h-5" />
                    <span className="text-lg">网格交易策略回测</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6">
                    <div className="flex flex-col gap-2">
                        <label className="text-slate-400 text-xs font-medium uppercase tracking-wider">开始日期</label>
                        <div className="relative">
                            <button
                                onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
                                className="w-full flex items-center justify-between bg-black/20 hover:bg-black/30 border border-white/10 hover:border-indigo-500/30 rounded-xl px-4 py-3 text-sm transition-all text-slate-200 group focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            >
                                <span className="font-mono">{config.startDate || '选择日期'}</span>
                                <ChevronDown className={`w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-transform duration-300 ${isDatePickerOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {isDatePickerOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setIsDatePickerOpen(false)}></div>
                                    <div className="absolute top-full left-0 mt-2 glass-panel rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50 animate-in slide-in-from-top-2 fade-in duration-200">
                                        <CyberDatePicker
                                            selectedDate={config.startDate}
                                            availableDates={availableDates}
                                            onSelect={(date) => {
                                                setConfig({ ...config, startDate: date });
                                                setIsDatePickerOpen(false);
                                            }}
                                            onClose={() => setIsDatePickerOpen(false)}
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-slate-400 text-xs font-medium uppercase tracking-wider">基准价格 (Base)</label>
                        <div className="relative">
                            <span className="absolute left-4 top-3.5 text-slate-500"><DollarSign className="w-4 h-4" /></span>
                            <input
                                type="number" step="0.001"
                                className="w-full bg-black/20 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
                                value={config.basePrice}
                                onChange={e => setConfig({ ...config, basePrice: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-slate-400 text-xs font-medium uppercase tracking-wider">网格步长 (Step)</label>
                        <div className="flex gap-2">
                            <select
                                className="bg-black/20 border border-white/10 rounded-xl px-2 py-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 w-28 text-xs"
                                value={config.gridStepType}
                                onChange={e => setConfig({ ...config, gridStepType: e.target.value })}
                            >
                                <option value="percent" className="bg-slate-900">百分比 (%)</option>
                                <option value="absolute" className="bg-slate-900">绝对值 (元)</option>
                            </select>
                            <input
                                type="number" step={config.gridStepType === 'percent' ? 0.1 : 0.001}
                                className="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
                                value={config.gridStep}
                                onChange={e => setConfig({ ...config, gridStep: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-slate-400 text-xs font-medium uppercase tracking-wider">单笔数量 (Shares)</label>
                        <input
                            type="number" step="100"
                            className="bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
                            value={config.amountPerGrid}
                            onChange={e => setConfig({ ...config, amountPerGrid: e.target.value })}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-slate-400 text-xs font-medium uppercase tracking-wider">佣金费率 (Rate)</label>
                        <div className="relative">
                            <input
                                type="number" step="0.0001"
                                className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
                                value={config.commissionRate}
                                onChange={e => setConfig({ ...config, commissionRate: e.target.value })}
                            />
                            <span className="absolute right-4 top-3.5 text-slate-500 text-xs mt-0.5">万{(config.commissionRate * 10000).toFixed(1)}</span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-slate-400 text-xs font-medium uppercase tracking-wider">最低佣金 (Min Fee)</label>
                        <div className="relative">
                            <input
                                type="number" step="0.1"
                                className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 font-mono"
                                value={config.minCommission}
                                onChange={e => setConfig({ ...config, minCommission: e.target.value })}
                            />
                            <span className="absolute right-4 top-3.5 text-slate-500 text-xs mt-0.5">元</span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-slate-400 text-xs font-medium uppercase tracking-wider">成交模式</label>
                        <select
                            className="bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                            value={config.usePenetration ? 'true' : 'false'}
                            onChange={e => setConfig({ ...config, usePenetration: e.target.value === 'true' })}
                        >
                            <option value="false" className="bg-slate-900">纯数学模拟 (触价即成)</option>
                            <option value="true" className="bg-slate-900">实盘穿透模拟 (破价方成)</option>
                        </select>
                    </div>

                    <div className="flex items-end">
                        <button
                            onClick={handleSimulate}
                            disabled={loading}
                            className="w-full h-[46px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-xl transition-all shadow-lg shadow-indigo-500/20 flex justify-center items-center gap-2 active:scale-95"
                        >
                            {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <><Play className="w-4 h-4 fill-current" /> 开始跑测</>}
                        </button>
                    </div>
                </div>
            </div>

            {/* Results Area */}
            {result && (
                <div className="flex-1 min-h-0 flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 shrink-0">
                        <StatCard icon={<DollarSign />} label="总净收益" value={(result.totalProfit || 0).toFixed(2)} unit="CNY" color={(result.totalProfit || 0) >= 0 ? "text-emerald-400" : "text-rose-400"} />
                        <StatCard icon={<MoveHorizontal />} label="持仓变动" value={result.netPosition || 0} unit="股" color={result.netPosition > 0 ? "text-indigo-400" : result.netPosition < 0 ? "text-amber-400" : "text-slate-400"} />
                        <StatCard icon={<RefreshCw />} label="总成交次数" value={result.totalTx || 0} unit="笔" color="text-white" />
                        <StatCard icon={<TrendingUp />} label="总佣金成本" value={(result.totalComm || 0).toFixed(2)} unit="CNY" color="text-amber-400" />
                    </div>

                    <div className="bg-slate-800/50 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden flex-1 shadow-xl flex flex-col min-h-[500px]">
                        <div className="px-6 py-2 border-b border-white/5 bg-white/5 flex items-center justify-between shrink-0">
                            <div className="flex gap-4">
                                <button
                                    onClick={() => setViewMode('daily')}
                                    className={`flex items-center gap-2 py-3 px-1 border-b-2 transition-all text-sm font-medium ${viewMode === 'daily' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                                >
                                    <Calendar className="w-4 h-4" /> 每日汇总
                                </button>
                                <button
                                    onClick={() => setViewMode('trades')}
                                    className={`flex items-center gap-2 py-3 px-1 border-b-2 transition-all text-sm font-medium ${viewMode === 'trades' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                                >
                                    <List className="w-4 h-4" /> 成交流水 ({result.trades?.length || 0})
                                </button>
                                <button
                                    onClick={() => setViewMode('chart')}
                                    className={`flex items-center gap-2 py-3 px-1 border-b-2 transition-all text-sm font-medium ${viewMode === 'chart' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                                >
                                    <TrendingUp className="w-4 h-4" /> 交易图表
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto relative min-h-0">
                            {viewMode === 'daily' && (
                                <table className="w-full text-left text-sm text-slate-300">
                                    <thead className="bg-slate-900/50 sticky top-0 backdrop-blur-md z-10 text-xs uppercase tracking-wider font-semibold text-slate-500">
                                        <tr>
                                            <th className="px-6 py-4">日期</th>
                                            <th className="px-6 py-4 text-right">收盘价</th>
                                            <th className="px-6 py-4 text-right">买入次数</th>
                                            <th className="px-6 py-4 text-right">卖出次数</th>
                                            <th className="px-6 py-4 text-right">佣金</th>
                                            <th className="px-6 py-4 text-right">每日盈亏</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5 font-mono">
                                        {result.dailyStats?.map(stat => (
                                            <tr key={stat.date} className="hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-4 text-slate-400">{stat.date}</td>
                                                <td className="px-6 py-4 text-right text-slate-400">{stat.closePrice?.toFixed(3)}</td>
                                                <td className="px-6 py-4 text-right text-emerald-500 font-bold">{stat.buyCount || '-'}</td>
                                                <td className="px-6 py-4 text-right text-rose-500 font-bold">{stat.sellCount || '-'}</td>
                                                <td className="px-6 py-4 text-right text-amber-500/70">{stat.commission?.toFixed(2)}</td>
                                                <td className={`px-6 py-4 text-right font-bold ${stat.netProfit > 0 ? 'text-emerald-400' : stat.netProfit < 0 ? 'text-rose-400' : 'text-slate-600'}`}>
                                                    {stat.netProfit !== 0 ? stat.netProfit?.toFixed(2) : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                        {(!result.dailyStats || result.dailyStats.length === 0) && (
                                            <tr>
                                                <td colSpan="6" className="px-6 py-12 text-center text-slate-500 italic">
                                                    所选周期内无交易产生，请尝试调整基准价格或减小网格步长。
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            )}

                            {viewMode === 'trades' && (
                                <table className="w-full text-left text-sm text-slate-300">
                                    <thead className="bg-slate-900/50 sticky top-0 backdrop-blur-md z-10 text-xs uppercase tracking-wider font-semibold text-slate-500">
                                        <tr>
                                            <th className="px-6 py-4 text-left">时间</th>
                                            <th className="px-6 py-4 text-center">类型</th>
                                            <th className="px-6 py-4 text-right">成交价</th>
                                            <th className="px-6 py-4 text-right">成交数量</th>
                                            <th className="px-6 py-4 text-right">佣金</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5 font-mono">
                                        {result.trades?.map((trade, idx) => (
                                            <tr key={idx} className="hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-4 text-slate-400 text-xs">{trade.time}</td>
                                                <td className="px-6 py-4 text-center">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${trade.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-500 border border-rose-500/20'}`}>
                                                        {trade.type === 'BUY' ? '买入' : '卖出'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right font-bold">{trade.price?.toFixed(3)}</td>
                                                <td className="px-6 py-4 text-right text-slate-400">{trade.amount}</td>
                                                <td className="px-6 py-4 text-right text-amber-500/70">{trade.comm?.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                        {(!result.trades || result.trades.length === 0) && (
                                            <tr>
                                                <td colSpan="5" className="px-6 py-12 text-center text-slate-500 italic">暂无成交流水</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            )}

                            {viewMode === 'chart' && (
                                <div className="p-4 h-full min-h-[460px]">
                                    <TradeChart data={result.chartData} trades={result.trades} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const StatCard = ({ icon, label, value, unit, color }) => (
    <div className="bg-slate-800/50 backdrop-blur-md rounded-2xl p-6 border border-white/10 relative overflow-hidden group">
        <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
            {React.cloneElement(icon, { className: "w-24 h-24" })}
        </div>
        <p className="text-slate-400 text-sm font-medium mb-1">{label}</p>
        <div className={`text-4xl font-bold font-mono tracking-tight ${color}`}>
            {value} <span className="text-lg text-slate-500 font-normal">{unit}</span>
        </div>
    </div>
);

export default SimulationPanel;
