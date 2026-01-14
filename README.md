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
| `enum-name` | error | Enum must have a type/name |
| `enum-duplicate-value` | info | Enum values with same number |

### Coming Soon

- `fst diff` - Compare struct definitions between versions
- `fst patch` - Generate and apply offset patches
- `fst vtables` - Track vtable addresses across game versions
- `fst export` - Export definitions to IDA/ReClass/header formats

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
