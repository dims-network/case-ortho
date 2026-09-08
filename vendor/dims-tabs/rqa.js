// RQA Plots tab.
//
// Recurrence quantification: a recurrence plot per data type, with windowed
// RR / DET / LAM / L_MAX beneath it.
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
        async loadRQAData(videoID) {
            this.showStatus('Loading RQA data...');
            
            try {
                // Load RQA data
                const dataPath = `assets/rqa/${videoID}_rqa_data.json`;
                console.log('Loading RQA data from:', dataPath);
                
                const rqaData = await this.loadJSON(dataPath);
                
                if (!rqaData) {
                    this.showError('RQA data not found. Run the Python RQA script first.');
                    return;
                }
                
                console.log('RQA data loaded:', rqaData);
                
                // Validate data structure
                if (!rqaData.rqa_data || Object.keys(rqaData.rqa_data).length === 0) {
                    this.showError('RQA data is empty or invalid format.');
                    console.error('Invalid RQA data structure:', rqaData);
                    return;
                }
                
                // Check if data types match config
                const configDataTypes = this.config.include_RQA || [];
                const rqaDataTypes = Object.keys(rqaData.rqa_data);
                console.log('Config data types:', configDataTypes);
                console.log('RQA data types:', rqaDataTypes);
                
                // Warn about mismatches
                const missingInRQA = configDataTypes.filter(dt => !rqaDataTypes.includes(dt));
                if (missingInRQA.length > 0) {
                    console.warn('Data types in config but not in RQA data:', missingInRQA);
                }
                
                this.rqaData = rqaData;
                this.displayRQAPlots();
                
            } catch (error) {
                console.error('Error loading RQA data:', error);
                this.showError(`Failed to load RQA data: ${error.message}`);
            }
        },

        displayRQAPlots() {
            const container = document.getElementById('rqaContainer');
            if (!container) {
                console.error('RQA container element not found!');
                return;
            }
            
            if (!this.rqaData) {
                console.error('No RQA data to display');
                return;
            }
            
            console.log('Displaying RQA plots for:', this.rqaData);
            
            container.innerHTML = '<h2 style="color: white; margin-bottom: 20px;">Recurrence Quantification Analysis</h2>';

            // One vertical block per data type: a single figure with the recurrence
            // plot and its windowed metric strips (RR / DET / LAM / L_MAX) below it.
            const plotConfigs = [];
            Object.entries(this.rqaData.rqa_data).forEach(([dataType, plotData], index) => {
                const block = document.createElement('div');
                block.style.marginBottom = '40px';

                const plotDiv = document.createElement('div');
                plotDiv.id = `rqa-plot-${index}`;
                plotDiv.style.backgroundColor = window.DIMS.theme().paper;
                plotDiv.style.padding = '10px';
                plotDiv.style.borderRadius = '5px';
                block.appendChild(plotDiv);
                container.appendChild(block);

                plotConfigs.push({ containerId: plotDiv.id, dataType, plotData });
            });

            // Now create all plots after DOM is updated
            setTimeout(() => {
                plotConfigs.forEach(config => {
                    try {
                        this.createRQAPlot(config.containerId, config.dataType, config.plotData);
                    } catch (error) {
                        console.error(`Error creating RQA plot for ${config.dataType}:`, error);
                        const plotDiv = document.getElementById(config.containerId);
                        if (plotDiv) {
                            plotDiv.innerHTML = `<div style="color: red; padding: 20px;">Error creating plot: ${error.message}</div>`;
                        }
                    }
                });

                this.showStatus('RQA plots loaded. Click on any plot to select a time point.');
            }, 100); // Give DOM time to update
        },

        createRQAPlot(containerId, dataType, plotData) {
            const vis = plotData && plotData.visualization;
            if (!vis || !vis.time || !vis.data || !vis.matrix_size || !vis.matrix) {
                throw new Error('Missing required visualization fields');
            }

            // Per-dataType color, matching the main timeseries (same HSL scheme).
            let dataColor = '#4e79a7';
            if (this.currentData) {
                const i = this.currentData.findIndex(d => d.name === dataType);
                if (i !== -1) dataColor = `hsl(${i * 360 / this.currentData.length}, 70%, 50%)`;
            }

            // Sort time/data together to prevent wrapping.
            const pairs = vis.time.map((t, i) => ({ t, d: vis.data[i] })).sort((a, b) => a.t - b.t);
            const time = pairs.map(p => p.t);
            const data = pairs.map(p => p.d);

            // One decode instead of rebuilding a dense matrix from index pairs
            // by hand -- Plotly wants dense, and the payload now ships dense.
            const matrix = window.DIMS.decodeArray(vis.matrix);

            this._renderRecurrenceFigure(containerId, {
                titleText: `${dataType}<br><sub>Recurrence Rate: ${(plotData.recurrence_rate * 100).toFixed(2)}%, Threshold: ${plotData.threshold.toFixed(4)}</sub>`,
                time, matrix,
                topSeries: { values: data, color: dataColor },
                leftSeries: { values: data, color: dataColor },
                xTitle: 'Time (s)', yTitle: 'Time (s)',
                wm: plotData.windowed_metrics
            }, () => this.updateRQAHighlights());
        },

        updateRQAHighlights() {
            // Re-render all RQA figures (recurrence plot + metrics) with the window.
            if (this.rqaData && this.rqaData.rqa_data) {
                Object.entries(this.rqaData.rqa_data).forEach(([dataType, plotData], index) => {
                    if (document.getElementById(`rqa-plot-${index}`)) {
                        this.createRQAPlot(`rqa-plot-${index}`, dataType, plotData);
                    }
                });
            }
        }
    });

    window.DIMS.registerTab({
        id: 'rqa',
        label: 'RQA Plots',
        order: 20,
        gate: cfg => Array.isArray(cfg.include_RQA) && cfg.include_RQA.length > 0,
        async onActivate(app, container) {
        if (app.currentVideoID && !app.rqaData) await app.loadRQAData(app.currentVideoID);
        else if (app.rqaData) app.displayRQAPlots();
        },
        onTimeUpdate(app) {
        if (app.rqaData) app.updateRQAHighlights();
        },
        onVideoChange(app) {
            app.rqaData = null;
        },
    });
})();
