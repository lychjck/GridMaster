import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar, X } from 'lucide-react';

const CyberDatePicker = ({
    selectedDate,
    onSelect,
    availableDates = [],
    onClose
}) => {
    // Determine initial view date from selectedDate or latest available date
    const initialDate = selectedDate ? new Date(selectedDate) : new Date();
    const [viewDate, setViewDate] = useState(initialDate);

    // Helper: format YYYY-MM-DD
    const formatDate = (d) => {
        return d.toISOString().split('T')[0];
    };

    // Helper: Get days in month
    const getDaysInMonth = (year, month) => {
        return new Date(year, month + 1, 0).getDate();
    };

    // Helper: Get day of week for 1st of month (0 = Sun, 6 = Sat)
    const getFirstDayOfMonth = (year, month) => {
        return new Date(year, month, 1).getDay();
    };

    const currentYear = viewDate.getFullYear();
    const currentMonth = viewDate.getMonth();

    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

    // Lookups for availability (Set for O(1))
    const availableSet = new Set(availableDates);

    // Navigation
    const prevMonth = (e) => {
        e.stopPropagation();
        setViewDate(new Date(currentYear, currentMonth - 1, 1));
    };
    const nextMonth = (e) => {
        e.stopPropagation();
        setViewDate(new Date(currentYear, currentMonth + 1, 1));
    };

    // Generate Calendar Grid
    const renderCalendarDays = () => {
        const days = [];

        // Padding for previous month
        for (let i = 0; i < firstDay; i++) {
            days.push(<div key={`pad-${i}`} className="h-8 w-8"></div>);
        }

        // Actual Days
        for (let d = 1; d <= daysInMonth; d++) {
            // Construct YYYY-MM-DD locally to avoid timezone shifts
            // Format: YYYY-MM-DD (month is 0-indexed)
            const monthStr = String(currentMonth + 1).padStart(2, '0');
            const dayStr = String(d).padStart(2, '0');
            const dateStr = `${currentYear}-${monthStr}-${dayStr}`;

            const isAvailable = availableSet.has(dateStr);
            const isSelected = selectedDate === dateStr;

            days.push(
                <button
                    key={dateStr}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (isAvailable) {
                            onSelect(dateStr);
                        }
                    }}
                    disabled={!isAvailable}
                    className={`
                        h-8 w-8 rounded-lg flex items-center justify-center text-xs font-mono transition-all relative
                        ${isSelected
                            ? 'bg-indigo-600 text-white shadow-[0_0_10px_rgba(99,102,241,0.6)] scale-110 z-10 font-bold'
                            : isAvailable
                                ? 'text-slate-200 hover:bg-white/10 hover:text-white cursor-pointer hover:border hover:border-indigo-500/30'
                                : 'text-slate-700 cursor-not-allowed'
                        }
                    `}
                >
                    {d}
                    {isAvailable && !isSelected && (
                        <div className="absolute bottom-1 w-1 h-1 rounded-full bg-emerald-500/50"></div>
                    )}
                </button>
            );
        }
        return days;
    };

    const MONTH_NAMES = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];

    return (
        <div
            className="flex flex-col w-64 p-4"
            onClick={(e) => e.stopPropagation()}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <button onClick={prevMonth} className="p-1 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition-colors">
                    <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="font-bold text-slate-200 flex items-center gap-1">
                    <span className="text-white">{MONTH_NAMES[currentMonth]}</span>
                    <span className="text-slate-500 font-mono">{currentYear}</span>
                </div>
                <button onClick={nextMonth} className="p-1 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition-colors">
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>

            {/* Weekdays */}
            <div className="grid grid-cols-7 mb-2">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                    <div key={day} className="h-8 w-8 flex items-center justify-center text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                        {day}
                    </div>
                ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-y-1">
                {renderCalendarDays()}
            </div>

            {/* Legend/Footer */}
            <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-500">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/50"></div>
                        <span>数据可用</span>
                    </div>
                </div>
                <button onClick={onClose} className="hover:text-slate-300 transition-colors">Close</button>
            </div>
        </div>
    );
};

export default CyberDatePicker;
