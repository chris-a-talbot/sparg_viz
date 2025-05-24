# fastgaia/main.py

import argparse
import sys
import os
import csv
import time
import threading
import numpy as np
import pandas as pd
import tskit
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

# Define verbosity levels
VERBOSITY_NONE = 0
VERBOSITY_MINIMAL = 1
VERBOSITY_MAXIMUM = 2

# Initialize a lock for thread-safe operations
debug_lock = threading.Lock()
debug_logs = []

# Initialize global verbosity level
VERBOSITY = VERBOSITY_NONE


def set_verbosity(level):
    """
    Sets the global verbosity level.

    Parameters:
    - level (int): Verbosity level (0: none, 1: minimal, 2: maximum).
    """
    global VERBOSITY
    VERBOSITY = level


def log_debug(message, level=1):
    """
    Appends a debug message to the debug_logs list in a thread-safe manner based on verbosity level.

    Parameters:
    - message (str): The debug message to log.
    - level (int): The verbosity level required to log this message.
                   1 for minimal, 2 for maximum.
    """
    if VERBOSITY >= level:
        with debug_lock:
            debug_logs.append(message)


def calculate_weighted_average(child_locations, weight_span, weight_branch_length):
    """
    Calculates the weighted average location based on child locations.

    Parameters:
    - child_locations (list of dict): Each dict contains 'location', 'span', and 'branch_length'.
    - weight_span (bool): Whether to weight by genomic span.
    - weight_branch_length (bool): Whether to weight by inverse branch length.

    Returns:
    - np.ndarray: Weighted average location as a NumPy array.
    """
    if not child_locations:
        return np.array([])

    locations = np.array([child['location'] for child in child_locations], dtype=np.float64)
    spans = np.array([child['span'] for child in child_locations], dtype=np.float64)
    branch_lengths = np.array([child['branch_length'] for child in child_locations], dtype=np.float64)

    weights = np.ones(len(child_locations), dtype=np.float64)
    if weight_span:
        weights *= spans
    if weight_branch_length:
        with np.errstate(divide='ignore', invalid='ignore'):
            inv_branch_lengths = np.where(branch_lengths > 0, 1.0 / branch_lengths, 0.0)
        weights *= inv_branch_lengths

    valid = weights > 0
    if not np.any(valid):
        # Assign equal weights if total_weight is zero
        weighted_sum = np.sum(locations, axis=0)
        total_weight = len(child_locations)
    else:
        weighted_sum = np.sum(locations[valid] * weights[valid, np.newaxis], axis=0)
        total_weight = np.sum(weights[valid])

    if total_weight == 0:
        # Assign equal weights if total_weight is zero
        weighted_sum = np.sum(locations, axis=0)
        total_weight = len(child_locations)

    return weighted_sum / total_weight


def build_children_parents_dicts(edges, nodes):
    """
    Builds dictionaries mapping parents to children and vice versa.

    Parameters:
    - edges (iterable): Iterable of edges from the tree sequence.
    - nodes (tskit.NodeSequence): Node sequence from the tree sequence.

    Returns:
    - tuple: (children_dict, parents_dict)
    """
    children_dict = defaultdict(list)
    parents_dict = defaultdict(list)
    for edge in edges:
        parent_time = nodes[edge.parent].time
        child_time = nodes[edge.child].time
        branch_length = parent_time - child_time
        children_dict[edge.parent].append({
            'child': edge.child,
            'span': edge.right - edge.left,
            'branch_length': branch_length
        })
        parents_dict[edge.child].append({
            'parent': edge.parent,
            'span': edge.right - edge.left,
            'branch_length': branch_length
        })
    return children_dict, parents_dict


def load_continuous_sample_locations(file_path):
    """
    Loads continuous sample locations from a CSV file.

    Expected CSV format:
    node_id,dim1,dim2,...,dimN

    Returns:
    - tuple:
        - pd.DataFrame: DataFrame with columns 'node_id' and 'location' (tuple).
        - int: Number of dimensions.
    """
    df = pd.read_csv(file_path)
    if 'node_id' not in df.columns:
        raise ValueError("Continuous sample locations CSV must contain 'node_id' column.")

    dim_columns = [col for col in df.columns if col != 'node_id']
    if not dim_columns:
        raise ValueError("Continuous sample locations CSV must contain at least one dimension column.")

    df['location'] = list(df[dim_columns].to_records(index=False))
    return df[['node_id', 'location']], len(dim_columns)


def load_cost_matrix(file_path):
    """
    Loads a cost matrix from a CSV file.

    Expected CSV format:
    Each row represents a row of the matrix, with comma-separated values.

    Returns:
    - np.ndarray: Cost matrix as a NumPy array.
    """
    return np.loadtxt(file_path, delimiter=',')


def save_inferred_locations(inferred_locations, output_path="inferred_locations.csv"):
    """
    Saves the inferred continuous locations to a CSV file.

    Parameters:
    - inferred_locations (np.ndarray): Array of inferred locations.
    - output_path (str): Path to the output CSV file.
    """
    if inferred_locations.size == 0:
        log_debug(f"No inferred continuous locations to save to {output_path}.", level=1)
        return

    num_nodes, dim = inferred_locations.shape
    data = {'node_id': range(num_nodes)}
    for d in range(dim):
        data[f'dim{d + 1}'] = inferred_locations[:, d]
    df = pd.DataFrame(data)
    df.to_csv(output_path, index=False)
    log_debug(f"Saved inferred continuous locations to {output_path}", level=1)


def save_inferred_states(inferred_states, output_path="inferred_states.csv"):
    """
    Saves the inferred discrete states to a CSV file.

    Parameters:
    - inferred_states (list): List where each element corresponds to a node's inferred state(s).
    - output_path (str): Path to the output CSV file.
    """
    data = {
        'node_id': range(len(inferred_states)),
        'state_id': [';'.join(map(str, sorted(list(states)))) if states else '' for states in inferred_states]
    }
    df = pd.DataFrame(data)
    df.to_csv(output_path, index=False)
    log_debug(f"Saved inferred discrete states to {output_path}", level=1)


def save_debug_logs(output_path="debug_info.csv"):
    """
    Saves the debug logs to a CSV file.

    Parameters:
    - output_path (str): Path to the output CSV file.
    """
    if VERBOSITY == VERBOSITY_NONE:
        return  # Do not save debug logs if verbosity is none

    with open(output_path, "w", newline='', encoding='utf-8') as debug_file:
        writer = csv.writer(debug_file)
        writer.writerow(["message"])  # Header
        for log in debug_logs:
            writer.writerow([log])
    if VERBOSITY >= VERBOSITY_MINIMAL:
        print(f"Saved debug logs to {output_path}")


def save_continuous_sample_locations(inferred_continuous_locations, output_path, dim, tree_sequence):
    """
    Saves the continuous sample locations to a CSV file.

    Parameters:
    - inferred_continuous_locations (np.ndarray): Array of inferred locations.
    - output_path (str): Path to the output CSV file.
    - dim (int): Number of dimensions.
    - tree_sequence (tskit.TreeSequence): The input tree sequence.
    """
    sample_nodes = tree_sequence.samples()
    if inferred_continuous_locations.size == 0:
        # If continuous processing was skipped
        df_inferred_samples = pd.DataFrame({
            'node_id': sample_nodes,
            **{f'dim{d + 1}': [0.0] * len(sample_nodes) for d in range(dim)}
        })
    else:
        inferred_sample_locations = inferred_continuous_locations[sample_nodes]
        data = {'node_id': sample_nodes}
        for d in range(dim):
            data[f'dim{d + 1}'] = inferred_sample_locations[:, d]
        df_inferred_samples = pd.DataFrame(data)
    df_inferred_samples.to_csv(output_path, index=False)
    log_debug(f"Saved continuous sample locations to {output_path}", level=1)


def infer_continuous_locations(
        tree_sequence,
        continuous_sample_locations=None,
        weight_span=True,
        weight_branch_length=True
):
    """
    Infers the continuous locations of all nodes in a tree sequence based on sample locations.

    Parameters:
    - tree_sequence (tskit.TreeSequence): The input tree sequence.
    - continuous_sample_locations (tuple, optional): Tuple containing:
        - pd.DataFrame: DataFrame with columns 'node_id' and 'location' (tuple).
        - int: Number of dimensions.
      If not provided, the function will extract locations from the tree sequence's individuals.
    - weight_span (bool): If True, weight by genomic span.
    - weight_branch_length (bool): If True, weight by inverse branch length.

    Returns:
    - tuple:
        - np.ndarray: Array of inferred continuous locations.
        - int: Number of dimensions.
    """
    nodes = tree_sequence.nodes()
    edges = tree_sequence.edges()

    num_nodes = tree_sequence.num_nodes
    inferred_continuous_locations = None
    dim = 0

    # Load or infer sample locations
    if continuous_sample_locations is not None:
        # Provided continuous sample locations
        continuous_sample_locations_df, dim = continuous_sample_locations
        continuous_sample_locations_df.set_index('node_id', inplace=True)
        log_debug(f"Using provided continuous sample locations with dimensionality {dim}.", level=1)
    else:
        # Infer sample locations from tree sequence's individuals
        sample_nodes = tree_sequence.samples()
        individual_ids = tree_sequence.tables.nodes.individual[sample_nodes]
        locations = tree_sequence.tables.individuals.location

        # Check if individuals have location data
        if len(locations) == 0 or np.all(np.isnan(locations)):
            log_debug("No location data found in tree sequence's individuals. Skipping continuous inference.", level=1)
            return np.array([]), 0

        # Determine dimensionality based on location length
        num_individuals = tree_sequence.tables.individuals.num_rows
        if num_individuals == 0:
            log_debug("No individuals found in tree sequence. Skipping continuous inference.", level=1)
            return np.array([]), 0

        # Assuming fixed dimensionality across individuals
        # tskit individuals.location is a flat array, with dim * num_individuals elements
        # Determine dim
        if len(locations) % num_individuals != 0:
            raise ValueError("Location data length is not a multiple of the number of individuals.")
        dim = len(locations) // num_individuals
        if dim == 0:
            log_debug("Invalid location data in tree sequence's individuals. Skipping continuous inference.", level=1)
            return np.array([]), 0

        # Extract locations, pad with zeros if necessary (assuming tree sequence max 3 dimensions, but allowing more)
        inferred_sample_locations = []
        for ind_id in individual_ids:
            if ind_id != tskit.NULL:
                start = ind_id * dim
                end = start + dim
                loc = locations[start:end]
                # Pad with zeros if necessary
                if dim > 3 and len(loc) < dim:
                    loc = np.concatenate([loc, np.zeros(dim - len(loc))])
                inferred_sample_locations.append(tuple(loc[:dim]))
            else:
                # Use NaN if individual ID is NULL
                inferred_sample_locations.append(tuple([np.nan] * dim))

        # Create the DataFrame
        sample_data = {
            'node_id': sample_nodes,
            'location': inferred_sample_locations
        }
        continuous_sample_locations_df = pd.DataFrame(sample_data)
        continuous_sample_locations_df.set_index('node_id', inplace=True)
        log_debug(f"Inferred continuous sample locations from tree sequence's individuals with dimensionality {dim}.", level=1)

    if dim == 0:
        # No continuous processing needed
        return np.array([]), 0

    inferred_continuous_locations = np.full((num_nodes, dim), np.nan, dtype=np.float64)

    # Assign known continuous locations to sample nodes
    sample_continuous_nodes = set(continuous_sample_locations_df.index)
    for node_id, loc in continuous_sample_locations_df['location'].items():
        inferred_continuous_locations[node_id] = loc

    # Build children and parents dictionaries
    children_dict, _ = build_children_parents_dicts(edges, nodes)

    # Validate branch lengths
    for parent, children in children_dict.items():
        for child_info in children:
            if child_info['branch_length'] <= 0:
                raise ValueError(f"Invalid branch length for edge parent {parent} -> child {child_info['child']}")

    # Group nodes by time
    time_to_nodes = defaultdict(list)
    for u in range(num_nodes):
        node_time = nodes[u].time
        time_to_nodes[node_time].append(u)
    sorted_times = sorted(time_to_nodes.keys())

    def process_node_continuous(u):
        if u in sample_continuous_nodes:
            return u, inferred_continuous_locations[u]

        child_infos = children_dict.get(u, [])
        child_locations = [
            {
                'location': inferred_continuous_locations[child_info['child']],
                'span': child_info['span'],
                'branch_length': child_info['branch_length']
            }
            for child_info in child_infos
            if not np.isnan(inferred_continuous_locations[child_info['child']]).any()
        ]

        if not child_locations:
            return u, np.full(dim, np.nan)

        # Calculate weighted average location
        averaged_location = calculate_weighted_average(child_locations, weight_span, weight_branch_length)
        return u, averaged_location

    # Infer locations using multithreading
    with ThreadPoolExecutor(max_workers=min(32, (os.cpu_count() or 1) + 4)) as executor:
        for current_time in sorted_times:
            nodes_at_time = time_to_nodes[current_time]
            futures = {executor.submit(process_node_continuous, u): u for u in nodes_at_time}

            for future in as_completed(futures):
                u, loc = future.result()
                inferred_continuous_locations[u] = loc
                log_debug(f"Processed continuous node {u}", level=2)

    return inferred_continuous_locations, dim


def infer_discrete_states(
        tree_sequence,
        discrete_sample_locations,
        cost_matrix=None
):
    """
    Infers the discrete states of all nodes in a tree sequence based on sample locations.

    Parameters:
    - tree_sequence (tskit.TreeSequence): The input tree sequence.
    - discrete_sample_locations (pd.DataFrame): DataFrame with columns 'node_id' and 'state_id'.
        'state_id' should be an integer representing discrete states, starting at 1.
    - cost_matrix (np.ndarray, optional): An NxN matrix where N is the number of discrete states.
        Entry (x, y) represents the transition cost from state x to state y.

    Returns:
    - list: List where each element corresponds to a node's inferred state(s).
            State IDs are 1-based.
    """
    nodes = tree_sequence.nodes()
    edges = tree_sequence.edges()

    inferred_discrete_states = [set() for _ in range(tree_sequence.num_nodes)]

    # Assign known states to sample nodes
    sample_discrete_nodes = set(discrete_sample_locations.index)
    for node_id, state_id in discrete_sample_locations['state_id'].items():
        if state_id < 1:
            raise ValueError(f"Invalid state_id {state_id} for node {node_id}. State IDs must start at 1.")
        inferred_discrete_states[node_id].add(state_id)

    # Build children and parents dictionaries
    children_dict, parents_dict = build_children_parents_dicts(edges, nodes)

    # Determine possible states
    if cost_matrix is not None:
        num_states_cost = cost_matrix.shape[0]
        max_state_id = discrete_sample_locations['state_id'].max()
        if num_states_cost < max_state_id:
            raise ValueError(
                f"Cost matrix size {num_states_cost}x{num_states_cost} is smaller than the maximum state_id {max_state_id}.")
        all_states = set(range(1, num_states_cost + 1))  # 1-based states
    else:
        all_states = set(discrete_sample_locations['state_id'].unique())
        if not all_states:
            raise ValueError("No discrete sample locations provided.")

    # Group nodes by time
    time_to_nodes = defaultdict(list)
    for u in range(tree_sequence.num_nodes):
        node_time = nodes[u].time
        time_to_nodes[node_time].append(u)
    sorted_times = sorted(time_to_nodes.keys(), reverse=True)  # Start from leaves

    def process_node_discrete(u):
        if u in sample_discrete_nodes:
            return u, inferred_discrete_states[u]

        child_infos = children_dict.get(u, [])
        parent_infos = parents_dict.get(u, [])

        # Collect transition costs from children
        child_costs = defaultdict(float)
        for child_info in child_infos:
            child = child_info['child']
            branch_length = child_info['branch_length']
            child_states = inferred_discrete_states[child]
            if not child_states:
                continue  # Skip if child's state is unknown
            for state in child_states:
                for candidate_state in all_states:
                    if cost_matrix is not None:
                        # Convert state IDs to 0-based indices for cost matrix
                        cost = cost_matrix[candidate_state - 1][state - 1]
                    else:
                        cost = 1  # Default cost
                    child_costs[candidate_state] += cost * (child_info['span'] * branch_length)

        # Collect transition costs from parents
        parent_costs = defaultdict(float)
        for parent_info in parents_dict.get(u, []):
            parent = parent_info['parent']
            branch_length = parent_info['branch_length']
            parent_states = inferred_discrete_states[parent]
            if not parent_states:
                continue  # Skip if parent's state is unknown
            for state in parent_states:
                for candidate_state in all_states:
                    if cost_matrix is not None:
                        # Convert state IDs to 0-based indices for cost matrix
                        cost = cost_matrix[state - 1][candidate_state - 1]
                    else:
                        cost = 1  # Default cost
                    parent_costs[candidate_state] += cost * (parent_info['span'] * branch_length)

        # Total cost for each candidate state
        total_costs = {}
        for state in all_states:
            total_cost = child_costs.get(state, 0) + parent_costs.get(state, 0)
            total_costs[state] = total_cost

        if not total_costs:
            return u, set()

        # Find the minimum cost(s)
        min_cost = min(total_costs.values())
        best_states = {state for state, cost in total_costs.items() if cost == min_cost}

        return u, best_states

    # Infer discrete states using multithreading
    with ThreadPoolExecutor(max_workers=min(32, (os.cpu_count() or 1) + 4)) as executor:
        for current_time in sorted_times:
            nodes_at_time = time_to_nodes[current_time]
            futures = {executor.submit(process_node_discrete, u): u for u in nodes_at_time}

            for future in as_completed(futures):
                u, states = future.result()
                if states:
                    inferred_discrete_states[u] = states
                log_debug(f"Processed discrete node {u}", level=2)

    return inferred_discrete_states


def infer_locations(
        tree_path,
        continuous_sample_locations_path=None,
        discrete_sample_locations_path=None,
        cost_matrix_path=None,
        weight_span=True,
        weight_branch_length=True,
        output_inferred_continuous="fg_results/inferred_locations.csv",
        output_inferred_discrete="fg_results/inferred_states.csv",
        output_locations_continuous="fg_results/continuous_sample_locations.csv",
        output_debug="fg_results/debug_info.csv",
        verbosity=VERBOSITY_NONE
):
    """
    Core function to infer locations and/or states from a tree sequence.

    Parameters:
    - tree_path (str): Path to the tree sequence file.
    - continuous_sample_locations_path (str, optional): Path to continuous sample locations CSV.
    - discrete_sample_locations_path (str, optional): Path to discrete sample locations CSV.
    - cost_matrix_path (str, optional): Path to cost matrix CSV.
    - weight_span (bool): Whether to weight by genomic span.
    - weight_branch_length (bool): Whether to weight by inverse branch length.
    - output_inferred_continuous (str): Output path for inferred continuous locations.
    - output_inferred_discrete (str): Output path for inferred discrete states.
    - output_locations_continuous (str): Output path for continuous sample locations.
    - output_debug (str): Output path for debug logs.
    - verbosity (int): Verbosity level (0: none, 1: minimal, 2: maximum).
    """
    # Set verbosity level
    set_verbosity(verbosity)

    # Load Tree Sequence
    try:
        ts = tskit.load(tree_path)
        log_debug(f"Loaded tree sequence from {tree_path}", level=1)
    except Exception as e:
        raise RuntimeError(f"Error loading tree sequence: {e}")

    # Determine if tree sequence has location data
    has_location_data = False
    if ts.tables.individuals.location.size > 0:
        # Check if any location data is present (not all NaNs)
        if not np.all(np.isnan(ts.tables.individuals.location)):
            has_location_data = True

    # Load Continuous Sample Locations if provided
    continuous_sample_locations = None
    inferred_dim = 0
    perform_continuous = False
    if continuous_sample_locations_path:
        try:
            continuous_sample_locations, inferred_dim = load_continuous_sample_locations(
                continuous_sample_locations_path)
            log_debug(
                f"Loaded continuous sample locations from {continuous_sample_locations_path} with dimensionality {inferred_dim}", level=1)
            perform_continuous = True
        except Exception as e:
            raise RuntimeError(f"Error loading continuous sample locations: {e}")
    elif has_location_data:
        # Infer sample locations from tree sequence's individuals
        try:
            inferred_continuous_locations, inferred_dim = infer_continuous_locations(
                tree_sequence=ts,
                continuous_sample_locations=None,
                weight_span=weight_span,
                weight_branch_length=weight_branch_length
            )
            perform_continuous = True if inferred_dim > 0 else False
            if perform_continuous:
                log_debug(f"Inferred continuous sample locations from tree sequence with dimensionality {inferred_dim}", level=1)
        except Exception as e:
            raise RuntimeError(f"Error inferring continuous sample locations: {e}")
    else:
        perform_continuous = False
        log_debug(
            "No continuous sample locations provided and tree sequence lacks location data. Skipping continuous inference.", level=1)

    # Load Discrete Sample Locations if provided
    discrete_sample_locations = None
    if discrete_sample_locations_path:
        try:
            discrete_sample_locations = pd.read_csv(discrete_sample_locations_path)
            required_columns = {'node_id', 'state_id'}
            if not required_columns.issubset(discrete_sample_locations.columns):
                raise ValueError(f"Discrete sample locations CSV must contain columns: {required_columns}")
            discrete_sample_locations = discrete_sample_locations.set_index('node_id')
            log_debug(f"Loaded discrete sample locations from {discrete_sample_locations_path}", level=1)
        except Exception as e:
            raise RuntimeError(f"Error loading discrete sample locations: {e}")

    # Load Cost Matrix if provided
    cost_matrix = None
    if cost_matrix_path:
        try:
            cost_matrix = load_cost_matrix(cost_matrix_path)
            log_debug(f"Loaded cost matrix from {cost_matrix_path}", level=1)
        except Exception as e:
            raise RuntimeError(f"Error loading cost matrix: {e}")

    # Start Timing
    start_time = time.time()

    # Perform Continuous Inference if applicable
    if perform_continuous:
        if continuous_sample_locations_path:
            # User provided continuous sample locations
            inferred_continuous_locations, dim = infer_continuous_locations(
                tree_sequence=ts,
                continuous_sample_locations=continuous_sample_locations,
                weight_span=weight_span,
                weight_branch_length=weight_branch_length
            )
        else:
            # Inferred from tree sequence's individuals
            inferred_continuous_locations, dim = infer_continuous_locations(
                tree_sequence=ts,
                continuous_sample_locations=None,
                weight_span=weight_span,
                weight_branch_length=weight_branch_length
            )
    else:
        inferred_continuous_locations, dim = np.array([]), 0

    # Perform Discrete Inference if applicable
    inferred_discrete_states = None
    if discrete_sample_locations is not None:
        try:
            inferred_discrete_states = infer_discrete_states(
                tree_sequence=ts,
                discrete_sample_locations=discrete_sample_locations,
                cost_matrix=cost_matrix
            )
            log_debug("Completed discrete state inference.", level=1)
        except Exception as e:
            raise RuntimeError(f"Error during discrete state inference: {e}")

    # End Timing
    end_time = time.time()
    elapsed_time_ms = (end_time - start_time) * 1000
    log_debug(f"Total elapsed time: {elapsed_time_ms:.2f} ms", level=1)

    # Save inferred continuous locations
    if perform_continuous:
        save_inferred_locations(inferred_continuous_locations, output_inferred_continuous)
    else:
        log_debug("No continuous locations inferred or provided. Skipping saving inferred continuous locations.", level=1)

    # Save inferred discrete states if applicable
    if inferred_discrete_states is not None:
        save_inferred_states(inferred_discrete_states, output_inferred_discrete)

    # Save continuous sample locations (either provided or inferred)
    if perform_continuous:
        if continuous_sample_locations_path:
            # If provided, save the original sample locations
            continuous_sample_locations.to_csv(output_locations_continuous, index=True)
            log_debug(f"Saved provided continuous sample locations to {output_locations_continuous}", level=1)
        else:
            # If inferred, save the inferred sample locations
            save_continuous_sample_locations(
                inferred_continuous_locations,
                output_locations_continuous,
                dim,
                ts
            )
    else:
        log_debug("No continuous sample locations to save. Skipping saving continuous sample locations.", level=1)

    # Save debug logs
    if VERBOSITY > VERBOSITY_NONE:
        debug_logs.insert(0, f"Total elapsed time: {elapsed_time_ms:.2f} ms")
        save_debug_logs(output_debug)

    # Prepare summary
    summary = {
        "inferred_continuous_locations": output_inferred_continuous if perform_continuous else None,
        "inferred_discrete_states": output_inferred_discrete if inferred_discrete_states is not None else None,
        "continuous_sample_locations": output_locations_continuous if perform_continuous else None,
        "debug_logs": output_debug if VERBOSITY > VERBOSITY_NONE else None
    }

    return summary