// Time series tab.
//
// The base view: every measure plotted against time, with the playhead.
// Always present, so its gate is unconditional.
//
// Self-registering: dims-core.js does not know this file exists, and deleting
// it removes the tab and nothing else. See docs/contracts/tab.md.
(function () {
    'use strict';

    /* The figure title.
     *
     * This read "ROI Synchrony Over Time for Video {id}" for every study, a
     * leftover from the fNIRS work the tab was first written for. The tab
     * plots whatever measures a study has -- foot pressure, motion capture,
     * speech envelopes -- so naming one study's construct on all of them is
     * wrong, and it is the first thing a reader sees on the most-used tab.
     *
     * `timeseriesTitle` in config.json overrides it; `{videoID}` is
     * substituted. With nothing set, the study's own title is a better default
     * than another study's vocabulary.
     */
    function timeseriesTitle(config, videoID) {
        const template = (config && config.timeseriesTitle)
            || (config && config.title ? `${config.title} — {videoID}` : null)
            || 'Time series — {videoID}';
        return template.replace('{videoID}', videoID == null ? '' : videoID);
    }

    // Colours come from the host's palette through the documented
    // accessor, read at draw time so a theme switch is picked up. Tabs
    // must not reach into the host's script scope: a tab file is a
    // separate script and cannot rely on seeing its variables.

    window.DIMS.extendHost({
        plotTimeseries(datasets, selectedTime = null) {
            if (!datasets || datasets.length === 0) {
                document.getElementById('plotContainer').innerHTML = '<div class="error">No data to plot</div>';
                return;
            }
            
            // Create subplots for each dataset
            const traces = [];
            const annotations = [];
            
            datasets.forEach((dataset, i) => {
                if (!dataset.data || dataset.data.length === 0) return;
                
                // Sort data by time to prevent wrapping
                const sortedData = [...dataset.data].sort((a, b) => a.Time - b.Time);
                
                // Get all columns except Time for this dataset
                const columns = Object.keys(sortedData[0]).filter(col => col !== 'Time');
                
                // If multiple columns, create a single averaged trace
                if (columns.length > 1) {
                    // Average all columns for this dataset
                    const avgY = sortedData.map(row => {
                        const values = columns.map(col => row[col]).filter(v => v !== null && v !== undefined);
                        return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
                    });
                    
                    traces.push({
                        x: sortedData.map(d => d.Time),
                        y: avgY,
                        type: 'scatter',
                        mode: 'lines',
                        name: `${dataset.name} (averaged)`,
                        yaxis: `y${i + 1}`,
                        line: { color: `hsl(${i * 360 / datasets.length}, 70%, 50%)` }
                    });
                } else if (columns.length === 1) {
                    // Single column - plot directly
                    traces.push({
                        x: sortedData.map(d => d.Time),
                        y: sortedData.map(d => d[columns[0]]),
                        type: 'scatter',
                        mode: 'lines',
                        name: dataset.name,
                        yaxis: `y${i + 1}`,
                        line: { color: `hsl(${i * 360 / datasets.length}, 70%, 50%)` }
                    });
                }
                
                annotations.push({
                    text: dataset.name,
                    x: 0.02,
                    y: 1 - (i / datasets.length) - 0.02,
                    xref: 'paper',
                    yref: 'paper',
                    xanchor: 'left',
                    yanchor: 'top',
                    showarrow: false,
                    font: { color: window.DIMS.theme().font, size: 12 }
                });
            });
            
            // Create layout with subplots
            const layout = {
                title: {
                    text: timeseriesTitle(this.config, this.currentVideoID),
                    font: { color: window.DIMS.theme().font }
                },
                paper_bgcolor: window.DIMS.theme().paper,
                plot_bgcolor: window.DIMS.theme().plot,
                font: { color: window.DIMS.theme().font },
                xaxis: {
                    title: 'Time (s)',
                    color: window.DIMS.theme().font,
                    gridcolor: window.DIMS.theme().grid
                },
                annotations: annotations,
                height: 800,
                margin: { t: 80, r: 50, b: 80, l: 50 },
                showlegend: false
            };
            
            // Add y-axes for each subplot
            datasets.forEach((dataset, i) => {
                const yAxisKey = i === 0 ? 'yaxis' : `yaxis${i + 1}`;
                layout[yAxisKey] = {
                    title: '',
                    color: window.DIMS.theme().font,
                    gridcolor: window.DIMS.theme().grid,
                    domain: [1 - (i + 1) / datasets.length + 0.02, 1 - i / datasets.length - 0.02]
                };
            });
            
            // Add highlight for selected time
            if (selectedTime !== null) {
                const windowSize = parseInt(document.getElementById('windowSize').value) || 5;
                const startTime = Math.max(0, selectedTime - windowSize / 2);
                const endTime = selectedTime + windowSize / 2;
                
                layout.shapes = datasets.map((dataset, i) => ({
                    type: 'rect',
                    x0: startTime,
                    x1: endTime,
                    y0: 0,
                    y1: 1,
                    yref: `y${i + 1} domain`,
                    fillcolor: window.DIMS.theme().highlightFill,
                    line: { color: window.DIMS.theme().highlight, width: 2 }
                }));
            }
            
            Plotly.newPlot('plotContainer', traces, layout, { responsive: true });
            
            // Add click handler
            document.getElementById('plotContainer').on('plotly_click', (data) => {
                if (data.points && data.points.length > 0) {
                    const clickedTime = data.points[0].x;
                    this.handleTimeClick(clickedTime);
                }
            });
        }
    });

    window.DIMS.registerTab({
        id: 'timeseries',
        label: 'Time series',
        status: 'Click on any point to segment the video.',
        order: 10,
        containerId: 'plotContainer',   // kept: other code and tests use this id
        gate: () => true,
        async onActivate(app, container) {
        if (app.lastClickedPoint !== null) app.handleTimeClick(app.lastClickedPoint);
        },
    });
})();
