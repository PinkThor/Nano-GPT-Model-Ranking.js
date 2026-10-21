// ==UserScript==
// @name         NanoGPT Rupiah Price & Worth Analyzer
// @namespace    https://nano-gpt.com/
// @version      4.0
// @description  Converts abstract $0.05/1M pricing into real Rupiah per turn (Rp 18.000/$) across models catalog and provider tables.
// @match        https://nano-gpt.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ─── USER WORKLOAD & CURRENCY CONFIG ─────────────────────────────────────────
    const CONFIG = {
        idrRate: 18000,          // 1 USD = Rp 18.000
        typicalInputTokens: 41532, // Your typical SillyTavern prompt
        typicalOutputTokens: 1504, // Your typical reply length
        cacheHitRate: 0.55,      // ~55% of prompt is cached card/context

        tpsCompetenceWeight: 0.30,
        precisionMultipliers: {
            'FP16': 1.00,
            'BF16': 1.00,
            'FP8':  0.95,
            'UNK':  0.90,
            'FP4':  0.75
        },
        defaultPrecisionMultiplier: 0.85
    };
    // ─────────────────────────────────────────────────────────────────────────────

    let currentSortAsc = false;

    // Helper: Calculate exact cost in Rupiah for 1 turn
    function calculateTurnCostIdr(inputPerM, outputPerM, cachePerM = null) {
        if (inputPerM === null || outputPerM === null) return null;

        let totalUsd = 0;
        if (cachePerM !== null) {
            const freshInputTokens = CONFIG.typicalInputTokens * (1 - CONFIG.cacheHitRate);
            const cachedInputTokens = CONFIG.typicalInputTokens * CONFIG.cacheHitRate;
            totalUsd = (freshInputTokens / 1e6 * inputPerM) +
                       (cachedInputTokens / 1e6 * cachePerM) +
                       (CONFIG.typicalOutputTokens / 1e6 * outputPerM);
        } else {
            totalUsd = (CONFIG.typicalInputTokens / 1e6 * inputPerM) +
                       (CONFIG.typicalOutputTokens / 1e6 * outputPerM);
        }
        return Math.round(totalUsd * CONFIG.idrRate);
    }

    // 1. Convert Prices on the Model Catalog Page (/models/text)
    function enhanceModelCatalog() {
        // Target model price spans (e.g. $0.05 / $0.16 per 1M)
        const priceSpans = document.querySelectorAll('span._13zcistf, span:not(.idr-tagged)');
        priceSpans.forEach(span => {
            if (span.classList.contains('idr-tagged')) return;
            const text = span.innerText;
            const match = text.match(/\$([0-9.]+)\s*\/\s*\$([0-9.]+)/);
            if (match && text.includes('1M')) {
                span.classList.add('idr-tagged');
                const inPrice = parseFloat(match[1]);
                const outPrice = parseFloat(match[2]);
                const costIdr = calculateTurnCostIdr(inPrice, outPrice);

                if (costIdr !== null) {
                    const idrBadge = document.createElement('span');
                    idrBadge.style.cssText = `
                        display: inline-block;
                        margin-left: 8px;
                        padding: 1px 6px;
                        border-radius: 4px;
                        font-weight: 700;
                        font-size: 11px;
                        background: #dcfce7;
                        color: #15803d;
                        letter-spacing: 0.2px;
                    `;
                    idrBadge.title = `Simulated for your setup: ${CONFIG.typicalInputTokens.toLocaleString()} in + ${CONFIG.typicalOutputTokens.toLocaleString()} out @ Rp ${CONFIG.idrRate.toLocaleString()}/$`;
                    idrBadge.textContent = `≈ Rp ${costIdr.toLocaleString('id-ID')} / msg`;
                    span.appendChild(idrBadge);
                }
            }
        });
    }

    // 2. Collapse Benchmarks Accordion
    function collapseBenchmarks() {
        document.querySelectorAll('summary._121vs8h1l').forEach(summary => {
            const details = summary.closest('details');
            if (details && details.hasAttribute('open')) {
                details.removeAttribute('open');
            }
        });
    }

    // 3. Widen Tables & Remove Truncation
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
                --provider-table-min-width: 1120px !important;
                --provider-name-column-width: clamp(10ch, 55ch, 40ch) !important;
                min-width: 1120px !important;
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

    // 4. Enhance Provider Tables (#providers table)
    function processTable() {
        injectStyles();
        collapseBenchmarks();
        enhanceModelCatalog();

        const table = document.querySelector('#providers table');
        if (!table) return;
        if (table.querySelector('.worth-header')) return;

        const headerRow = table.querySelector('thead tr');
        if (!headerRow) return;

        const headers = Array.from(headerRow.querySelectorAll('th'));
        const colMap = {};
        headers.forEach((th, idx) => {
            const txt = th.innerText.toLowerCase();
            if (txt.includes('provider'))                                  colMap.provider   = idx;
            else if (txt.includes('input') && !txt.includes('cache'))     colMap.input      = idx;
            else if (txt.includes('output'))                              colMap.output     = idx;
            else if (txt.includes('cache'))                               colMap.cacheRead  = idx;
            else if (txt.includes('throughput') || txt.includes('speed')) colMap.throughput = idx;
        });

        if (colMap.input === undefined) return;

        // Header
        const worthTh = document.createElement('th');
        worthTh.className = (headerRow.lastElementChild?.className || '') + ' worth-header';
        worthTh.style.cssText = 'text-align: right; width: 190px; min-width: 190px; padding-right: 14px;';
        worthTh.innerHTML = `
            <button type="button" class="worth-sort-btn udmiiyf"
                style="display:inline-flex;align-items:center;justify-content:flex-end;gap:4px;
                       border:none;background:transparent;cursor:pointer;padding:4px 8px;
                       border-radius:6px;font-weight:700;color:#15803d;font-size:13px;
                       transition:background 0.15s ease;"
                title="Sorted by cheapest Rupiah cost per message (41.5k in / 1.5k out @ Rp 18k/$)">
                <span>Worth (Rp)</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round" class="worth-sort-chevron">
                    <path d="M6 9l6 6l6 -6"></path>
                </svg>
            </button>`;
        headerRow.appendChild(worthTh);

        // Parse Rows
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const rowData = [];

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length < headers.length) return;

            const inputPrice      = parseCurrency(cells[colMap.input]?.innerText);
            const outputPrice     = parseCurrency(cells[colMap.output]?.innerText);
            const cacheReadPrice  = colMap.cacheRead !== undefined ? parseCurrency(cells[colMap.cacheRead]?.innerText) : null;
            const tps             = colMap.throughput !== undefined ? parseNumber(cells[colMap.throughput]?.innerText) : null;
            const precision       = detectPrecision(row);
            const precisionFactor = CONFIG.precisionMultipliers[precision] ?? CONFIG.defaultPrecisionMultiplier;
            const isAuto          = isAutoProvider(row);

            // Compute turn cost in IDR
            const costIdr = calculateTurnCostIdr(inputPrice, outputPrice, cacheReadPrice);

            rowData.push({
                row, tps, costIdr, cacheReadPrice,
                precisionFactor, isAuto, rawScore: 0
            });
        });

        // Compute score: inverse of cost in Rupiah
        const validTPS = rowData.map(d => d.tps).filter(t => t && t > 0);
        const maxLogTPS = validTPS.length > 0 ? Math.log10(Math.max(...validTPS) + 1) : 1;

        rowData.forEach(d => {
            if (!d.costIdr || d.costIdr <= 0) return;
            const costScore = 1 / d.costIdr;
            const w = CONFIG.tpsCompetenceWeight;
            let tpsModifier = (1 - w);
            if (d.tps && d.tps > 0) {
                const normalizedLogTPS = Math.log10(d.tps + 1) / maxLogTPS;
                tpsModifier = (1 - w) + (w * normalizedLogTPS);
            }
            d.rawScore = costScore * tpsModifier * d.precisionFactor;
        });

        // Normalize 0–100
        const maxRaw = Math.max(...rowData.map(d => d.rawScore), 1);
        rowData.forEach(d => {
            d.score = d.rawScore > 0 ? Math.round((d.rawScore / maxRaw) * 100) : 0;
        });

        // Rank non-auto providers
        const rankable = [...rowData]
            .filter(d => d.score > 0 && !d.isAuto)
            .sort((a, b) => b.score - a.score);
        rankable.forEach((d, i) => { d.rank = i + 1; });

        // Inject Cells
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

            const idrStr = d.costIdr ? `Rp ${d.costIdr.toLocaleString('id-ID')} / msg` : 'No price';
            const cacheStatus = d.cacheReadPrice !== null ? `✓ cached` : `⚠ no cache`;
            const tpsStr = d.tps ? `${d.tps} tps` : 'No TPS';

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
                    <span style="font-size:12px;font-weight:700;color:#1e293b;white-space:nowrap;">
                        ${idrStr}
                    </span>
                    <span style="font-size:10px;color:#64748b;white-space:nowrap;">
                        ${cacheStatus} · ${tpsStr}
                    </span>
                </div>`;
            d.row.appendChild(td);
        });

        // Initial Sort (Cheapest / Highest Score First)
        sortTableByScore(table, rowData, false);

        // Header click toggle
        const btn = worthTh.querySelector('.worth-sort-btn');
        if (btn) {
            btn.addEventListener('click', e => {
                e.preventDefault();
                currentSortAsc = !currentSortAsc;
                sortTableByScore(table, rowData, currentSortAsc);
            });
        }
    }

    // Dynamic Observer for SPAs & Page Transitions
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            collapseBenchmarks();
            enhanceModelCatalog();
            const table = document.querySelector('#providers table');
            if (table && !table.querySelector('.worth-header')) processTable();
        }, 350);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        collapseBenchmarks();
        enhanceModelCatalog();
        processTable();
    }, 600);
})();
