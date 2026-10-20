// ==UserScript==
// @name         NanoGPT Dynamic Model Worth & Value Analyzer
// @namespace    https://nano-gpt.com/
// @version      3.3
// @description  Tuned for heavy SillyTavern input usage. Cost-first with cache read factored in. Sorts by score, excludes Auto from medals, collapses Benchmarks.
// @author       PinkThor
// @downloadURL  https://raw.githubusercontent.com/PinkThor/Nano-GPT-Model-Ranking.js/main/NanoGPT%20Dynamic%20Model%20Worth%20%26%20Value%20Analyzer.user.js
// @updateURL    https://raw.githubusercontent.com/PinkThor/Nano-GPT-Model-Ranking.js/main/NanoGPT%20Dynamic%20Model%20Worth%20%26%20Value%20Analyzer.user.js
// @match        https://nano-gpt.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ─── CONFIG ────────────────────────────────────────────────────────────────
    // Tuned for: ~41K input / ~1.5K output per turn, heavy SillyTavern card
    // Cache hit rate ~55% (based on nano-gpt's own cache stats for this model)
    const CONFIG = {
        freshInputWeight: 0.43,  // 45% of input tokens are uncached (new each turn)
        cacheReadWeight:  0.53,  // 55% of input tokens hit cache (system prompt / card)
        outputWeight:     0.04,  // output is a tiny fraction of total spend

        // When a provider has no cache read pricing (N/A),
        // fall back to full input price for that portion
        noCacheFallbackToInput: true,

        tpsCompetenceWeight: 0.30, // TPS shifts score ±30% max — cost still wins

        precisionMultipliers: {
            'FP16': 1.00,
            'BF16': 1.00,
            'FP8':  0.95,
            'UNK':  0.90,
            'FP4':  0.75
        },
        defaultPrecisionMultiplier: 0.85
    };
    // ───────────────────────────────────────────────────────────────────────────

    let currentSortAsc = false;

    // Auto-collapse the Benchmarks accordion
    function collapseBenchmarks() {
        document.querySelectorAll('summary._121vs8h1l').forEach(summary => {
            const details = summary.closest('details');
            if (details && details.hasAttribute('open')) {
                details.removeAttribute('open');
            }
        });
    }

    // Inject CSS to widen table and fix name truncation
    function injectStyles() {
        if (document.getElementById('nanogpt-worth-style')) return;
        const style = document.createElement('style');
        style.id = 'nanogpt-worth-style';
        style.textContent = `
            #providers,
            #providers .mantine-Card-root,
            .mantine-Container-root:has(#providers) {
                max-width: 100% !important;
                width: 100% !important;
            }
            #providers table {
                --provider-table-min-width: 1100px !important;
                --provider-name-column-width: clamp(10ch, 55ch, 40ch) !important;
                min-width: 1100px !important;
                table-layout: auto !important;
                width: 100% !important;
            }
            .udmiiy4 {
                width: 100% !important;
                overflow-x: auto !important;
            }
            .worth-sort-btn:hover {
                background: rgba(34, 197, 94, 0.12) !important;
            }
        `;
        document.head.appendChild(style);
    }

    function parseCurrency(text) {
        if (!text || text.includes('N/A')) return null;
        const matches = text.match(/\$([0-9]+(?:\.[0-9]+)?)/g);
        if (!matches || matches.length === 0) return null;
        return parseFloat(matches[matches.length - 1].replace('$', ''));
    }

    function parseNumber(text) {
        if (!text || text.includes('N/A')) return null;
        const match = text.match(/([0-9]+(?:\.[0-9]+)?)/);
        return match ? parseFloat(match[1]) : null;
    }

    function detectPrecision(row) {
        const text = row.innerText;
        for (const key of Object.keys(CONFIG.precisionMultipliers)) {
            if (new RegExp(`\\b${key}\\b`, 'i').test(text)) return key;
        }
        return 'UNK';
    }

    function isAutoProvider(row) {
        const nameEl = row.querySelector('.udmiiy7, [style*="font-weight: 600"]');
        const name = nameEl ? nameEl.innerText.trim() : row.innerText;
        return /^auto\b/i.test(name);
    }

    function sortTableByScore(table, rowData, ascending = false) {
        const tbody = table.querySelector('tbody');
        if (!tbody) return;
        const sorted = [...rowData].sort((a, b) =>
            ascending ? a.score - b.score : b.score - a.score
        );
        sorted.forEach(d => tbody.appendChild(d.row));
        const chevron = table.querySelector('.worth-sort-chevron');
        if (chevron) {
            chevron.innerHTML = ascending
                ? '<path d="M6 15l6 -6l6 6"></path>'
                : '<path d="M6 9l6 6l6 -6"></path>';
        }
    }

    function processTable() {
        injectStyles();
        collapseBenchmarks();

        const table = document.querySelector('#providers table');
        if (!table) return;
        if (table.querySelector('.worth-header')) return;

        const headerRow = table.querySelector('thead tr');
        if (!headerRow) return;

        // Map column indices dynamically
        const headers = Array.from(headerRow.querySelectorAll('th'));
        const colMap = {};
        headers.forEach((th, idx) => {
            const txt = th.innerText.toLowerCase();
            if (txt.includes('provider'))                                   colMap.provider   = idx;
            else if (txt.includes('input') && !txt.includes('cache'))      colMap.input      = idx;
            else if (txt.includes('output'))                               colMap.output     = idx;
            else if (txt.includes('cache'))                                colMap.cacheRead  = idx;
            else if (txt.includes('throughput') || txt.includes('speed'))  colMap.throughput = idx;
        });

        if (colMap.input === undefined) return;

        // --- Inject interactive header ---
        const worthTh = document.createElement('th');
        worthTh.className = (headerRow.lastElementChild?.className || '') + ' worth-header';
        worthTh.style.cssText = 'text-align:right; width:185px; min-width:185px; padding-right:14px;';
        worthTh.innerHTML = `
            <button type="button" class="worth-sort-btn udmiiyf"
                style="display:inline-flex;align-items:center;justify-content:flex-end;gap:4px;
                       border:none;background:transparent;cursor:pointer;padding:4px 8px;
                       border-radius:6px;font-weight:700;color:#15803d;font-size:13px;
                       transition:background 0.15s ease;"
                title="Tuned for your SillyTavern usage: 96% input (55% cached), 4% output. Click to toggle sort.">
                <span>Worth</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round" class="worth-sort-chevron">
                    <path d="M6 9l6 6l6 -6"></path>
                </svg>
            </button>`;
        headerRow.appendChild(worthTh);

        // --- Parse rows ---
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const rowData = [];

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < headers.length) return;

            const inputPrice     = parseCurrency(cells[colMap.input]?.innerText);
            const outputPrice    = parseCurrency(cells[colMap.output]?.innerText);
            const cacheReadPrice = colMap.cacheRead !== undefined
                ? parseCurrency(cells[colMap.cacheRead]?.innerText)
                : null;
            const tps            = colMap.throughput !== undefined
                ? parseNumber(cells[colMap.throughput]?.innerText)
                : null;
            const precision      = detectPrecision(row);
            const precisionFactor = CONFIG.precisionMultipliers[precision] ?? CONFIG.defaultPrecisionMultiplier;
            const isAuto         = isAutoProvider(row);

            // ── Blended cost: tuned for your SillyTavern token profile ──────────
            let blendedCost = null;
            if (inputPrice !== null && outputPrice !== null) {
                // Cache read: use cache price if available, otherwise fall back to
                // full input price (penalises providers that don't offer caching)
                const effectiveCachePrice = (cacheReadPrice !== null)
                    ? cacheReadPrice
                    : (CONFIG.noCacheFallbackToInput ? inputPrice : inputPrice);

                blendedCost =
                    (inputPrice        * CONFIG.freshInputWeight) +
                    (effectiveCachePrice * CONFIG.cacheReadWeight)  +
                    (outputPrice       * CONFIG.outputWeight);
            }
            // ─────────────────────────────────────────────────────────────────────

            rowData.push({
                row, tps, blendedCost, cacheReadPrice,
                precisionFactor, isAuto, rawScore: 0
            });
        });

        // --- Compute score: cost-first, TPS as competence modifier ---
        const validTPS  = rowData.map(d => d.tps).filter(t => t && t > 0);
        const maxLogTPS = validTPS.length > 0 ? Math.log10(Math.max(...validTPS) + 1) : 1;

        rowData.forEach(d => {
            if (!d.blendedCost || d.blendedCost <= 0) return;
            const costScore = 1 / d.blendedCost;
            const w = CONFIG.tpsCompetenceWeight;
            let tpsModifier = (1 - w);
            if (d.tps && d.tps > 0) {
                const normalizedLogTPS = Math.log10(d.tps + 1) / maxLogTPS;
                tpsModifier = (1 - w) + (w * normalizedLogTPS); // [0.70..1.00]
            }
            d.rawScore = costScore * tpsModifier * d.precisionFactor;
        });

        // Normalize 0–100
        const maxRaw = Math.max(...rowData.map(d => d.rawScore), 1);
        rowData.forEach(d => {
            d.score = d.rawScore > 0 ? Math.round((d.rawScore / maxRaw) * 100) : 0;
        });

        // Medals: non-auto only
        const rankable = [...rowData]
            .filter(d => d.score > 0 && !d.isAuto)
            .sort((a, b) => b.score - a.score);
        rankable.forEach((d, i) => { d.rank = i + 1; });

        // --- Inject cells ---
        rowData.forEach(d => {
            const td = document.createElement('td');
            td.className = (d.row.lastElementChild?.className || '') + ' worth-cell';
            td.style.cssText = 'text-align:right; padding-right:14px;';

            let scoreBadgeBg   = '#f3f4f6';
            let scoreTextColor = '#374151';
            if      (d.score >= 85) { scoreBadgeBg = '#dcfce7'; scoreTextColor = '#15803d'; }
            else if (d.score >= 60) { scoreBadgeBg = '#fef9c3'; scoreTextColor = '#854d0e'; }

            let actionHtml = '';
            if (d.isAuto) {
                actionHtml = `<span style="background:#e5e7eb;color:#6b7280;padding:2px 7px;
                    border-radius:4px;font-size:11px;font-weight:600;">⚙ Auto</span>`;
            } else if (d.rank === 1) {
                actionHtml = `<span style="background:#166534;color:#fff;padding:2px 7px;
                    border-radius:4px;font-size:11px;font-weight:700;">🥇 BEST</span>`;
                d.row.style.backgroundColor = 'rgba(34,197,94,0.08)';
            } else if (d.rank === 2) {
                actionHtml = `<span style="background:#1e40af;color:#fff;padding:2px 6px;
                    border-radius:4px;font-size:11px;font-weight:700;">🥈 2nd</span>`;
            } else if (d.rank === 3) {
                actionHtml = `<span style="background:#9a3412;color:#fff;padding:2px 6px;
                    border-radius:4px;font-size:11px;font-weight:700;">🥉 3rd</span>`;
            }

            const costStr  = d.blendedCost ? `$${d.blendedCost.toFixed(3)} blnd` : 'N/A';
            const cacheStr = d.cacheReadPrice !== null
                ? `cache $${d.cacheReadPrice.toFixed(2)}`
                : `⚠ no cache`;
            const tpsStr   = d.tps ? `${d.tps} tps` : 'No TPS';

            td.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <span style="display:inline-flex;align-items:baseline;gap:2px;
                            padding:2px 6px;border-radius:5px;
                            background:${scoreBadgeBg};color:${scoreTextColor};
                            font-family:ui-monospace,SFMono-Regular,monospace;
                            font-size:13px;font-weight:800;">
                            ${d.score > 0 ? d.score : 'N/A'}<span style="font-size:10px;font-weight:600;opacity:0.7;">pts</span>
                        </span>
                        ${actionHtml}
                    </div>
                    <span style="font-size:11px;font-weight:500;color:#4b5563;white-space:nowrap;">
                        ${costStr} · ${cacheStr}
                    </span>
                    <span style="font-size:10px;color:#9ca3af;white-space:nowrap;">
                        ${tpsStr}
                    </span>
                </div>`;
            d.row.appendChild(td);
        });

        // Auto-sort on load, highest first
        sortTableByScore(table, rowData, false);

        // Click to toggle sort
        const btn = worthTh.querySelector('.worth-sort-btn');
        if (btn) {
            btn.addEventListener('click', e => {
                e.preventDefault();
                currentSortAsc = !currentSortAsc;
                sortTableByScore(table, rowData, currentSortAsc);
            });
        }
    }

    let debounceTimer = null;
    const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            collapseBenchmarks();
            const table = document.querySelector('#providers table');
            if (table && !table.querySelector('.worth-header')) processTable();
        }, 350);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
        collapseBenchmarks();
        processTable();
    }, 600);
})();