(() => {
    'use strict';

    // Konfigurace je záměrně nahoře; běžně se mění pouze PLAYERS.
    const CONFIG = {
        PLAYERS: [
            // Sem dopln hráče kmene, např.:
            // 'Miroo',
        ],

        STATS: [
            { type: 'scavenge', label: 'Sběr surovin' },
            { type: 'loot_res', label: 'Kořist - suroviny' },
            { type: 'loot_vil', label: 'Korist - vesnice' },
            { type: 'kill_att', label: 'Poražení útočníci' },
            { type: 'kill_def', label: 'Poražení obránci' },
        ],

        CONCURRENCY_LIMIT: 8,
        REQUEST_TIMEOUT_MS: 20000,
        DEBUG: false,

        SELECTORS: {
            rankingTable: '#in_a_day_ranking_table',
        },

        TEXT: {
            noDataOriginal: 'V současné době žádná data nejsou k dispozici.',
            dash: '—',
        },
    };

    // Vnitřní stav jednoho otevřeného modalu.
    const STATE = {
        selectedStat: null,
        isLoading: false,
        loadedCount: 0,
        totalCount: 0,
        results: [],
        runId: 0,
    };

    // Console výstup je povolený pouze při CONFIG.DEBUG = true.
    const DEBUG = {
        log(...args) {
            if (CONFIG.DEBUG && window.console && typeof window.console.log === 'function') {
                window.console.log('[DK_TribeStats]', ...args);
            }
        },
    };

    // Malé čisté utility bez vazby na DOM nebo síť.
    const UTIL = {
        normalizeText(value) {
            return String(value || '')
                .replace(/\u00a0/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        },

        normalizeForCompare(value) {
            return UTIL.normalizeText(value)
                .toLocaleLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '');
        },

        escapeHtml(value) {
            return String(value ?? '').replace(/[&<>"']/g, (char) => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;',
            }[char]));
        },

        parsePoints(value) {
            const cleaned = UTIL.normalizeText(value).replace(/[^\d-]/g, '');
            const points = Number.parseInt(cleaned, 10);
            return Number.isFinite(points) ? points : 0;
        },

        formatPoints(value) {
            if (!Number.isFinite(value)) {
                return CONFIG.TEXT.dash;
            }

            return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        },

        getCurrentStatFromUrl() {
            const params = new URLSearchParams(window.location.search);
            const type = params.get('type');
            return CONFIG.STATS.some((stat) => stat.type === type) ? type : null;
        },

        getDefaultStat() {
            return UTIL.getCurrentStatFromUrl() || CONFIG.STATS[0].type;
        },
    };

    // Vlastní modal a vykreslování výsledků.
    const UI = {
        ids: {
            root: 'dk-tribe-stats-root',
            style: 'dk-tribe-stats-style',
            statSelect: 'dk-tribe-stats-select',
            loadButton: 'dk-tribe-stats-load',
            closeButton: 'dk-tribe-stats-close',
            tableBody: 'dk-tribe-stats-body',
            status: 'dk-tribe-stats-status',
        },

        init() {
            UI.removeExisting();
            UI.injectStyles();
            UI.createModal();
            UI.bindEvents();
            UI.setStatus('Připraveno');
            UI.renderRows([]);
        },

        removeExisting() {
            $(`#${UI.ids.root}`).remove();
            $(`#${UI.ids.style}`).remove();
        },

        injectStyles() {
            const css = `
                #${UI.ids.root}.dkts-overlay {
                    position: fixed;
                    inset: 0;
                    z-index: 99999;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 18px;
                    background: rgba(0, 0, 0, 0.55);
                    box-sizing: border-box;
                }

                #${UI.ids.root} .dkts-modal {
                    width: min(880px, 96vw);
                    max-height: min(760px, 92vh);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    color: #2b1d0f;
                    background: #f4e4bc;
                    border: 2px solid #7d510f;
                    box-shadow: 0 16px 42px rgba(0, 0, 0, 0.45);
                    font: 12px Verdana, Arial, sans-serif;
                }

                #${UI.ids.root} .dkts-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    padding: 10px 12px;
                    background: #c1a264;
                    border-bottom: 1px solid #7d510f;
                }

                #${UI.ids.root} .dkts-title {
                    margin: 0;
                    font-size: 15px;
                    font-weight: 700;
                    line-height: 1.25;
                }

                #${UI.ids.root} .dkts-close {
                    width: 28px;
                    height: 28px;
                    line-height: 24px;
                    border: 1px solid #7d510f;
                    background: #f4e4bc;
                    color: #2b1d0f;
                    cursor: pointer;
                    font-size: 18px;
                    font-weight: 700;
                }

                #${UI.ids.root} .dkts-content {
                    padding: 12px;
                    overflow: auto;
                }

                #${UI.ids.root} .dkts-controls {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: end;
                    gap: 10px;
                    margin-bottom: 12px;
                }

                #${UI.ids.root} .dkts-field {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                #${UI.ids.root} .dkts-label {
                    font-weight: 700;
                }

                #${UI.ids.root} select,
                #${UI.ids.root} button {
                    min-height: 28px;
                    box-sizing: border-box;
                    font: 12px Verdana, Arial, sans-serif;
                }

                #${UI.ids.root} select {
                    min-width: 220px;
                    border: 1px solid #7d510f;
                    background: #fff7df;
                    color: #2b1d0f;
                    padding: 4px 8px;
                }

                #${UI.ids.root} .dkts-load {
                    padding: 5px 14px;
                    border: 1px solid #7d510f;
                    background: #6b8e23;
                    color: #fff;
                    cursor: pointer;
                    font-weight: 700;
                }

                #${UI.ids.root} .dkts-load:disabled {
                    cursor: wait;
                    opacity: 0.65;
                }

                #${UI.ids.root} .dkts-table-wrap {
                    overflow: auto;
                    border: 1px solid #7d510f;
                    background: #fff7df;
                }

                #${UI.ids.root} table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                }

                #${UI.ids.root} th,
                #${UI.ids.root} td {
                    padding: 7px 8px;
                    border: 1px solid #d1b982;
                    text-align: left;
                    vertical-align: middle;
                    overflow-wrap: anywhere;
                }

                #${UI.ids.root} th {
                    background: #d8c391;
                    color: #2b1d0f;
                    font-weight: 700;
                }

                #${UI.ids.root} .dkts-col-player {
                    width: 34%;
                }

                #${UI.ids.root} .dkts-col-rank {
                    width: 14%;
                }

                #${UI.ids.root} .dkts-col-points {
                    width: 22%;
                    text-align: right;
                }

                #${UI.ids.root} .dkts-col-date {
                    width: 30%;
                }

                #${UI.ids.root} tr.dkts-no-result td {
                    background: #f8d7da;
                    color: #5b1d23;
                }

                #${UI.ids.root} tr.dkts-error td {
                    background: #7f1d1d;
                    color: #fff;
                }

                #${UI.ids.root} .dkts-status {
                    margin-top: 10px;
                    min-height: 18px;
                    color: #2b1d0f;
                    font-weight: 700;
                }

                #${UI.ids.root} .dkts-empty {
                    text-align: center;
                    color: #6f5b35;
                    font-style: italic;
                }
            `;

            $('<style>', {
                id: UI.ids.style,
                text: css,
            }).appendTo(document.head);
        },

        createModal() {
            const currentStat = UTIL.getDefaultStat();
            const options = CONFIG.STATS.map((stat) => (
                `<option value="${UTIL.escapeHtml(stat.type)}"${stat.type === currentStat ? ' selected' : ''}>${UTIL.escapeHtml(stat.label)}</option>`
            )).join('');

            STATE.selectedStat = currentStat;

            const html = `
                <div id="${UI.ids.root}" class="dkts-overlay" role="dialog" aria-modal="true" aria-label="Statistiky kmene">
                    <div class="dkts-modal">
                        <div class="dkts-header">
                            <h2 class="dkts-title">Statistiky kmene</h2>
                            <button type="button" id="${UI.ids.closeButton}" class="dkts-close" title="Zavřít" aria-label="Zavřít">&times;</button>
                        </div>
                        <div class="dkts-content">
                            <div class="dkts-controls">
                                <label class="dkts-field" for="${UI.ids.statSelect}">
                                    <span class="dkts-label">Statistika</span>
                                    <select id="${UI.ids.statSelect}">
                                        ${options}
                                    </select>
                                </label>
                                <button type="button" id="${UI.ids.loadButton}" class="dkts-load">Načíst</button>
                            </div>
                            <div class="dkts-table-wrap">
                                <table>
                                    <thead>
                                        <tr>
                                            <th class="dkts-col-player">Hráč</th>
                                            <th class="dkts-col-rank">Místo</th>
                                            <th class="dkts-col-points">Body</th>
                                            <th class="dkts-col-date">Datum</th>
                                        </tr>
                                    </thead>
                                    <tbody id="${UI.ids.tableBody}"></tbody>
                                </table>
                            </div>
                            <div id="${UI.ids.status}" class="dkts-status"></div>
                        </div>
                    </div>
                </div>
            `;

            $('body').append(html);
        },

        bindEvents() {
            $(`#${UI.ids.closeButton}`).on('click.dkts', () => UI.close());
            $(`#${UI.ids.loadButton}`).on('click.dkts', () => MAIN.loadSelectedStat());
            $(`#${UI.ids.statSelect}`).on('change.dkts', (event) => {
                STATE.selectedStat = event.currentTarget.value;
            });
        },

        close() {
            $(`#${UI.ids.root}`).remove();
            $(`#${UI.ids.style}`).remove();
        },

        setLoading(isLoading) {
            STATE.isLoading = isLoading;
            $(`#${UI.ids.loadButton}`).prop('disabled', isLoading).text(isLoading ? 'Načítám...' : 'Načíst');
            $(`#${UI.ids.statSelect}`).prop('disabled', isLoading);
        },

        setStatus(text) {
            $(`#${UI.ids.status}`).text(text);
        },

        renderRows(results) {
            const $body = $(`#${UI.ids.tableBody}`);

            if (!results.length) {
                $body.html(`
                    <tr>
                        <td class="dkts-empty" colspan="4">Zadne vysledky k zobrazeni</td>
                    </tr>
                `);
                return;
            }

            const rows = results.map((result) => UI.renderRow(result)).join('');
            $body.html(rows);
        },

        renderRow(result) {
            const rowClass = result.status === 'error'
                ? 'dkts-error'
                : result.status === 'no-result'
                    ? 'dkts-no-result'
                    : '';

            const rank = result.status === 'ok' ? result.rank : CONFIG.TEXT.dash;
            const points = result.status === 'ok'
                ? UTIL.formatPoints(result.points)
                : result.status === 'error'
                    ? 'chyba komunikace'
                    : result.status === 'loading'
                        ? 'načítám...'
                        : 'bez výsledku';
            const date = result.status === 'ok' ? result.date : CONFIG.TEXT.dash;

            return `
                <tr class="${rowClass}">
                    <td class="dkts-col-player">${UTIL.escapeHtml(result.player)}</td>
                    <td class="dkts-col-rank">${UTIL.escapeHtml(rank)}</td>
                    <td class="dkts-col-points">${UTIL.escapeHtml(points)}</td>
                    <td class="dkts-col-date">${UTIL.escapeHtml(date)}</td>
                </tr>
            `;
        },

        updateProgress() {
            UI.setStatus(`Načteno ${STATE.loadedCount} / ${STATE.totalCount}`);
        },
    };

    // Sestavení URL a GET požadavky na aktuálním světě.
    const NETWORK = {
        buildRankingUrl(type, playerName) {
            const url = new URL(window.location.href);
            url.searchParams.set('screen', 'ranking');
            url.searchParams.set('mode', 'in_a_day');
            url.searchParams.set('type', type);
            url.searchParams.set('name', playerName);
            return url.toString();
        },

        fetchPlayerPage(type, playerName) {
            const url = NETWORK.buildRankingUrl(type, playerName);
            DEBUG.log('GET', url);

            return $.ajax({
                url,
                method: 'GET',
                dataType: 'html',
                timeout: CONFIG.REQUEST_TIMEOUT_MS,
                cache: false,
            });
        },
    };

    // Parser používá výhradně tabulku #in_a_day_ranking_table.
    const PARSER = {
        parsePlayerResult(html, playerName) {
            const documentNode = new DOMParser().parseFromString(html, 'text/html');
            const normalizedHtmlText = UTIL.normalizeForCompare(documentNode.body?.textContent || html);
            const normalizedNoDataOriginal = UTIL.normalizeForCompare(CONFIG.TEXT.noDataOriginal);

            if (normalizedHtmlText.includes(normalizedNoDataOriginal)) {
                return PARSER.noResult(playerName);
            }

            const table = documentNode.querySelector(CONFIG.SELECTORS.rankingTable);

            if (!table) {
                throw new Error('Ranking table was not found.');
            }

            const columns = PARSER.getColumnIndexes(table);
            const row = PARSER.findPlayerRow(table, columns.name, playerName);

            if (!row) {
                return PARSER.noResult(playerName);
            }

            const cells = Array.from(row.cells);
            const rank = UTIL.normalizeText(cells[columns.rank]?.textContent);
            const pointsText = UTIL.normalizeText(cells[columns.points]?.textContent);
            const date = UTIL.normalizeText(cells[columns.date]?.textContent);

            return {
                player: playerName,
                rank: rank || CONFIG.TEXT.dash,
                points: UTIL.parsePoints(pointsText),
                date: date || CONFIG.TEXT.dash,
                status: 'ok',
            };
        },

        getColumnIndexes(table) {
            const headerCells = Array.from(table.rows[0]?.cells || []);
            const indexes = {};

            headerCells.forEach((cell, index) => {
                const label = UTIL.normalizeForCompare(cell.textContent);

                if (label.includes('misto')) {
                    indexes.rank = index;
                } else if (label.includes('jmeno')) {
                    indexes.name = index;
                } else if (label.includes('body')) {
                    indexes.points = index;
                } else if (label.includes('datum')) {
                    indexes.date = index;
                }
            });

            const required = ['rank', 'name', 'points', 'date'];
            const missing = required.filter((key) => !Number.isInteger(indexes[key]));

            if (missing.length) {
                throw new Error(`Missing ranking columns: ${missing.join(', ')}`);
            }

            return indexes;
        },

        findPlayerRow(table, nameColumnIndex, playerName) {
            const expected = UTIL.normalizeForCompare(playerName);
            const rows = Array.from(table.querySelectorAll('tr')).slice(1);

            return rows.find((row) => {
                const nameCell = row.cells[nameColumnIndex];

                if (!nameCell) {
                    return false;
                }

                const link = nameCell.querySelector('a');
                const actualName = UTIL.normalizeForCompare(link ? link.textContent : nameCell.textContent);
                return actualName === expected;
            });
        },

        noResult(playerName) {
            return {
                player: playerName,
                rank: CONFIG.TEXT.dash,
                points: Number.NEGATIVE_INFINITY,
                date: CONFIG.TEXT.dash,
                status: 'no-result',
            };
        },

        communicationError(playerName) {
            return {
                player: playerName,
                rank: CONFIG.TEXT.dash,
                points: Number.NEGATIVE_INFINITY,
                date: CONFIG.TEXT.dash,
                status: 'error',
            };
        },
    };

    // Omezená paralelizace chrání server a zároveň nenačítá hráče sekvenčně.
    const LOADER = {
        async mapWithConcurrency(items, limit, iterator) {
            const results = new Array(items.length);
            let nextIndex = 0;

            async function worker() {
                while (nextIndex < items.length) {
                    const currentIndex = nextIndex;
                    nextIndex += 1;
                    results[currentIndex] = await iterator(items[currentIndex], currentIndex);
                }
            }

            const workerCount = Math.min(limit, items.length);
            const workers = Array.from({ length: workerCount }, () => worker());
            await Promise.all(workers);
            return results;
        },
    };

    // Orchestrace načtení, řazení a předání dat do UI.
    const MAIN = {
        start() {
            if (typeof window.jQuery === 'undefined') {
                return;
            }

            UI.init();
        },

        async loadSelectedStat() {
            if (STATE.isLoading) {
                return;
            }

            const players = MAIN.getConfiguredPlayers();
            STATE.selectedStat = $(`#${UI.ids.statSelect}`).val() || UTIL.getDefaultStat();
            STATE.loadedCount = 0;
            STATE.totalCount = players.length;
            STATE.results = [];
            STATE.runId += 1;
            const currentRunId = STATE.runId;

            if (!players.length) {
                UI.renderRows([]);
                UI.setStatus('V CONFIG.PLAYERS nejsou žádní hráči.');
                return;
            }

            UI.setLoading(true);
            UI.renderRows(players.map((player) => ({
                player,
                rank: CONFIG.TEXT.dash,
                points: Number.NEGATIVE_INFINITY,
                date: CONFIG.TEXT.dash,
                status: 'loading',
            })));
            UI.updateProgress();

            try {
                const results = await LOADER.mapWithConcurrency(
                    players,
                    CONFIG.CONCURRENCY_LIMIT,
                    async (player) => MAIN.loadSinglePlayer(STATE.selectedStat, player, currentRunId),
                );

                if (currentRunId !== STATE.runId) {
                    return;
                }

                STATE.results = MAIN.sortResults(results);
                UI.renderRows(STATE.results);
                UI.updateProgress();
            } finally {
                if (currentRunId === STATE.runId) {
                    UI.setLoading(false);
                }
            }
        },

        async loadSinglePlayer(type, player, runId) {
            try {
                const html = await NETWORK.fetchPlayerPage(type, player);
                const result = PARSER.parsePlayerResult(html, player);
                MAIN.afterPlayerLoaded(runId);
                return result;
            } catch (error) {
                DEBUG.log('Communication error', player, error);
                MAIN.afterPlayerLoaded(runId);
                return PARSER.communicationError(player);
            }
        },

        afterPlayerLoaded(runId) {
            if (runId !== STATE.runId) {
                return;
            }

            STATE.loadedCount += 1;
            UI.updateProgress();
        },

        sortResults(results) {
            return [...results].sort((a, b) => {
                const pointsDiff = b.points - a.points;

                if (pointsDiff !== 0) {
                    return pointsDiff;
                }

                return UTIL.normalizeForCompare(a.player).localeCompare(UTIL.normalizeForCompare(b.player));
            });
        },

        getConfiguredPlayers() {
            const seen = new Set();

            return CONFIG.PLAYERS
                .map((player) => UTIL.normalizeText(player))
                .filter(Boolean)
                .filter((player) => {
                    const key = UTIL.normalizeForCompare(player);

                    if (seen.has(key)) {
                        return false;
                    }

                    seen.add(key);
                    return true;
                });
        },
    };

    MAIN.start();
})();
