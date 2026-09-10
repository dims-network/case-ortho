// Cross-wavelet analysis tab.
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
                
                const cwData = await this.loadJSON(dataPath);
                
                if (!cwData) {
                    this.showError("No cross-wavelet output for this recording. `include_crosswavelet` is "
                        + "set in config.json, so the analysis was expected: run "
                        + "`python build_assets.py` in the study folder to produce it.");
                    return;
                }
                
                
                // Validate data structure
                const stale = window.DIMS.payloadProblem(cwData, 'cross-wavelet output');
                if (stale) { this.showError(stale); return; }

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
            
            
            container.innerHTML = '';

            // The figure carries three dashed lines and names none of them:
            // they are drawn in the body text colour at width 1, beside solid
            // curves in the same colour at width 2, with showlegend off. The
            // (i) is the network tab's, so the two tabs explain themselves the
            // same way.
            const titleRow = document.createElement('div');
            titleRow.style.cssText =
                'display:flex;align-items:center;gap:10px;margin-bottom:8px;';
            const heading = document.createElement('h2');
            heading.style.margin = '0';
            heading.textContent = 'Cross-wavelet analysis';
            const info = document.createElement('button');
            info.type = 'button';
            info.id = 'cwInfoToggle';
            info.textContent = 'i';
            info.style.cssText =
                'width:24px;height:24px;border-radius:50%;cursor:pointer;line-height:1;';
            info.setAttribute('aria-label', 'What this figure shows');
            titleRow.append(heading, info);
            container.appendChild(titleRow);

            const help = document.createElement('div');
            help.id = 'cwHelp';
            help.style.cssText =
                'opacity:.8;margin:0 0 16px;max-width:70ch;font-size:13px;';
            help.innerHTML =
                'The heatmap is cross-wavelet power: how much joint energy the '
                + 'two measures had at each period and moment. '
                + '<b>The dashed line beside the spectrum on the right</b> is '
                + 'that spectrum\u2019s 95&nbsp;% level — where the '
                + 'time-averaged power at a period would have to reach to beat '
                + 'red noise. <b>The flat dashed line across the bottom panel</b> '
                + 'is the same level for the band-averaged power, which is one '
                + 'number and so a straight line. Power above either line is '
                + 'more joint energy than two unrelated red-noise signals would '
                + 'give. <b>The shaded region with the dashed boundary</b> is the '
                + 'cone of influence, where the transform runs off the ends of '
                + 'the record and the values should not be read. '
                + '<br><br><b>Phase arrows</b> sit where power is significant '
                + 'rather than where coherence is, so they are not a test of '
                + 'whether the timing was consistent. Each is the phase angle '
                + 'binned to 45°: <b>→</b> in phase · <b>←</b> anti-phase · '
                + '<b>↑</b> the first measure leads by 90° · <b>↓</b> the second '
                + 'leads by 90°, with the diagonals the 45° and 135° cases in '
                + 'between. Hovering one gives the exact time, period and angle.';
            info.setAttribute('aria-controls', help.id);
            const syncHelp = () => {
                help.style.display = this._cwHelpOpen ? '' : 'none';
                info.setAttribute('aria-expanded', this._cwHelpOpen ? 'true' : 'false');
            };
            info.addEventListener('click', () => {
                this._cwHelpOpen = !this._cwHelpOpen;
                syncHelp();
            });
            syncHelp();
            container.appendChild(help);
            
            // Create grid for cross-wavelet plots
            const grid = document.createElement('div');
            grid.style.display = 'grid';
            grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(600px, 1fr))';
            grid.style.gap = '20px';
            
            // Create all plot containers first
            const plotConfigs = [];
            Object.entries(this.crossWaveletData.crosswavelet_pairs).forEach(([pairKey, pairData], index) => {
                
                const plotDiv = document.createElement('div');
                plotDiv.id = `cw-plot-${index}`;
                plotDiv.style.height = '800px'; // Increased for 4-panel layout
                // .plot-pane, not an inline background: an inline one is written
                // once and keeps the colour of whichever theme was active then.
                plotDiv.classList.add('plot-pane');
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
                        this.createCrossWaveletPlot(config.containerId, config.pairKey, config.pairData);
                    } catch (error) {
                        console.error(`Error creating cross-wavelet plot for ${config.pairKey}:`, error);
                        const plotDiv = document.getElementById(config.containerId);
                        if (plotDiv) {
                            plotDiv.innerHTML = `<div style="color: red; padding: 20px;">Error creating plot: ${error.message}</div>`;
                        }
                    }
                });
                
                this.showTabStatus();
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
                // Its own lane between the heatmap and the global spectrum.
                // A default-thickness bar with its title on the right needed
                // more room than the gap held, so it reached across into the
                // spectrum beside it.
                colorbar: {
                    title: 'Power',
                    titleside: 'top',
                    thickness: 10,
                    x: 0.665,
                    xanchor: 'left',
                    y: 0.55,
                    yanchor: 'middle',
                    len: 0.34,
                    lenmode: 'fraction',
                    tickfont: { size: 9 }
                },
                xaxis: 'x',
                yaxis: 'y',
                hovertemplate: 'Time: %{x:.1f}s<br>Period: %{customdata:.2f}s<br>Power: %{z:.4f}<extra></extra>',
                // One period per cell, not one per row. `z` is a grid, so a
                // 1-D customdata cannot be indexed against it and Plotly gives
                // up and prints the template itself into the tooltip. The
                // stored grid is downsampled, so the copy is cheap.
                customdata: power.map((row, i) => row.map(() => vis.period[i]))
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
                // A backing disc, not decoration: the glyphs are drawn only
                // where power is high, which is the pale end of Viridis, and
                // white-on-yellow is as unreadable as the theme-coloured text
                // this replaces was on the dark end.
                marker: {
                    size: 15,
                    color: 'rgba(0,0,0,0.45)'
                },
                text: [],
                textfont: {
                    // Arial has no U+2196-2199, so the diagonals fall back to
                    // whatever the system offers and can arrive as tofu.
                    family: 'Segoe UI Symbol, Apple Symbols, DejaVu Sans, sans-serif',
                    size: 14,
                    // Fixed white rather than the theme's text colour, which is
                    // near-black in the light theme over a colourscale that is
                    // dark at both themes' defaults.
                    color: '#ffffff'
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
                    `<sub>${this.chanceLevelNote(pairData)}</sub>`,
                font: { color: window.DIMS.theme().font, size: 14 }
            },
                paper_bgcolor: window.DIMS.theme().paper,
                plot_bgcolor: window.DIMS.theme().plot,
                font: { color: window.DIMS.theme().font, size: 10 },
                showlegend: true,
                // Under the title and above panel A, whose domain stops at
                // 0.95. Anchored from its top so it hangs into that gap instead
                // of growing up into the title.
                legend: {
                    x: 0.08,
                    y: 0.995,
                    xanchor: 'left',
                    yanchor: 'top',
                    orientation: 'h',
                    bgcolor: 'rgba(0,0,0,0)',
                    font: { size: 9, color: window.DIMS.theme().font }
                },
                
                // PANEL A: Time series (top)
                xaxis4: {
                    domain: [0.08, 0.64],
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
                    domain: [0.08, 0.64],
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
                    domain: [0.78, 0.97],
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
                    domain: [0.08, 0.64],
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
            
            // The window the playhead is sitting in, on every panel that has a
            // time axis. Built by a shared helper because the network tab draws
            // this same figure and has to be able to move the window on it
            // without redrawing the heatmap underneath.
            const shapes = this.crossWaveletWindowShapes(vis, log2Period);
            if (shapes) layout.shapes = shapes;

            Plotly.newPlot(containerId, traces, layout, { responsive: true });
            
            // Add click handler
            document.getElementById(containerId).on('plotly_click', (data) => {
                if (data.points && data.points.length > 0) {
                    const point = data.points[0];

                    // Three of the four panels have time on x. Panel C is the
                    // global spectrum, whose x is POWER -- clicking it used to
                    // seek the whole dashboard to a power value read as
                    // seconds. Note the axis excluded here is x2; the
                    // recurrence figures exclude x3, which in this figure is
                    // the scale-averaged panel and is a real time axis.
                    if (point.xaxis && point.xaxis._id === 'x2') return;

                    const clickedTime = point.x;
                    
                    // Update video and timeseries
                    this.handleTimeClick(clickedTime);
                    
                    // Update all cross-wavelet plots to show highlight
                    setTimeout(() => this.updateCrossWaveletHighlights(), 100);
                }
            });
        },

        // Where the playhead's window falls on this pair's figure, as Plotly
        // shapes -- or null when nothing is selected yet.
        //
        // Split out of createCrossWaveletPlot so that moving the window does not
        // mean rebuilding the plot. The heatmap does not change when the
        // playhead moves; only this does, and a full newPlot per slider tick is
        // what made dragging stutter and what left the network tab's detail
        // figure frozen at whatever moment it was opened.
        crossWaveletWindowShapes(vis, log2Period) {
            if (this.lastClickedPoint === null || this.lastClickedPoint === undefined) return null;
            const sizeEl = document.getElementById('windowSize');
            const windowSize = (sizeEl && parseInt(sizeEl.value)) || 5;
            const minTime = Math.min(...vis.time);
            const maxTime = Math.max(...vis.time);
            const minLog2Period = Math.min(...log2Period);
            const maxLog2Period = Math.max(...log2Period);

            const startTime = Math.max(minTime, this.lastClickedPoint - windowSize / 2);
            const endTime = Math.min(maxTime, this.lastClickedPoint + windowSize / 2);
            const highlight = window.DIMS.theme().highlight;

            // One edge, one panel: the three time panels differ only in which
            // axis pair they hang off and whether y is the period scale or the
            // panel's own domain.
            const band = (xref, yref, y0, y1) => ([
                { type: 'line', x0: startTime, x1: startTime, y0, y1,
                  line: { color: highlight, width: 2 }, xref, yref },
                { type: 'line', x0: endTime, x1: endTime, y0, y1,
                  line: { color: highlight, width: 2 }, xref, yref },
                { type: 'rect', x0: startTime, x1: endTime, y0, y1,
                  fillcolor: highlight, opacity: 0.15, line: { width: 0 }, xref, yref },
            ]);

            return [
                ...band('x4', 'y4 domain', 0, 1),                       // the signals
                ...band('x', 'y', minLog2Period, maxLog2Period),        // the spectrum
                ...band('x3', 'y3 domain', 0, 1),                       // scale-averaged
            ];
        },

        // Move the window on a figure that is already drawn. Plotly.relayout
        // touches the shapes and leaves the heatmap alone, which is the whole
        // difference between a slider that drags smoothly and one that does not.
        updateCrossWaveletWindow(containerId, pairData) {
            const host = document.getElementById(containerId);
            if (!host || !host.data || typeof Plotly === 'undefined') return;
            const vis = pairData && pairData.visualization;
            if (!vis || !vis.period) return;
            const log2Period = vis.period.map(pp => Math.log2(pp));
            Plotly.relayout(containerId,
                            { shapes: this.crossWaveletWindowShapes(vis, log2Period) || [] });
        },

        updateCrossWaveletHighlights() {
            // Move the window on each figure rather than rebuilding it. This
            // used to call createCrossWaveletPlot per plot per playhead move --
            // a full Plotly.newPlot of a heatmap that had not changed -- which
            // is why dragging the slider over a study with several pairs
            // stuttered.
            if (!this.crossWaveletData || !this.crossWaveletData.crosswavelet_pairs) return;
            Object.entries(this.crossWaveletData.crosswavelet_pairs).forEach(([pairKey, pairData], index) => {
                this.updateCrossWaveletWindow(`cw-plot-${index}`, pairData);
            });
        }
    });

    window.DIMS.registerTab({
        id: 'crosswavelet',
        label: 'Cross-wavelet analysis',
        status: 'Click on any plot to select a time point.',
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
