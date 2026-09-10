// Cross-RQA tab.
//
// Cross-recurrence between two measures, with windowed metrics.
//
// Self-registering: dims-core.js does not know this file exists, and deleting
// it removes the tab and nothing else. See docs/contracts/tab.md.
(function () {
    'use strict';

    // Colours come from the host's palette through the documented
    // accessor, read at draw time so a theme switch is picked up. Tabs
    // must not reach into the host's script scope: a tab file is a
    // separate script and cannot rely on seeing its variables.

    window.DIMS.extendHost({
        async loadCRQAData(videoID) {
            this.showStatus('Loading cross-RQA data...');

            try {
                const dataPath = `assets/crqa/${videoID}_crqa_data.json`;

                const crqaData = await this.loadJSON(dataPath);

                if (!crqaData) {
                    this.showError("No cross-RQA output for this recording. `include_cRQA` is set in "
                        + "config.json, so the analysis was expected: run "
                        + "`python build_assets.py` in the study folder to produce it.");
                    return;
                }

                const stale = window.DIMS.payloadProblem(crqaData, 'cross-RQA output');
                if (stale) { this.showError(stale); return; }

                if (!crqaData.crqa_data || Object.keys(crqaData.crqa_data).length === 0) {
                    this.showError('Cross-RQA data is empty or invalid format.');
                    console.error('Invalid cross-RQA data structure:', crqaData);
                    return;
                }

                this.crqaData = crqaData;
                this.displayCRQAPlots();

            } catch (error) {
                console.error('Error loading cross-RQA data:', error);
                this.showError(`Failed to load cross-RQA data: ${error.message}`);
            }
        },

        displayCRQAPlots() {
            const container = document.getElementById('crqaContainer');
            if (!container || !this.crqaData) {
                console.error('Cross-RQA container or data missing');
                return;
            }

            container.innerHTML = '<h2 style="margin-bottom: 20px;">Cross-Recurrence Quantification Analysis</h2>';

            const plotConfigs = [];
            Object.entries(this.crqaData.crqa_data).forEach(([pairKey, pairData], index) => {
                // Per-pair block: full recurrence plot + windowed metrics chart.
                const block = document.createElement('div');
                block.style.marginBottom = '40px';

                const heading = document.createElement('h3');
                // The theme's own token, not a literal. `white` was invisible
                // against the default light theme's white panel -- which is the
                // failure the rule in docs/contracts/tab.md exists to prevent,
                // and which the comment a few lines below already states for
                // the pane background.
                heading.style.color = 'var(--text)';
                const names = pairData.series_names || pairKey.split('_vs_');
                heading.innerHTML = `${names[0]} &harr; ${names[1]} ` +
                    `<span style="color:var(--muted);font-size:0.8em;">` +
                    `(Global RR: ${(pairData.global_recurrence_rate * 100).toFixed(2)}%, ` +
                    `Threshold: ${pairData.threshold.toFixed(4)})</span>`;
                block.appendChild(heading);

                const rpDiv = document.createElement('div');
                rpDiv.id = `crqa-plot-${index}`;
                // .plot-pane, not an inline background: an inline one is written
                // once and keeps the colour of whichever theme was active then.
                rpDiv.classList.add('plot-pane');
                rpDiv.style.padding = '10px';
                rpDiv.style.borderRadius = '5px';
                block.appendChild(rpDiv);
                container.appendChild(block);

                plotConfigs.push({ rpId: rpDiv.id, pairKey, pairData });
            });

            setTimeout(() => {
                plotConfigs.forEach(cfg => {
                    try {
                        this.createCRQAPlot(cfg.rpId, cfg.pairData);
                    } catch (error) {
                        console.error(`Error creating cRQA plot for ${cfg.pairKey}:`, error);
                        const el = document.getElementById(cfg.rpId);
                        if (el) el.innerHTML = `<div style="color: red; padding: 20px;">Error creating plot: ${error.message}</div>`;
                    }
                });
                this.showTabStatus();
            }, 100);
        },

        updateCRQAHighlights() {
            // Re-render the recurrence plots and metric charts with the current window.
            if (!this.crqaData || !this.crqaData.crqa_data) return;
            Object.entries(this.crqaData.crqa_data).forEach(([pairKey, pairData], index) => {
                if (document.getElementById(`crqa-plot-${index}`)) {
                    this.createCRQAPlot(`crqa-plot-${index}`, pairData);
                }
            });
        },

        createCRQAPlot(containerId, pairData) {
            if (!window.Plotly) {
                throw new Error('Plotly library not loaded.');
            }
            const vis = pairData.visualization;
            if (!vis || !vis.time || !vis.matrix_size || !vis.matrix
                || !vis.data_x || !vis.data_y) {
                throw new Error('Missing required cRQA visualization fields');
            }
            const names = pairData.series_names || ['series 1', 'series 2'];

            // Common (uniform) time axis shared by both series.
            const time = vis.time;

            // The complete recurrence plot, one bit per cell. Decoded once
            // rather than rebuilt from index pairs by hand, then transposed.
            //
            // The transpose is the whole orientation of this figure. The
            // analysis builds the matrix as cdist(series 1, series 2), so its
            // ROWS index series 1; Plotly places z[row][col] at (x[col],
            // y[row]), which would put series 1 on the y-axis. The labels and
            // both marginals here say the opposite -- x is series 1 -- and so
            // do docs/analyses/crqa.md and the figures on the docs site.
            //
            // Drawn untransposed, the picture was the transpose of what it
            // claimed to be, and an off-diagonal band therefore named the wrong
            // measure as leading. Reading a lag off this tab gave the direction
            // backwards. Transposing here rather than in the analysis keeps
            // every committed payload valid: nothing written changes, and a
            // study renders correctly without being rebuilt.
            const decoded = window.DIMS.decodeArray(vis.matrix);
            const matrix = decoded[0].map((_, col) => decoded.map(row => row[col]));

            // One color per series, matched to the main timeseries colors where possible
            // (same HSL scheme as plotTimeseries / createRQAPlot), with sane fallbacks.
            const colorFor = (name) => {
                if (this.currentData) {
                    const i = this.currentData.findIndex(d => d.name === name);
                    if (i !== -1) return `hsl(${i * 360 / this.currentData.length}, 70%, 50%)`;
                }
                return null;
            };
            const colorX = colorFor(names[0]) || '#e15759';
            const colorY = colorFor(names[1]) || '#4e79a7';

            // One figure: cross-recurrence matrix with series 1 as the top marginal,
            // series 2 as the rotated left marginal, and the windowed metric strips
            // below — all sharing the time x-axis.
            this._renderRecurrenceFigure(containerId, {
                titleText: `Cross-Recurrence Plot<br><sub>${names[0]} ↔ ${names[1]} — Global RR: ${(pairData.global_recurrence_rate * 100).toFixed(2)}%, Threshold: ${pairData.threshold.toFixed(4)}</sub>`,
                time, matrix,
                topSeries: { values: vis.data_x, color: colorX },
                leftSeries: { values: vis.data_y, color: colorY },
                xTitle: `${names[0]} time (s)`, yTitle: `${names[1]} time (s)`,
                wm: pairData.windowed_metrics
            }, () => this.updateCRQAHighlights());
        }
    });

    window.DIMS.registerTab({
        id: 'crqa',
        label: 'Cross-RQA',
        status: 'Click on any plot to select a time point.',
        order: 40,
        gate: cfg => Array.isArray(cfg.include_cRQA) && cfg.include_cRQA.length > 0,
        async onActivate(app, container) {
        if (app.currentVideoID && !app.crqaData) await app.loadCRQAData(app.currentVideoID);
        else if (app.crqaData) app.displayCRQAPlots();
        },
        onTimeUpdate(app) {
        if (app.crqaData) app.updateCRQAHighlights();
        },
        onVideoChange(app) {
            app.crqaData = null;
        },
    });
})();
