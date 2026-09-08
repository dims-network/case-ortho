// Cross-Wavelet tab.
//
// Cross-wavelet power and coherence for pairs of measures.
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
        async loadCrossWaveletData(videoID) {
            this.showStatus('Loading cross-wavelet data...');
            
            try {
                const dataPath = `assets/crosswavelet/${videoID}_crosswavelet_data.json`;
                console.log('Loading cross-wavelet data from:', dataPath);
                
                const cwData = await this.loadJSON(dataPath);
                
                if (!cwData) {
                    this.showError('Cross-wavelet data not found. Run the Python cross-wavelet script first.');
                    return;
                }
                
                console.log('Cross-wavelet data loaded:', cwData);
                
                // Validate data structure
                if (!cwData.crosswavelet_pairs || Object.keys(cwData.crosswavelet_pairs).length === 0) {
                    this.showError('Cross-wavelet data is empty or invalid format.');
                    console.error('Invalid cross-wavelet data structure:', cwData);
                    return;
                }
                
                this.crossWaveletData = cwData;
                this.displayCrossWaveletPlots();
                
            } catch (error) {
                console.error('Error loading cross-wavelet data:', error);
                this.showError(`Failed to load cross-wavelet data: ${error.message}`);
            }
        },

        displayCrossWaveletPlots() {
            const container = document.getElementById('crossWaveletContainer');
            if (!container) {
                console.error('Cross-wavelet container element not found!');
                return;
            }
            
            if (!this.crossWaveletData) {
                console.error('No cross-wavelet data to display');
                return;
            }
            
            console.log('Displaying cross-wavelet plots for:', this.crossWaveletData);
            
            container.innerHTML = '<h2 style="color: white; margin-bottom: 20px;">Cross-Wavelet Coherence Analysis</h2>';
            
            // Create grid for cross-wavelet plots
            const grid = document.createElement('div');
            grid.style.display = 'grid';
            grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(600px, 1fr))';
            grid.style.gap = '20px';
            
            // Create all plot containers first
            const plotConfigs = [];
            Object.entries(this.crossWaveletData.crosswavelet_pairs).forEach(([pairKey, pairData], index) => {
                console.log(`Creating cross-wavelet plot container ${index} for ${pairKey}`);
                
                const plotDiv = document.createElement('div');
                plotDiv.id = `cw-plot-${index}`;
                plotDiv.style.height = '800px'; // Increased for 4-panel layout
                plotDiv.style.backgroundColor = window.DIMS.theme().paper;
                plotDiv.style.padding = '10px';
                plotDiv.style.borderRadius = '5px';
                
                grid.appendChild(plotDiv);
                
                // Store config for later plotting
                plotConfigs.push({
                    containerId: plotDiv.id,
                    pairKey: pairKey,
                    pairData: pairData
                });
            });
            
            // Add grid to container
            container.appendChild(grid);
            
            // Now create all plots after DOM is updated
            setTimeout(() => {
                plotConfigs.forEach(config => {
                    try {
                        console.log(`Creating cross-wavelet plot for ${config.pairKey} in ${config.containerId}`);
                        this.createCrossWaveletPlot(config.containerId, config.pairKey, config.pairData);
                    } catch (error) {
                        console.error(`Error creating cross-wavelet plot for ${config.pairKey}:`, error);
                        const plotDiv = document.getElementById(config.containerId);
                        if (plotDiv) {
                            plotDiv.innerHTML = `<div style="color: red; padding: 20px;">Error creating plot: ${error.message}</div>`;
                        }
                    }
                });
                
                this.showStatus('Cross-wavelet plots loaded. Click on any plot to select a time point.');
            }, 100);
        },

        // What the Monte Carlo coherence null cost, and what it says -- or, when
        // it was not run, that it was not run and how to get it.
        //
        // This is the visible half of a rule the analysis already follows: the
        // null is computed when something in the study reads it, and skipped
        // otherwise. Skipping it is the right default -- it is hours of compute
        // for ORTHO -- but a tab that quietly draws nothing turns a deliberate
        // choice into a missing feature, and that is how a study ends up paying
        // for a number nobody ever sees.
        chanceLevelNote(pairData) {
            const stats = pairData.statistics || {};
            const provenance = (this.crossWaveletData || {}).provenance || {};
            const fraction = stats.wtc_signif_fraction;

            if (fraction === null || fraction === undefined) {
                return 'Coherence chance level: not computed for this output. '
                     + 'Set analysis.crosswavelet.mcCount in config.json and rebuild.';
            }
            const surrogates = provenance.mc_count;
            const median = stats.wtc_signif_level_median;
            const level = (typeof median === 'number')
                ? `, median level ${median.toFixed(3)}` : '';
            const count = (typeof surrogates === 'number')
                ? `${surrogates} surrogates` : 'a Monte Carlo null';
            return `Coherence above chance (outside the cone): `
                 + `${(fraction * 100).toFixed(1)}% of cells `
                 + `(${count}${level})`;
        },

        createCrossWaveletPlot(containerId, pairKey, pairData) {
            // Check if Plotly is loaded
            if (!window.Plotly) {
                throw new Error('Plotly library not loaded. Make sure to include Plotly in your HTML.');
            }
            
            // Verify container exists
            const container = document.getElementById(containerId);
            if (!container) {
                throw new Error(`Container ${containerId} not found in DOM`);
            }
            
            // Validate plot data
            if (!pairData.visualization) {
                throw new Error('Missing visualization data');
            }
            
            const vis = pairData.visualization;
            const stats = pairData.statistics;
            
            // Validate required fields
            if (!vis.time || !vis.power || !vis.period) {
                throw new Error('Missing required visualization fields (need power for cross-wavelet)');
            }

            // The three large grids travel base64-encoded; decode once here and
            // use these below rather than vis.* directly.
            const power = window.DIMS.decodeArray(vis.power);
            const phase = window.DIMS.decodeArray(vis.phase);
            const coherence = vis.coherence ? window.DIMS.decodeArray(vis.coherence) : null;

            // How far each cell's joint power exceeds its own 95 % level. The
            // payload stores the level per scale and the power per cell; the
            // ratio used to be stored as a third full grid, which held nothing
            // these two do not. A cell is significant where this exceeds 1.
            const level = vis.signif_xwt || [];
            const sig95 = power.map((row, i) => {
                const l = level[i];
                return (l === null || l === undefined || !(l > 0))
                    ? row.map(() => null)
                    : row.map(v => (v === null || v === undefined ? null : v / l));
            });
            
            console.log(`Creating cross-wavelet plot for ${pairKey}`);
            
            // Extract data type names
            const dataType1 = pairData.data_type1;
            const dataType2 = pairData.data_type2;
            
            // Get colors for the two data types
            let color1 = 'rgb(31, 119, 180)';
            let color2 = 'rgb(255, 127, 14)';
            if (this.currentData) {
                const idx1 = this.currentData.findIndex(d => d.name === dataType1);
                const idx2 = this.currentData.findIndex(d => d.name === dataType2);
                if (idx1 !== -1) color1 = `hsl(${idx1 * 360 / this.currentData.length}, 70%, 50%)`;
                if (idx2 !== -1) color2 = `hsl(${idx2 * 360 / this.currentData.length}, 70%, 50%)`;
            }
            
            // Get the actual time series data for the two data types
            let timeSeries1 = null;
            let timeSeries2 = null;
            if (this.currentData) {
                const data1 = this.currentData.find(d => d.name === dataType1);
                const data2 = this.currentData.find(d => d.name === dataType2);
                if (data1 && data1.data) timeSeries1 = data1.data;
                if (data2 && data2.data) timeSeries2 = data2.data;
            }
            
            // Create traces array
            const traces = [];
            
            // ========== PANEL A: Original time series (top) ==========
            if (timeSeries1) {
                const sortedData1 = [...timeSeries1].sort((a, b) => a.Time - b.Time);
                const columns1 = Object.keys(sortedData1[0]).filter(col => col !== 'Time');
                
                let yData1;
                if (columns1.length > 1) {
                    yData1 = sortedData1.map(row => {
                        const values = columns1.map(col => row[col]).filter(v => v !== null && v !== undefined);
                        return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
                    });
                } else if (columns1.length === 1) {
                    yData1 = sortedData1.map(d => d[columns1[0]]);
                }
                
                if (yData1) {
                    // Normalize for display
                    const mean1 = yData1.reduce((a, b) => a + b, 0) / yData1.length;
                    const std1 = Math.sqrt(yData1.reduce((a, b) => a + Math.pow(b - mean1, 2), 0) / yData1.length);
                    const normalized1 = yData1.map(v => (v - mean1) / std1);
                    
                    traces.push({
                        x: sortedData1.map(d => d.Time),
                        y: normalized1,
                        type: 'scatter',
                        mode: 'lines',
                        line: { color: color1, width: 1.5 },
                        name: dataType1,
                        xaxis: 'x4',
                        yaxis: 'y4',
                        hovertemplate: `${dataType1}<br>Time: %{x:.1f}s<br>Normalized: %{y:.3f}<extra></extra>`
                    });
                }
            }
            
            if (timeSeries2) {
                const sortedData2 = [...timeSeries2].sort((a, b) => a.Time - b.Time);
                const columns2 = Object.keys(sortedData2[0]).filter(col => col !== 'Time');
                
                let yData2;
                if (columns2.length > 1) {
                    yData2 = sortedData2.map(row => {
                        const values = columns2.map(col => row[col]).filter(v => v !== null && v !== undefined);
                        return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
                    });
                } else if (columns2.length === 1) {
                    yData2 = sortedData2.map(d => d[columns2[0]]);
                }
                
                if (yData2) {
                    // Normalize for display
                    const mean2 = yData2.reduce((a, b) => a + b, 0) / yData2.length;
                    const std2 = Math.sqrt(yData2.reduce((a, b) => a + Math.pow(b - mean2, 2), 0) / yData2.length);
                    const normalized2 = yData2.map(v => (v - mean2) / std2);
                    
                    traces.push({
                        x: sortedData2.map(d => d.Time),
                        y: normalized2,
                        type: 'scatter',
                        mode: 'lines',
                        line: { color: color2, width: 1.5 },
                        name: dataType2,
                        xaxis: 'x4',
                        yaxis: 'y4',
                        hovertemplate: `${dataType2}<br>Time: %{x:.1f}s<br>Normalized: %{y:.3f}<extra></extra>`
                    });
                }
            }
            
            // Calculate log2 of periods for proper display
            const log2Period = vis.period.map(p => Math.log2(p));
            
            // ========== PANEL B: Cross-wavelet power spectrum (middle-left) ==========
            traces.push({
                x: vis.time,
                y: log2Period,
                z: power,
                type: 'heatmap',
                colorscale: 'Viridis',
                colorbar: {
                    title: 'Power',
                    titleside: 'right',
                    x: 0.72,
                    y: 0.55,
                    yanchor: 'middle',
                    len: 0.34,
                    lenmode: 'fraction'
                },
                xaxis: 'x',
                yaxis: 'y',
                hovertemplate: 'Time: %{x:.1f}s<br>Period: %{customdata:.2f}s<br>Power: %{z:.4f}<extra></extra>',
                customdata: vis.period
            });
            
            // Add significance contour (95% confidence level)
            if (sig95.length > 0) {
                traces.push({
                    x: vis.time,
                    y: log2Period,
                    z: sig95,
                    type: 'contour',
                    contours: {
                        start: 0.95,
                        end: 1.5,
                        size: 0.5,
                        coloring: 'none'
                    },
                    line: { color: 'black', width: 2 },
                    showscale: false,
                    xaxis: 'x',
                    yaxis: 'y',
                    name: '95% Confidence',
                    hoverinfo: 'skip'
                });
            }

            // ========== ADD PHASE ARROWS ==========
            // Subsample the phase data for clearer visualization
            const arrowSkipTime = Math.max(1, Math.floor(vis.time.length / 20)); // ~20 arrows in time
            const arrowSkipFreq = Math.max(1, Math.floor(log2Period.length / 12)); // ~12 arrows in frequency

            // Build arrays for arrow plot
            const arrowData = {
                x: [],
                y: [],
                text: [],
                mode: 'markers+text',
                type: 'scatter',
                marker: {
                    size: 0.1,
                    color: 'rgba(0,0,0,0)'
                },
                text: [],
                textfont: {
                    family: 'Arial',
                    size: 16,
                    color: window.DIMS.theme().font
                },
                textposition: 'middle center',
                xaxis: 'x',
                yaxis: 'y',
                hovertemplate: '%{customdata}<extra></extra>',
                customdata: [],
                showlegend: false
            };

            // Only show arrows within the 95% confidence ridges
            for (let i = 0; i < phase.length; i += arrowSkipFreq) {
                for (let j = 0; j < phase[i].length; j += arrowSkipTime) {
                    // Check if this point is within 95% significance ridge
                    const isSignificant = sig95[i] && sig95[i][j] > 1.0;
                    
                    if (isSignificant) { // Only show arrows within 95% confidence ridges
                        const coherenceAt = coherence ? coherence[i][j] : 0;
                        const phaseAt = phase[i][j];

                        // A cell can be null: where neither signal has power in
                        // this band there is no phase relationship to draw. Skip
                        // it rather than computing an arrow from NaN.
                        if (phaseAt === null || phaseAt === undefined || Number.isNaN(phaseAt)) continue;
                        if (coherenceAt === null || coherenceAt === undefined) continue;
                        
                        // Convert phase to arrow symbol
                        // Phase is in radians: 0 = in phase, π/2 = signal1 leads, π = anti-phase, -π/2 = signal2 leads
                        let arrow;
                        const phaseDeg = (phaseAt * 180 / Math.PI + 360) % 360;
                        
                        // Map phase to arrow direction (8 directions)
                        if (phaseDeg >= 337.5 || phaseDeg < 22.5) {
                            arrow = '→';  // In phase
                        } else if (phaseDeg >= 22.5 && phaseDeg < 67.5) {
                            arrow = '↗';  // Signal 1 leads slightly
                        } else if (phaseDeg >= 67.5 && phaseDeg < 112.5) {
                            arrow = '↑';  // Signal 1 leads by 90°
                        } else if (phaseDeg >= 112.5 && phaseDeg < 157.5) {
                            arrow = '↖';  // Signal 1 leads, approaching anti-phase
                        } else if (phaseDeg >= 157.5 && phaseDeg < 202.5) {
                            arrow = '←';  // Anti-phase
                        } else if (phaseDeg >= 202.5 && phaseDeg < 247.5) {
                            arrow = '↙';  // Signal 2 leads, approaching anti-phase
                        } else if (phaseDeg >= 247.5 && phaseDeg < 292.5) {
                            arrow = '↓';  // Signal 2 leads by 90°
                        } else {
                            arrow = '↘';  // Signal 2 leads slightly
                        }
                        
                        // Interpret phase relationship
                        let relationship;
                        if (phaseDeg < 45 || phaseDeg >= 315) {
                            relationship = `${dataType1} & ${dataType2} in phase`;
                        } else if (phaseDeg >= 45 && phaseDeg < 135) {
                            relationship = `${dataType1} leads ${dataType2}`;
                        } else if (phaseDeg >= 135 && phaseDeg < 225) {
                            relationship = `${dataType1} & ${dataType2} anti-phase`;
                        } else {
                            relationship = `${dataType2} leads ${dataType1}`;
                        }
                        
                        arrowData.x.push(vis.time[j]);
                        arrowData.y.push(log2Period[i]);
                        arrowData.text.push(arrow);
                        arrowData.customdata.push(
                            `Time: ${vis.time[j].toFixed(1)}s | ` +
                            `Period: ${vis.period[i].toFixed(2)}s<br>` +
                            `Phase: ${phaseDeg.toFixed(0)}°<br>` +
                            `Power: ${power[i][j].toFixed(4)}<br>`
                        );
                    }
                }
            }

// Add arrow trace if we have any arrows
if (arrowData.x.length > 0) {
        traces.push(arrowData);
}
            
            // Add Cone of Influence (COI) as filled area
            if (vis.coi && vis.coi.length > 0) {
                const coiLog2 = vis.coi.map(c => Math.log2(Math.max(c, vis.period[0])));
                const maxLog2Period = Math.max(...log2Period);
                
                // Create COI boundary
                const coiX = [...vis.time, vis.time[vis.time.length - 1], vis.time[0]];
                const coiY = [...coiLog2, maxLog2Period, maxLog2Period];
                
                traces.push({
                    x: coiX,
                    y: coiY,
                    type: 'scatter',
                    mode: 'none',
                    fill: 'toself',
                    fillcolor: 'rgba(0, 0, 0, 0.08)',
                    line: { width: 0 },
                    xaxis: 'x',
                    yaxis: 'y',
                    name: 'COI',
                    hoverinfo: 'skip',
                    showlegend: false
                });
                
                // Add COI boundary line
                traces.push({
                    x: vis.time,
                    y: coiLog2,
                    type: 'scatter',
                    mode: 'lines',
                    line: { color: window.DIMS.theme().trace, width: 2, dash: 'dash' },
                    xaxis: 'x',
                    yaxis: 'y',
                    name: 'COI',
                    hovertemplate: 'Time: %{x:.1f}s<br>COI Period: %{customdata:.2f}s<extra></extra>',
                    customdata: vis.coi,
                    showlegend: false
                });
            }
            
            // ========== PANEL C: Global cross-wavelet spectrum (middle-right) ==========
            if (stats.global_power && stats.global_power.length > 0) {
                traces.push({
                    x: stats.global_power,
                    y: log2Period,
                    type: 'scatter',
                    mode: 'lines',
                    line: { color: window.DIMS.theme().trace, width: 2 },
                    name: 'Global XWT Power',
                    xaxis: 'x2',
                    yaxis: 'y2',
                    hovertemplate: 'Power: %{x:.4f}<br>Period: %{customdata:.2f}s<extra></extra> ',
                    customdata: vis.period,
                    showlegend: false
                });
            }

            // The 95% level for that spectrum, beside it. It is computed for
            // every study and, until this drew it, read by nothing -- which is
            // how it went three releases applying a single-spectrum chi-square
            // to a cross-wavelet quantity without anyone noticing. A number
            // nobody looks at is a number nobody checks.
            if (stats.global_signif && stats.global_signif.length > 0) {
                traces.push({
                    x: stats.global_signif,
                    y: log2Period,
                    type: 'scatter',
                    mode: 'lines',
                    line: { color: window.DIMS.theme().trace, width: 1, dash: 'dash' },
                    name: '95% level',
                    xaxis: 'x2',
                    yaxis: 'y2',
                    hovertemplate: '95% level: %{x:.4f}<br>Period: %{customdata:.2f}s<extra></extra> ',
                    customdata: vis.period,
                    showlegend: false
                });
            }

            // ========== PANEL D: Scale-averaged cross-wavelet power (bottom) ==========
            if (vis.scale_avg_power && vis.scale_avg_power.length > 0) {
                traces.push({
                    x: vis.time,
                    y: vis.scale_avg_power,
                    type: 'scatter',
                    mode: 'lines',
                    line: { color: window.DIMS.theme().trace, width: 2 },
                    name: 'Scale-Avg XWT Power',
                    xaxis: 'x3',
                    yaxis: 'y3',
                    hovertemplate: 'Time: %{x:.1f}s<br>Power: %{y:.4f}<extra></extra>',
                    showlegend: false
                });

                // Its own 95% level: one number, so a flat line.
                if (typeof stats.scale_avg_signif === 'number'
                        && stats.scale_avg_signif > 0) {
                    traces.push({
                        x: [vis.time[0], vis.time[vis.time.length - 1]],
                        y: [stats.scale_avg_signif, stats.scale_avg_signif],
                        type: 'scatter',
                        mode: 'lines',
                        line: { color: window.DIMS.theme().trace, width: 1, dash: 'dash' },
                        name: '95% level',
                        xaxis: 'x3',
                        yaxis: 'y3',
                        hovertemplate: '95% level: %{y:.4f}<extra></extra>',
                        showlegend: false
                    });
                }
            }
            
            // Create period tick labels (powers of 2)
            const minPeriod = Math.min(...vis.period);
            const maxPeriod = Math.max(...vis.period);
            const minLog2 = Math.ceil(Math.log2(minPeriod));
            const maxLog2 = Math.floor(Math.log2(maxPeriod));
            const periodTicks = [];
            const periodTickLabels = [];
            for (let i = minLog2; i <= maxLog2; i++) {
                periodTicks.push(i);
                const periodVal = Math.pow(2, i);
                periodTickLabels.push(periodVal < 1 ? periodVal.toFixed(1) : periodVal.toFixed(0));
            }
            
            // Create layout with 4 subplots similar to pycwt
            const layout = {
            title: {
                text: `Cross-Wavelet: ${dataType1} ↔ ${dataType2}<br>` +
                    `<sub>Mean Coherence: ${stats.mean_coherence.toFixed(3)}, Max: ${stats.max_coherence.toFixed(3)}, ` +
                    `AR1: α₁=${pairData.alpha1.toFixed(3)}, α₂=${pairData.alpha2.toFixed(3)}</sub><br>` +
                    `<sub>${this.chanceLevelNote(pairData)}</sub><br>` +
                    `<sub style="font-size: 9px;">Phase arrows (in 95% ridges): ` +
                    `→ in-phase (0°) | ↗ ${dataType1} leads 45° | ↑ ${dataType1} leads 90° | ↖ ${dataType1} leads 135° | ` +
                    `← anti-phase (180°) | ↙ ${dataType2} leads 135° | ↓ ${dataType2} leads 90° | ↘ ${dataType2} leads 45°</sub>`,
                font: { color: window.DIMS.theme().font, size: 14 }
            },
                paper_bgcolor: window.DIMS.theme().paper,
                plot_bgcolor: window.DIMS.theme().plot,
                font: { color: window.DIMS.theme().font, size: 10 },
                showlegend: true,
                legend: {
                    x: 0.75,
                    y: 0.95,
                    bgcolor: 'rgba(0,0,0,0.5)',
                    font: { size: 9 }
                },
                
                // PANEL A: Time series (top)
                xaxis4: {
                    domain: [0.08, 0.70],
                    anchor: 'y4',
                    title: '',
                    showticklabels: false,
                    gridcolor: window.DIMS.theme().grid
                },
                yaxis4: {
                    domain: [0.78, 0.95],
                    anchor: 'x4',
                    title: 'Normalized',
                    titlefont: { size: 10 },
                    gridcolor: window.DIMS.theme().grid
                },
                
                // PANEL B: Cross-wavelet power spectrum (middle-left)
                xaxis: {
                    domain: [0.08, 0.70],
                    anchor: 'y',
                    title: '',
                    showticklabels: false,
                    gridcolor: window.DIMS.theme().grid
                },
                yaxis: {
                    domain: [0.38, 0.72],
                    anchor: 'x',
                    title: 'Period (s)',
                    tickmode: 'array',
                    tickvals: periodTicks,
                    ticktext: periodTickLabels,
                    gridcolor: window.DIMS.theme().grid
                },
                
                // PANEL C: Global spectrum (middle-right)
                xaxis2: {
                    domain: [0.75, 0.95],
                    anchor: 'y2',
                    title: 'Power',
                    titlefont: { size: 10 },
                    gridcolor: window.DIMS.theme().grid
                },
                yaxis2: {
                    domain: [0.38, 0.72],
                    anchor: 'x2',
                    title: '',
                    showticklabels: false,
                    tickmode: 'array',
                    tickvals: periodTicks,
                    ticktext: periodTickLabels,
                    gridcolor: window.DIMS.theme().grid
                },
                
                // PANEL D: Scale-averaged power (bottom)
                xaxis3: {
                    domain: [0.08, 0.70],
                    anchor: 'y3',
                    title: 'Time (s)',
                    gridcolor: window.DIMS.theme().grid
                },
                yaxis3: {
                    domain: [0.05, 0.30],
                    anchor: 'x3',
                    title: {
                        text: `${pairData.scale_avg_band ? pairData.scale_avg_band[0].toFixed(1) + '–' + pairData.scale_avg_band[1].toFixed(1) : '2–8'}s avg`,
                        font: { size: 10 }
                    },
                    gridcolor: window.DIMS.theme().grid
                },
                
                margin: { t: 70, r: 30, b: 50, l: 60 },
                hovermode: 'closest'
            };
            
            // Add highlight shapes if there's a selected time
            if (this.lastClickedPoint !== null) {
                const windowSize = parseInt(document.getElementById('windowSize').value) || 5;
                const minTime = Math.min(...vis.time);
                const maxTime = Math.max(...vis.time);
                const minLog2Period = Math.min(...log2Period);
                const maxLog2Period = Math.max(...log2Period);
                
                const startTime = Math.max(minTime, this.lastClickedPoint - windowSize / 2);
                const endTime = Math.min(maxTime, this.lastClickedPoint + windowSize / 2);
                
                layout.shapes = [
                    // Vertical lines on time series (panel A)
                    {
                        type: 'line',
                        x0: startTime, x1: startTime,
                        y0: 0, y1: 1,
                        line: { color: window.DIMS.theme().highlight, width: 2 },
                        xref: 'x4', yref: 'y4 domain'
                    },
                    {
                        type: 'line',
                        x0: endTime, x1: endTime,
                        y0: 0, y1: 1,
                        line: { color: window.DIMS.theme().highlight, width: 2 },
                        xref: 'x4', yref: 'y4 domain'
                    },
                    // Highlight box on time series
                    {
                        type: 'rect',
                        x0: startTime, x1: endTime,
                        y0: 0, y1: 1,
                        fillcolor: window.DIMS.theme().highlight,
                        opacity: 0.15,
                        line: { width: 0 },
                        xref: 'x4', yref: 'y4 domain'
                    },
                    // Vertical lines on XWT spectrum (panel B)
                    {
                        type: 'line',
                        x0: startTime, x1: startTime,
                        y0: minLog2Period, y1: maxLog2Period,
                        line: { color: window.DIMS.theme().highlight, width: 2 },
                        xref: 'x', yref: 'y'
                    },
                    {
                        type: 'line',
                        x0: endTime, x1: endTime,
                        y0: minLog2Period, y1: maxLog2Period,
                        line: { color: window.DIMS.theme().highlight, width: 2 },
                        xref: 'x', yref: 'y'
                    },
                    // Highlight box on XWT spectrum
                    {
                        type: 'rect',
                        x0: startTime, x1: endTime,
                        y0: minLog2Period, y1: maxLog2Period,
                        fillcolor: window.DIMS.theme().highlight,
                        opacity: 0.15,
                        line: { width: 0 },
                        xref: 'x', yref: 'y'
                    },
                    // Vertical lines on scale-averaged plot (panel D)
                    {
                        type: 'line',
                        x0: startTime, x1: startTime,
                        y0: 0, y1: 1,
                        line: { color: window.DIMS.theme().highlight, width: 2 },
                        xref: 'x3', yref: 'y3 domain'
                    },
                    {
                        type: 'line',
                        x0: endTime, x1: endTime,
                        y0: 0, y1: 1,
                        line: { color: window.DIMS.theme().highlight, width: 2 },
                        xref: 'x3', yref: 'y3 domain'
                    },
                    // Highlight box on scale-averaged plot
                    {
                        type: 'rect',
                        x0: startTime, x1: endTime,
                        y0: 0, y1: 1,
                        fillcolor: window.DIMS.theme().highlight,
                        opacity: 0.15,
                        line: { width: 0 },
                        xref: 'x3', yref: 'y3 domain'
                    }
                ];
            }
            
            console.log(`Calling Plotly.newPlot for ${containerId}`);
            Plotly.newPlot(containerId, traces, layout, { responsive: true });
            
            // Add click handler
            document.getElementById(containerId).on('plotly_click', (data) => {
                if (data.points && data.points.length > 0) {
                    const point = data.points[0];
                    
                    // Get clicked time (works for all three time-based panels)
                    const clickedTime = point.x;
                    console.log(`Cross-wavelet clicked at time: ${clickedTime.toFixed(2)}s`);
                    
                    // Update video and timeseries
                    this.handleTimeClick(clickedTime);
                    
                    // Update all cross-wavelet plots to show highlight
                    setTimeout(() => this.updateCrossWaveletHighlights(), 100);
                }
            });
        },

        updateCrossWaveletHighlights() {
            // Re-render all cross-wavelet plots with updated highlights
            if (this.crossWaveletData && this.crossWaveletData.crosswavelet_pairs) {
                Object.entries(this.crossWaveletData.crosswavelet_pairs).forEach(([pairKey, pairData], index) => {
                    const containerId = `cw-plot-${index}`;
                    if (document.getElementById(containerId)) {
                        this.createCrossWaveletPlot(containerId, pairKey, pairData);
                    }
                });
            }
        }
    });

    window.DIMS.registerTab({
        id: 'crosswavelet',
        label: 'Cross-Wavelet',
        order: 30,
        containerId: 'crossWaveletContainer',   // kept: other code and tests use this id
        gate: cfg => {
            // The two config forms gate differently: explicit pairs [[a,b]] are
            // valid with a single entry, while the legacy flat list [a,b,c]
            // needs two data types before a pair exists at all.
            const v = cfg.include_crosswavelet;
            return Array.isArray(v) && v.length > 0 && (Array.isArray(v[0]) || v.length >= 2);
        },
        async onActivate(app, container) {
        if (app.currentVideoID && !app.crossWaveletData) await app.loadCrossWaveletData(app.currentVideoID);
        else if (app.crossWaveletData) app.displayCrossWaveletPlots();
        },
        onTimeUpdate(app) {
        if (app.crossWaveletData) app.updateCrossWaveletHighlights();
        },
        onVideoChange(app) {
            app.crossWaveletData = null;
        },
    });
})();
