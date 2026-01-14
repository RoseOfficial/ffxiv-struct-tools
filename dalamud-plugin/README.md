# Struct Validator - Dalamud Plugin

A Dalamud plugin for validating FFXIVClientStructs definitions against live game memory.

## Features

- **Size Validation**: Compares declared struct sizes with actual memory layout
- **Field Offset Validation**: Verifies field offsets match compiled struct definitions
- **Inheritance Validation**: Checks base type sizes and inheritance chains
- **JSON Export**: Exports validation results for use with the `fst` CLI tools
- **Interactive UI**: Browse and search validation results in-game

## Installation

### Prerequisites

- FFXIV with Dalamud installed
- .NET 8.0 SDK
- FFXIVClientStructs development setup

### Building

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ffxiv-struct-tools
   cd ffxiv-struct-tools/dalamud-plugin/StructValidator
   ```

2. Build the plugin:
   ```bash
   dotnet build
   ```

3. Copy the output to your Dalamud devPlugins folder:
   ```
   %APPDATA%\XIVLauncher\devPlugins\StructValidator\
   ```

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/structval` | Open the Struct Validator window |
| `/structvalall` | Run all validations and print summary |
| `/structvalexport [path]` | Export validation report to JSON file |

### UI Features

The main window provides:

1. **Run All Validations**: Validate all FFXIVClientStructs definitions
2. **Validate Single**: Check a specific struct by name
3. **Export JSON**: Save results for analysis with CLI tools
4. **Settings**: Configure display options and filters

### Validation Report

The exported JSON report contains:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "gameVersion": "7.0",
  "summary": {
    "totalStructs": 1500,
    "passedStructs": 1480,
    "failedStructs": 20,
    "errorCount": 25,
    "warningCount": 10
  },
  "results": [
    {
      "structName": "FFXIVClientStructs.FFXIV.Client.Game.Character.Character",
      "passed": false,
      "declaredSize": 6720,
      "actualSize": 6728,
      "issues": [
        {
          "severity": "error",
          "rule": "size-mismatch",
          "message": "Declared size 0x1A40 does not match actual size 0x1A48"
        }
      ]
    }
  ]
}
```

## CLI Integration

Use the exported JSON with the `fst compare-report` command:

```bash
# Compare YAML definitions with Dalamud validation report
fst compare-report ./ida/ffxiv_structs.yml ./struct-validation.json

# Output as JSON for further processing
fst compare-report ./ida/*.yml ./struct-validation.json --json

# Save comparison report
fst compare-report ./ida/*.yml ./struct-validation.json -o ./comparison.json
```

## Validation Rules

| Rule | Severity | Description |
|------|----------|-------------|
| `size-mismatch` | error | Declared size doesn't match actual size |
| `size-calculation` | error | Could not calculate struct size |
| `field-offset-mismatch` | error | Field offset doesn't match declared |
| `inheritance-size` | error | Struct smaller than base type |
| `validation-error` | error | Validation process failed |

## Workflow

### Typical Development Workflow

1. **In-Game**: Run `/structvalall` after a game update
2. **Export**: Use `/structvalexport` to save results
3. **Compare**: Run `fst compare-report` against YAML definitions
4. **Fix**: Use `fst patch` to apply bulk offset changes
5. **Validate**: Run `fst test` to verify YAML consistency

### CI Integration

```yaml
# GitHub Actions example
- name: Compare against Dalamud report
  run: |
    fst compare-report ./ida/*.yml ./validation-reports/latest.json
```

## Troubleshooting

### Plugin won't load

- Ensure Dalamud API level matches (currently 10)
- Check FFXIVClientStructs.dll is in the Dalamud hooks folder
- Verify .NET 8.0 runtime is installed

### Validation errors

- Size mismatches may indicate game update
- Field offset errors may need YAML updates
- Check FFXIVClientStructs version matches game version

## License

MIT
