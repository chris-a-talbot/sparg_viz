# fastgaia/cli.py

import argparse
import sys
from fastgaia.main import infer_locations, VERBOSITY_NONE, VERBOSITY_MINIMAL, VERBOSITY_MAXIMUM

def parse_arguments():
    parser = argparse.ArgumentParser(description="Infer node locations or states from a tree sequence.")
    parser.add_argument('--tree', required=True, help='Path to the tree sequence file (e.g., tree-1.trees).')
    parser.add_argument('--continuous-sample-locations', type=str, default=None,
                        help='Path to the CSV file containing continuous sample locations.')
    parser.add_argument('--discrete-sample-locations', type=str, default=None,
                        help='Path to the CSV file containing discrete sample locations.')
    parser.add_argument('--cost-matrix', type=str, default=None,
                        help='Path to the CSV file representing the cost matrix.')
    parser.add_argument('--weight-span', action='store_true', default=True,
                        help='Enable weighting by genomic span (default: True).')
    parser.add_argument('--no-weight-span', dest='weight_span', action='store_false',
                        help='Disable weighting by genomic span.')
    parser.add_argument('--weight-branch-length', action='store_true', default=True,
                        help='Enable weighting by inverse branch length (default: True).')
    parser.add_argument('--no-weight-branch-length', dest='weight_branch_length', action='store_false',
                        help='Disable weighting by inverse branch length.')
    parser.add_argument('--output-inferred-continuous', type=str, default="inferred_locations.csv",
                        help='Path to save inferred_locations.csv (default: inferred_locations.csv).')
    parser.add_argument('--output-inferred-discrete', type=str, default="inferred_states.csv",
                        help='Path to save inferred_states.csv (default: inferred_states.csv).')
    parser.add_argument('--output-locations-continuous', type=str, default="continuous_sample_locations.csv",
                        help='Path to save continuous_sample_locations.csv (default: continuous_sample_locations.csv).')
    parser.add_argument('--output-debug', type=str, default="debug_info.csv",
                        help='Path to save debug_info.csv (default: debug_info.csv).')
    parser.add_argument('--verbosity', type=str, choices=['none', 'minimal', 'maximum'], default='none',
                        help='Set the verbosity level for debugging (default: none).')

    return parser.parse_args()


def main():
    args = parse_arguments()

    # Map verbosity string to numeric levels
    verbosity_mapping = {
        'none': VERBOSITY_NONE,
        'minimal': VERBOSITY_MINIMAL,
        'maximum': VERBOSITY_MAXIMUM
    }
    verbosity_level = verbosity_mapping.get(args.verbosity, VERBOSITY_NONE)

    try:
        summary = infer_locations(
            tree_path=args.tree,
            continuous_sample_locations_path=args.continuous_sample_locations,
            discrete_sample_locations_path=args.discrete_sample_locations,
            cost_matrix_path=args.cost_matrix,
            weight_span=args.weight_span,
            weight_branch_length=args.weight_branch_length,
            output_inferred_continuous=args.output_inferred_continuous,
            output_inferred_discrete=args.output_inferred_discrete,
            output_locations_continuous=args.output_locations_continuous,
            output_debug=args.output_debug,
            verbosity=verbosity_level
        )

        # Print summary
        print("Processing complete. CSV files saved:")
        if summary["inferred_continuous_locations"]:
            print(f"- Inferred Continuous Locations: {summary['inferred_continuous_locations']}")
        if summary["inferred_discrete_states"]:
            print(f"- Inferred Discrete States: {summary['inferred_discrete_states']}")
        if summary["continuous_sample_locations"]:
            print(f"- Continuous Sample Locations: {summary['continuous_sample_locations']}")
        if summary["debug_logs"]:
            print(f"- Debug Logs: {summary['debug_logs']}")

    except RuntimeError as e:
        print(e)
        sys.exit(1)


if __name__ == "__main__":
    main()