import React, { createContext, useContext, useState, useEffect } from 'react';

export const THEMES = [
    {
        id: 'aurora',
        name: '星云极光',
        nameEn: 'Aurora',
        preview: ['#1e1b4b', '#3730a3', '#6366f1'],
        accent: '#6366f1',
        accentGlow: 'rgba(99, 102, 241, 0.5)',
    },
    {
        id: 'forest',
        name: '翡翠森林',
        nameEn: 'Forest',
        preview: ['#064e3b', '#065f46', '#10b981'],
        accent: '#10b981',
        accentGlow: 'rgba(16, 185, 129, 0.5)',
    },
    {
        id: 'lava',
        name: '赤焰熔岩',
        nameEn: 'Lava',
        preview: ['#7f1d1d', '#9a3412', '#f97316'],
        accent: '#f97316',
        accentGlow: 'rgba(249, 115, 22, 0.5)',
    },
    {
        id: 'ocean',
        name: '星际深蓝',
        nameEn: 'Ocean',
        preview: ['#0c1445', '#0e3a6e', '#0ea5e9'],
        accent: '#0ea5e9',
        accentGlow: 'rgba(14, 165, 233, 0.5)',
    },
    {
        id: 'dawn',
        name: '金色黎明',
        nameEn: 'Dawn',
        preview: ['#451a03', '#78350f', '#f59e0b'],
        accent: '#f59e0b',
        accentGlow: 'rgba(245, 158, 11, 0.5)',
    },
    {
        id: 'rose',
        name: '暗夜玫瑰',
        nameEn: 'Rose',
        preview: ['#4a044e', '#701a75', '#e879f9'],
        accent: '#e879f9',
        accentGlow: 'rgba(232, 121, 249, 0.5)',
    },
];

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
    const [themeId, setThemeId] = useState(
        () => localStorage.getItem('theme') || 'aurora'
    );

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', themeId);
        localStorage.setItem('theme', themeId);

        const theme = THEMES.find(t => t.id === themeId);
        if (theme) {
            document.documentElement.style.setProperty('--accent-primary', theme.accent);
            document.documentElement.style.setProperty('--accent-glow', theme.accentGlow);
        }
    }, [themeId]);

    // Apply on mount (SSR / fresh load)
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', themeId);
        const theme = THEMES.find(t => t.id === themeId);
        if (theme) {
            document.documentElement.style.setProperty('--accent-primary', theme.accent);
            document.documentElement.style.setProperty('--accent-glow', theme.accentGlow);
        }
    }, []);

    return (
        <ThemeContext.Provider value={{ themeId, setThemeId, themes: THEMES }}>
            {children}
        </ThemeContext.Provider>
    );
};

export const useTheme = () => {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
    return ctx;
};
