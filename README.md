# ffxiv-struct-tools

CLI tools for [FFXIVClientStructs](https://github.com/aers/FFXIVClientStructs) maintainers.

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/ffxiv-struct-tools
cd ffxiv-struct-tools
npm install
npm run build
npm link  # Makes 'fst' command available globally
```

## Commands

### `fst validate`

Run sanity checks on YAML struct definitions.

```bash
# Validate a single file
fst validate ./ida/ffxiv_structs.yml

# Validate multiple files with glob patterns
fst validate "./ida/*.yml"

# Enable strict mode for additional checks
fst validate ./ida/ffxiv_structs.yml --strict

# Output as JSON (for CI integration)
fst validate ./ida/ffxiv_structs.yml --json

# Show summary for all files
fst validate ./ida/ffxiv_structs.yml --summary

# Ignore specific rules
fst validate ./ida/ffxiv_structs.yml --ignore struct-size,field-bounds
```

#### Validation Rules

| Rule | Severity | Description |
|------|----------|-------------|
| `struct-name` | error | Struct must have a type/name |
| `struct-size` | warning | Struct should have a defined size |
| `field-offset-order` | warning | Field offsets should be ascending |
| `field-bounds` | error | Field offset + size should not exceed struct size |
| `struct-alignment` | info | Struct size should be 8-byte aligned (strict only) |
| `type-reference` | info | Field types should reference known structs/enums (strict only) |
| `vfunc-id` | warning | Virtual function IDs should be in reasonable range |
| `func-address` | info | Function addresses should be in valid range |
| `duplicate-offset` | info | Fields at same offset may indicate union |
| `inheritance-chain` | warning/error | Base struct must exist, no self-inheritance |
| `vtable-consistency` | error/info | VFunc IDs should not duplicate, gaps are noted |
| `pointer-alignment` | warning | Pointer fields should be 8-byte aligned (strict only) |
| `size-field-mismatch` | error/info | Declared size must fit all fields, large gaps noted (strict) |
| `naming-convention` | info | PascalCase for structs/fields (strict only) |
| `enum-name` | error | Enum must have a type/name |
| `enum-duplicate-value` | info | Enum values with same number |

### `fst diff`

Compare struct definitions between versions and detect bulk offset patterns.

```bash
# Compare two versions
fst diff old-version.yaml new-version.yaml

# Enable pattern detection (bulk shifts, vtable changes)
fst diff old-version.yaml new-version.yaml --detect-patterns

# Output as JSON
fst diff old-version.yaml new-version.yaml --json

# Compare directories with glob patterns
fst diff "./old/*.yml" "./new/*.yml"

# Show only struct changes
fst diff old.yaml new.yaml --structs-only
```

**Features:**
- Detects added, removed, and modified structs/enums
- Identifies bulk offset shift patterns (e.g., "all fields +0x8 after offset 0x100")
- Detects vtable slot shifts
- Reports confidence scores for detected patterns

### `fst patch`

Apply bulk offset changes to YAML files.

```bash
# Apply offset shift (dry-run to preview)
fst patch ./structs.yaml --delta 0x8 --start-offset 0x100 --dry-run

# Apply to specific structs
fst patch ./structs.yaml --delta 0x8 --struct "PlayerCharacter"

# Apply vtable slot shift
fst patch ./structs.yaml --vfunc-delta 2 --struct "Actor*"

# Apply changes (writes to file)
fst patch ./structs.yaml --delta 0x8 --start-offset 0x100

# Apply a patch file
fst patch ./structs.yaml --apply patch.json
```

**Options:**
- `--delta <offset>` - Offset delta to apply (e.g., 0x8, +8, -0x10)
- `--start-offset <offset>` - Only shift offsets >= this value
- `--struct <pattern>` - Struct name pattern (supports `*` wildcard)
- `--vfunc-delta <n>` - VFunc slot delta to apply
- `--dry-run` - Preview changes without writing

### `fst export`

Export struct definitions to various reverse engineering tool formats.

```bash
# Export to IDA Pro Python script
fst export ./structs.yaml --format ida

# Export to ReClass.NET XML
fst export ./structs.yaml --format reclass

# Export to C/C++ header file
fst export ./structs.yaml --format headers

# Export to Ghidra Python script
fst export ./structs.yaml --format ghidra

# Specify output path
fst export ./structs.yaml --format ida --output ./output/ffxiv_types.py

# Export multiple files
fst export "./ida/*.yml" --format headers --output ./ffxiv_all.h

# Custom namespace for headers/Ghidra
fst export ./structs.yaml --format headers --namespace FFXIV::Client
```

**Supported Formats:**

| Format | Extension | Description |
|--------|-----------|-------------|
| `ida` | `.py` | IDA Pro Python script - creates structs/enums in IDA |
| `reclass` | `.reclass` | ReClass.NET XML - import into ReClass memory viewer |
| `headers` | `.h` | C/C++ header - `#pragma pack(1)` structs with `static_assert` |
| `ghidra` | `.py` | Ghidra Python script - creates data types in Ghidra |

**Options:**
- `-f, --format <type>` - Output format (required): ida, reclass, headers, ghidra
- `-o, --output <path>` - Output file path
- `-n, --namespace <name>` - Namespace/category for generated types
- `-c, --comments` - Include comments in output

### `fst test`

Run comprehensive validation tests with CI integration and baseline comparison.

```bash
# Run tests on YAML files
fst test ./ida/ffxiv_structs.yml

# Enable strict mode for additional checks
fst test ./ida/ffxiv_structs.yml --strict

# Fail on warnings (useful for CI)
fst test ./ida/ffxiv_structs.yml --fail-on-warning

# Compare against a baseline file
fst test ./ida/ffxiv_structs.yml --baseline ./baseline.json

# Update baseline with current results
fst test ./ida/ffxiv_structs.yml --baseline ./baseline.json --update-baseline

# Output as JSON for CI tools
fst test ./ida/ffxiv_structs.yml --json

# Write report to file
fst test ./ida/ffxiv_structs.yml --output ./report.json
```

**Options:**
- `-b, --baseline <path>` - Compare against baseline file (shows new/resolved issues)
- `-u, --update-baseline` - Update baseline file with current results
- `--strict` - Enable strict mode with additional checks
- `--fail-on-warning` - Exit with error code on warnings
- `--json` - Output results as JSON
- `-o, --output <path>` - Write test report to file

**CI Integration Example:**
```yaml
# GitHub Actions
- name: Validate struct definitions
  run: fst test ./ida/*.yml --strict --fail-on-warning
```

### `fst compare-report`

Compare YAML definitions with Dalamud validation reports exported from the in-game plugin.

```bash
# Compare YAML with Dalamud validation report
fst compare-report ./ida/ffxiv_structs.yml ./struct-validation.json

# Output as JSON
fst compare-report ./ida/*.yml ./validation.json --json

# Save comparison report
fst compare-report ./ida/*.yml ./validation.json -o ./comparison.json
```

**Options:**
- `--json` - Output results as JSON
- `-o, --output <path>` - Write comparison report to file

### `fst report`

Generate documentation and reports from YAML definitions.

```bash
# Generate markdown documentation
fst report ./ida/ffxiv_structs.yml

# Generate HTML documentation
fst report ./ida/ffxiv_structs.yml --format html

# Generate JSON report
fst report ./ida/ffxiv_structs.yml --format json

# Include relationship graph (Mermaid diagrams)
fst report ./ida/ffxiv_structs.yml --graph

# Generate changelog by comparing versions
fst report ./new-version.yml --changelog ./old-version.yml

# Filter by struct name
fst report ./ida/ffxiv_structs.yml --struct PlayerCharacter

# Filter by category
fst report ./ida/ffxiv_structs.yml --category Combat

# Write to file
fst report ./ida/ffxiv_structs.yml -o ./docs/structs.md
```

**Options:**
- `-f, --format <type>` - Output format: markdown (default), html, json
- `-o, --output <path>` - Output file path
- `-s, --struct <name>` - Filter to specific struct
- `-c, --category <name>` - Filter by category
- `-g, --graph` - Include relationship graph (Mermaid format)
- `--changelog <old-files>` - Generate changelog comparing with old version
- `-d, --depth <n>` - Relationship graph depth (default: 2)
- `-t, --title <title>` - Custom report title

**Features:**
- Generates comprehensive markdown/HTML documentation
- Struct relationship graphs using Mermaid diagrams
- Changelog generation showing added/removed/modified structs
- Category-based organization
- Field and function documentation with notes support

### YAML Annotations

Struct definitions support `notes` and `category` fields for better documentation:

```yaml
structs:
  - type: PlayerCharacter
    size: 0x1A70
    category: Character
    notes: |
      Main player character struct.
      Handles position, stats, and animations.
    fields:
      - type: int
        name: Level
        offset: 0x18
        notes: Current job level (1-100)
```

When using `--comments` with `fst export`, these notes are included in the generated output.

## Dalamud Plugin

The `dalamud-plugin/` directory contains a Dalamud plugin for in-game struct validation. This plugin:

- Validates FFXIVClientStructs definitions against live game memory
- Detects size mismatches and field offset errors
- Exports JSON reports for use with `fst compare-report`

See [dalamud-plugin/README.md](./dalamud-plugin/README.md) for installation and usage instructions.

### `fst sig`

Signature-based automatic offset discovery. Extract byte patterns from the current game binary, then scan new binaries after patches to detect where offsets shifted.

```bash
# Extract signatures from binary based on YAML definitions
fst sig extract ./ffxiv_dx11.exe "./ida/*.yml" -v "7.1"

# Scan a new binary for signature matches and detect changes
fst sig scan ./new_ffxiv_dx11.exe --sigs "*.sigs.yaml"

# Check signature coverage and health
fst sig status
```

#### `fst sig extract`

Extract byte patterns from the game binary that reference known struct fields.

```bash
# Extract with version identifier
fst sig extract ./ffxiv_dx11.exe "./ida/*.yml" --version "7.1"

# Output to single JSON file
fst sig extract ./ffxiv_dx11.exe "./structs.yml" --output signatures.json

# Set minimum confidence threshold
fst sig extract ./ffxiv_dx11.exe "./structs.yml" --min-confidence 80
```

**Options:**
- `-v, --version <version>` - Version identifier (auto-detected if not specified)
- `-o, --output <path>` - Output file path (default: individual .sigs.yaml files)
- `--min-confidence <n>` - Minimum confidence threshold (default: 70)
- `--json` - Output as JSON

#### `fst sig scan`

Scan a new binary for previously extracted signatures and detect offset changes.

```bash
# Scan with default signature files (*.sigs.yaml)
fst sig scan ./new_ffxiv_dx11.exe

# Specify signature files
fst sig scan ./new_ffxiv_dx11.exe --sigs "./sigs/*.json"

# Output results to file
fst sig scan ./new_ffxiv_dx11.exe --output scan-results.json

# Filter by confidence
fst sig scan ./new_ffxiv_dx11.exe --min-confidence 80
```

**Options:**
- `-s, --sigs <patterns...>` - Signature file paths or glob patterns
- `-o, --output <path>` - Output file path for results
- `--min-confidence <n>` - Minimum confidence to report (default: 0)
- `--json` - Output as JSON

**Output includes:**
- Matched/missing signature counts
- Detected field offset changes with confidence scores
- Detected bulk shift patterns (e.g., "all Character fields shifted +0x8")
- Pattern grouping with likely cause analysis

#### `fst sig status`

Report signature health and coverage statistics.

```bash
# Check all signature files in current directory
fst sig status

# Check specific files
fst sig status "./sigs/*.json"

# Output as JSON
fst sig status --json
```

**Signature Workflow:**

```
1. Before patch:  fst sig extract ./ffxiv.exe ./structs.yml -v "7.1"
                  → Creates signature files with byte patterns

2. After patch:   fst sig scan ./new_ffxiv.exe
                  → Detects changes: "PlayerCharacter.ActionManager: 0x1A0 → 0x1A8 [94%]"
                  → Detects patterns: "bulk_shift_+0x8 affects 15 structs"

3. Apply changes: fst patch ./structs.yml --from-scan scan-results.json
                  → (Integration coming in future update)
```

### `fst vtables`

Track vtable addresses and slot changes across game versions.

```bash
# Extract vtable information
fst vtables extract "./ida/*.yml" --version "7.1" --output vtables.json

# Compare vtables between versions
fst vtables diff ./old-vtables.json ./new-vtables.json
```

### `fst version`

Track struct evolution across game versions.

```bash
# Save a version snapshot
fst version save "7.1" --path "./ida/*.yml" --notes "Post-patch update"

# List all saved versions
fst version list

# Compare two versions
fst version diff "7.0" "7.1"

# Show history for a specific struct
fst version history PlayerCharacter

# Delete a version
fst version delete "7.0" --force
```

## Development

```bash
# Build TypeScript
npm run build

# Watch mode for development
npm run dev

# Run tests
npm test

# Type checking
npm run typecheck
```

## Usage with FFXIVClientStructs

This tool is designed to work with the FFXIVClientStructs repository:

```bash
# Clone FFXIVClientStructs
git clone https://github.com/aers/FFXIVClientStructs

# Run validation
fst validate ./FFXIVClientStructs/ida/ffxiv_structs.yml
```

## License

MIT
