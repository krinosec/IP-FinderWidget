#!/usr/bin/env python3
"""
Phase 1 – Requirements Analysis & Code Comprehension

This script performs several analysis tasks:
  • Lists all JavaScript (*.js) files in the repository.
  • Extracts all ES6 import statements and prints duplicates.
  • Scans for key component declarations (e.g., by detecting "GObject.registerClass").
  • (Optional) Looks for duplicate code blocks of a fixed size.
"""

import os
import re
from collections import defaultdict

# -------------------------------
# Step 1: List All JavaScript Files
# -------------------------------
def list_js_files(root_dir):
    """
    Recursively find all files ending with .js in the repository.
    """
    js_files = []
    for dirpath, dirnames, filenames in os.walk(root_dir):
        for filename in filenames:
            if filename.endswith('.js'):
                js_files.append(os.path.join(dirpath, filename))
    return js_files

# -------------------------------
# Step 2: Extract and Count Import Statements
# -------------------------------
def extract_imports(file_path):
    """
    Extract lines starting with an ES6 import statement.
    """
    import_pattern = re.compile(r'^\s*import\s+.*;')
    imports = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                if import_pattern.match(line):
                    imports.append(line.strip())
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
    return imports

def analyze_imports(js_files):
    """
    For each file, count duplicate and redundant import statements.
    """
    import_counts = defaultdict(int)
    file_imports = {}
    for js_file in js_files:
        imports = extract_imports(js_file)
        file_imports[js_file] = imports
        for imp in imports:
            import_counts[imp] += 1
    return import_counts, file_imports

def print_duplicate_imports(import_counts):
    """
    Print any import statement that appears in more than one file.
    """
    print("Duplicate / Redundant Import Statements:")
    for imp, count in import_counts.items():
        if count > 1:
            print(f"{imp} -> {count} times")

# -------------------------------
# Step 3: Extract Key Components from Code
# -------------------------------
def extract_key_components(file_path):
    """
    Scan a given file to detect potential key components.
    Use a marker like 'GObject.registerClass' to locate UI component definitions.
    """
    component_pattern = re.compile(r'GObject\.registerClass')
    components = []
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            for lineno, line in enumerate(f, start=1):
                if component_pattern.search(line):
                    components.append((file_path, lineno, line.strip()))
    except Exception as e:
        print(f"Error scanning {file_path} for components: {e}")
    return components

def analyze_components(js_files):
    """
    Collect all key component definitions across files.
    """
    components = []
    for js_file in js_files:
        comps = extract_key_components(js_file)
        components.extend(comps)
    return components

# -------------------------------
# (Optional) Step 4: Find Duplicate Code Blocks
# -------------------------------
def find_duplicate_blocks(file_path, block_size=5):
    """
    Look for duplicate blocks of code within a file.
    This simple approach looks for consecutive groups of lines (blocks).
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            # Filter out blank lines and strip extra whitespace.
            lines = [line.strip() for line in f if line.strip()]
    except Exception as e:
        print(f"Error reading {file_path} for duplicate block analysis: {e}")
        return {}
    
    blocks = defaultdict(list)
    # Slide a window of block_size lines over the file.
    for i in range(len(lines) - block_size + 1):
        block = "\n".join(lines[i:i+block_size])
        blocks[block].append(i+1)  # Save the starting line number for reference.
    # Filter out blocks that occur only once.
    duplicates = {block: positions for block, positions in blocks.items() if len(positions) > 1}
    return duplicates

def analyze_duplicate_blocks(js_files, block_size=5):
    """
    Analyze each JavaScript file and print any duplicate blocks found.
    """
    for js_file in js_files:
        duplicates = find_duplicate_blocks(js_file, block_size)
        if duplicates:
            print(f"\nDuplicate blocks found in {js_file}:")
            for block, positions in duplicates.items():
                print(f"Block starting at lines {positions} appears {len(positions)} times:")
                print(block)
                print("-" * 40)

# -------------------------------
# Main Function to Run Phase 1 Analysis
# -------------------------------
def main():
    root_dir = "."  # Adjust as needed (root of your repo)
    print(f"Analyzing JavaScript files in: {os.path.abspath(root_dir)}\n")
    
    # 1. List files
    js_files = list_js_files(root_dir)
    print(f"Found {len(js_files)} JavaScript files.\n")
    
    # 2. Analyze Imports
    import_counts, _ = analyze_imports(js_files)
    print_duplicate_imports(import_counts)
    
    # 3. Analyze Key Components
    components = analyze_components(js_files)
    if components:
        print("\nDetected Key Components (e.g., UI definitions via GObject.registerClass):")
        for comp in components:
            file_path, lineno, line = comp
            print(f"{file_path} [Line {lineno}]: {line}")
    else:
        print("\nNo key components found using the current detection pattern.")
    
    # 4. (Optional) Analyze Duplicate Code Blocks
    print("\nAnalyzing duplicate code blocks (block size = 5 lines)...")
    analyze_duplicate_blocks(js_files, block_size=5)

if __name__ == '__main__':
    main()
