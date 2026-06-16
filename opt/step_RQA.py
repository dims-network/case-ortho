#!/usr/bin/env python3
"""
generate_rqa.py - Generate Recurrence Quantification Analysis data for DIMS Dashboard

Usage:
    python generate_rqa.py --config config.json --output-dir assets/rqa
"""

import numpy as np
import pandas as pd
from scipy.spatial.distance import cdist
from scipy.sparse import csr_matrix
import json
import os
import argparse

def calculate_recurrence_matrix(time_series, threshold=None, target_recurrence=0.07):
    """
    Calculate recurrence matrix for a time series.
    
    Parameters:
    - time_series: 1D array of time series data
    - threshold: fixed threshold (if None, will be calculated for target_recurrence)
    - target_recurrence: target recurrence rate (default 5%)
    """
    # Normalize the time series
    ts_normalized = (time_series - np.mean(time_series)) / np.std(time_series)
    
    # Reshape for distance calculation
    ts_reshaped = ts_normalized.reshape(-1, 1)
    
    # Calculate distance matrix
    distance_matrix = cdist(ts_reshaped, ts_reshaped, metric='euclidean')
    
    # If threshold not provided, calculate it to achieve target recurrence rate
    if threshold is None:
        # Flatten upper triangle of distance matrix (excluding diagonal)
        upper_triangle = distance_matrix[np.triu_indices_from(distance_matrix, k=1)]
        # Find threshold that gives target recurrence rate
        threshold = np.percentile(upper_triangle, target_recurrence * 100)
        print(f"  Calculated threshold: {threshold:.4f} for {target_recurrence*100}% recurrence")
    
    # Create recurrence matrix
    recurrence_matrix = (distance_matrix <= threshold).astype(np.uint8)
    
    # Calculate actual recurrence rate
    n = len(time_series)
    actual_recurrence = (np.sum(recurrence_matrix) - n) / (n * n - n)
    print(f"  Actual recurrence rate: {actual_recurrence*100:.2f}%")
    
    return recurrence_matrix, threshold, actual_recurrence

def matrix_to_sparse_format(matrix):
    """
    Convert recurrence matrix to sparse format for efficient storage.
    Returns list of [row, col] pairs where recurrence is 1.
    """
    # Get indices where matrix is 1
    rows, cols = np.where(matrix == 1)
    
    # Combine into list of pairs
    sparse_data = [[int(r), int(c)] for r, c in zip(rows, cols)]
    
    return sparse_data

def downsample_for_visualization(time_series, time_values, recurrence_matrix, max_points=500):
    """
    Downsample data for visualization if too large.
    """
    n_points = len(time_series)
    
    if n_points <= max_points:
        return time_series, time_values, recurrence_matrix
    
    # Calculate downsampling factor
    factor = n_points // max_points
    
    # Downsample time series
    time_ds = time_values[::factor]
    data_ds = time_series[::factor]
    
    # Downsample recurrence matrix
    matrix_ds = recurrence_matrix[::factor, ::factor]
    
    print(f"  Downsampled from {n_points} to {len(time_ds)} points for visualization")
    
    return data_ds, time_ds, matrix_ds

def process_rqa_for_datatype(video_id, data_type):
    """
    Process RQA for a specific data type.
    """
    csv_path = f"assets/timeseries/{video_id}_{data_type}.csv"
    
    if not os.path.exists(csv_path):
        print(f"Warning: File not found: {csv_path}")
        return None
    
    print(f"\nProcessing {video_id} - {data_type}")
    
    # Load data
    df = pd.read_csv(csv_path)
    
    # Get time column
    if 'Time' not in df.columns:
        print(f"Error: No 'Time' column in {csv_path}")
        return None
    
    # Get all non-time columns
    data_cols = [col for col in df.columns if col != 'Time']
    
    # If multiple columns we take the first one
    data_col = data_cols[0]
    
    # Clean data
    mask = ~pd.isna(df[data_col])
    time_clean = df['Time'][mask].values
    data_clean = df[data_col][mask].values
    
    if len(data_clean) < 10:
        print(f"  Insufficient data points ({len(data_clean)})")
        return None
    
    print(f"  Processing {len(data_clean)} data points")
    
    # Calculate full recurrence matrix
    rec_matrix_full, threshold, rec_rate = calculate_recurrence_matrix(data_clean)
    
    # Downsample for visualization
    data_vis, time_vis, rec_matrix_vis = downsample_for_visualization(
        data_clean, time_clean, rec_matrix_full
    )
    
    # Convert to sparse format
    sparse_matrix = matrix_to_sparse_format(rec_matrix_vis)
    
    # Prepare output data
    result = {
        'data_type': data_type,
        'threshold': float(threshold),
        'recurrence_rate': float(rec_rate),
        'time_range': [float(time_clean[0]), float(time_clean[-1])],
        'visualization': {
            'time': time_vis.tolist(),
            'data': data_vis.tolist(),
            'matrix_size': len(time_vis),
            'sparse_matrix': sparse_matrix  # List of [row, col] pairs
        },
        'full_data': {
            'n_points': len(data_clean),
            'time_range': [float(time_clean[0]), float(time_clean[-1])]
        }
    }
    
    return result

def main():
    parser = argparse.ArgumentParser(description='Generate RQA data for DIMS Dashboard')
    parser.add_argument('--config', default='config.json', help='Path to config.json')
    parser.add_argument('--output-dir', default='assets/rqa', help='Output directory for RQA data')
    args = parser.parse_args()
    
    # Load config
    with open(args.config, 'r') as f:
        config = json.load(f)
    
    # Check if RQA is requested
    if 'include_RQA' not in config or not config['include_RQA']:
        print("No RQA requested in config (include_RQA not found or empty)")
        return
    
    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)
    
    # Process each video
    for video_id in config['videoIDs']:
        print(f"\n{'='*50}")
        print(f"Processing video: {video_id}")
        print(f"{'='*50}")
        
        # Continuous (Euclidean-threshold) RQA only — gaze_* are handled
        # categorically by step_categorical_rqa.py.
        rqa_data_types = [dt for dt in dict.fromkeys(config['include_RQA'])
                          if not dt.startswith('gaze')]

        # Process each data type
        rqa_results = {}
        for data_type in rqa_data_types:
            result = process_rqa_for_datatype(video_id, data_type)
            if result:
                rqa_results[data_type] = result

        # Merge into the per-video rqa file, preserving entries from the other
        # RQA step (e.g. categorical gaze) instead of overwriting them.
        if rqa_results:
            output_path = os.path.join(args.output_dir, f"{video_id}_rqa_data.json")
            merged = {}
            if os.path.exists(output_path):
                with open(output_path) as f:
                    merged = json.load(f).get('rqa_data', {})
            merged.update(rqa_results)
            with open(output_path, 'w') as f:
                json.dump({
                    'video_id': video_id,
                    'rqa_data': merged
                }, f, indent=2)
            print(f"\nSaved RQA data to {output_path}")
            
            # Print summary
            print("\nSummary:")
            for data_type, result in rqa_results.items():
                print(f"  {data_type}:")
                print(f"    - Recurrence rate: {result['recurrence_rate']*100:.2f}%")
                print(f"    - Matrix size: {result['visualization']['matrix_size']}x{result['visualization']['matrix_size']}")
                print(f"    - Sparse points: {len(result['visualization']['sparse_matrix'])}")
    
    print("\nRQA processing complete!")

if __name__ == "__main__":
    main()