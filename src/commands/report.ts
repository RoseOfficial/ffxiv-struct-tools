/**
 * Report command - generate documentation and reports from YAML definitions
 */

import { Command } from 'commander';
import { glob } from 'glob';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import yaml from 'js-yaml';
import type { YamlData, YamlStruct, YamlEnum } from '../lib/types.js';
import { parseOffset, toHex, extractBaseType } from '../lib/types.js';
import { diff, DiffResult } from '../lib/diff-engine.js';

interface ReportOptions {
  format?: 'markdown' | 'html' | 'json';
  output?: string;
  struct?: string;
  category?: string;
  graph?: boolean;
  changelog?: string;
  depth?: string;
  title?: string;
}

interface StructInfo {
  struct: YamlStruct;
  file: string;
  references: string[];
  referencedBy: string[];
}

export function createReportCommand(): Command {
  const cmd = new Command('report');

  cmd
    .description('Generate documentation and reports from YAML definitions')
    .argument('<files...>', 'YAML file paths or glob patterns')
    .option('-f, --format <type>', 'Output format: markdown, html, json (default: markdown)', 'markdown')
    .option('-o, --output <path>', 'Output file or directory path')
    .option('-s, --struct <name>', 'Generate report for specific struct')
    .option('-c, --category <name>', 'Filter by category')
    .option('-g, --graph', 'Include relationship graph (mermaid format)')
    .option('--changelog <old-files>', 'Generate changelog by comparing with old version')
    .option('-d, --depth <n>', 'Relationship graph depth (default: 2)', '2')
    .option('-t, --title <title>', 'Report title')
    .action(async (filePatterns: string[], options: ReportOptions) => {
      try {
        await runReport(filePatterns, options);
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message);
        process.exit(1);
      }
    });

  return cmd;
}

async function runReport(
  filePatterns: string[],
  options: ReportOptions
): Promise<void> {
  // Expand glob patterns
  const files: string[] = [];
  for (const pattern of filePatterns) {
    const matches = await glob(pattern, { nodir: true });
    files.push(...matches);
  }

  if (files.length === 0) {
    throw new Error('No files matched the given patterns');
  }

  // Load all YAML data
  const allStructs = new Map<string, StructInfo>();
  const allEnums = new Map<string, { enum: YamlEnum; file: string }>();
  const categories = new Set<string>();

  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    const data = yaml.load(content) as YamlData;

    if (data?.structs) {
      for (const struct of data.structs) {
        allStructs.set(struct.type, {
          struct,
          file,
          references: [],
          referencedBy: [],
        });
        if (struct.category) {
          categories.add(struct.category);
        }
      }
    }

    if (data?.enums) {
      for (const enumDef of data.enums) {
        allEnums.set(enumDef.type, { enum: enumDef, file });
      }
    }
  }

  // Build relationship graph
  buildRelationships(allStructs);

  // Generate changelog if requested
  let changelog: DiffResult | null = null;
  if (options.changelog) {
    const oldFiles = await glob(options.changelog, { nodir: true });
    if (oldFiles.length > 0) {
      changelog = await generateChangelog(oldFiles, files);
    }
  }

  // Filter structs
  let filteredStructs = Array.from(allStructs.values());

  if (options.struct) {
    filteredStructs = filteredStructs.filter(s =>
      s.struct.type === options.struct ||
      s.struct.type.includes(options.struct!)
    );
  }

  if (options.category) {
    filteredStructs = filteredStructs.filter(s =>
      s.struct.category === options.category
    );
  }

  // Generate report
  let output: string;
  const title = options.title || 'FFXIVClientStructs Documentation';

  switch (options.format) {
    case 'json':
      output = generateJsonReport(filteredStructs, allEnums, changelog, options);
      break;
    case 'html':
      output = generateHtmlReport(filteredStructs, allEnums, changelog, title, options);
      break;
    case 'markdown':
    default:
      output = generateMarkdownReport(filteredStructs, allEnums, changelog, title, options);
      break;
  }

  // Output
  if (options.output) {
    await fs.writeFile(options.output, output);
    console.log(chalk.green(`✓ Report written to: ${options.output}`));
  } else {
    console.log(output);
  }
}

function buildRelationships(structs: Map<string, StructInfo>): void {
  const structNames = new Set(structs.keys());

  for (const [name, info] of structs) {
    const struct = info.struct;

    // Check base type
    if (struct.base && structNames.has(struct.base)) {
      info.references.push(struct.base);
      structs.get(struct.base)?.referencedBy.push(name);
    }

    // Check field types
    if (struct.fields) {
      for (const field of struct.fields) {
        const baseType = extractBaseType(field.type);
        if (structNames.has(baseType) && baseType !== name) {
          if (!info.references.includes(baseType)) {
            info.references.push(baseType);
          }
          const refInfo = structs.get(baseType);
          if (refInfo && !refInfo.referencedBy.includes(name)) {
            refInfo.referencedBy.push(name);
          }
        }
      }
    }
  }
}

async function generateChangelog(
  oldFiles: string[],
  newFiles: string[]
): Promise<DiffResult> {
  // Load old data
  const oldStructs: YamlStruct[] = [];
  const oldEnums: YamlEnum[] = [];

  for (const file of oldFiles) {
    const content = await fs.readFile(file, 'utf-8');
    const data = yaml.load(content) as YamlData;
    if (data?.structs) oldStructs.push(...data.structs);
    if (data?.enums) oldEnums.push(...data.enums);
  }

  // Load new data
  const newStructs: YamlStruct[] = [];
  const newEnums: YamlEnum[] = [];

  for (const file of newFiles) {
    const content = await fs.readFile(file, 'utf-8');
    const data = yaml.load(content) as YamlData;
    if (data?.structs) newStructs.push(...data.structs);
    if (data?.enums) newEnums.push(...data.enums);
  }

  return diff(oldStructs, newStructs, oldEnums, newEnums);
}

function generateMarkdownReport(
  structs: StructInfo[],
  enums: Map<string, { enum: YamlEnum; file: string }>,
  changelog: DiffResult | null,
  title: string,
  options: ReportOptions
): string {
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`*Generated: ${new Date().toISOString()}*`);
  lines.push('');

  // Table of contents
  lines.push('## Table of Contents');
  lines.push('');

  if (changelog) {
    lines.push('- [Changelog](#changelog)');
  }

  lines.push('- [Structs](#structs)');
  lines.push('- [Enums](#enums)');

  if (options.graph) {
    lines.push('- [Relationship Graph](#relationship-graph)');
  }

  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Structs**: ${structs.length}`);
  lines.push(`- **Enums**: ${enums.size}`);
  lines.push('');

  // Changelog
  if (changelog) {
    lines.push('## Changelog');
    lines.push('');
    lines.push(generateChangelogMarkdown(changelog));
  }

  // Structs
  lines.push('## Structs');
  lines.push('');

  // Group by category if available
  const byCategory = new Map<string, StructInfo[]>();
  for (const info of structs) {
    const cat = info.struct.category || 'Uncategorized';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(info);
  }

  const sortedCategories = Array.from(byCategory.keys()).sort();

  for (const category of sortedCategories) {
    const categoryStructs = byCategory.get(category)!;

    if (sortedCategories.length > 1) {
      lines.push(`### ${category}`);
      lines.push('');
    }

    for (const info of categoryStructs.sort((a, b) => a.struct.type.localeCompare(b.struct.type))) {
      lines.push(generateStructMarkdown(info, options));
    }
  }

  // Enums
  lines.push('## Enums');
  lines.push('');

  for (const [name, info] of Array.from(enums.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(generateEnumMarkdown(info.enum));
  }

  // Relationship graph
  if (options.graph && structs.length > 0) {
    lines.push('## Relationship Graph');
    lines.push('');
    lines.push('```mermaid');
    lines.push(generateMermaidGraph(structs, parseInt(options.depth || '2')));
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

function generateStructMarkdown(info: StructInfo, options: ReportOptions): string {
  const struct = info.struct;
  const lines: string[] = [];

  lines.push(`### ${struct.type}`);
  lines.push('');

  if (struct.notes) {
    lines.push(struct.notes);
    lines.push('');
  }

  // Metadata
  lines.push('| Property | Value |');
  lines.push('|----------|-------|');

  if (struct.size) {
    lines.push(`| Size | \`${toHex(struct.size)}\` (${struct.size} bytes) |`);
  }

  if (struct.base) {
    lines.push(`| Base | \`${struct.base}\` |`);
  }

  if (struct.union) {
    lines.push('| Type | Union |');
  }

  if (info.references.length > 0) {
    lines.push(`| References | ${info.references.map(r => `\`${r}\``).join(', ')} |`);
  }

  if (info.referencedBy.length > 0) {
    lines.push(`| Referenced By | ${info.referencedBy.slice(0, 5).map(r => `\`${r}\``).join(', ')}${info.referencedBy.length > 5 ? ` (+${info.referencedBy.length - 5} more)` : ''} |`);
  }

  lines.push('');

  // Fields
  if (struct.fields && struct.fields.length > 0) {
    lines.push('#### Fields');
    lines.push('');
    lines.push('| Offset | Type | Name | Notes |');
    lines.push('|--------|------|------|-------|');

    for (const field of struct.fields) {
      const offset = field.offset !== undefined ? toHex(parseOffset(field.offset)) : '-';
      const name = field.name || '-';
      const notes = field.notes || '';
      lines.push(`| \`${offset}\` | \`${field.type}\` | ${name} | ${notes} |`);
    }

    lines.push('');
  }

  // Virtual functions
  if (struct.vfuncs && struct.vfuncs.length > 0) {
    lines.push('#### Virtual Functions');
    lines.push('');
    lines.push('| ID | Name | Signature |');
    lines.push('|----|------|-----------|');

    for (const vfunc of struct.vfuncs) {
      const id = vfunc.id !== undefined ? String(vfunc.id) : '-';
      const name = vfunc.name || '-';
      const sig = vfunc.signature ? `\`${vfunc.signature}\`` : '-';
      lines.push(`| ${id} | ${name} | ${sig} |`);
    }

    lines.push('');
  }

  // Functions
  if (struct.funcs && struct.funcs.length > 0) {
    lines.push('#### Functions');
    lines.push('');
    lines.push('| Address | Name | Signature |');
    lines.push('|---------|------|-----------|');

    for (const func of struct.funcs) {
      const ea = func.ea !== undefined ? `\`${toHex(parseOffset(func.ea))}\`` : '-';
      const name = func.name || '-';
      const sig = func.signature ? `\`${func.signature}\`` : '-';
      lines.push(`| ${ea} | ${name} | ${sig} |`);
    }

    lines.push('');
  }

  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

function generateEnumMarkdown(enumDef: YamlEnum): string {
  const lines: string[] = [];

  lines.push(`### ${enumDef.type}`);
  lines.push('');

  if (enumDef.underlying) {
    lines.push(`*Underlying type: \`${enumDef.underlying}\`*`);
    lines.push('');
  }

  if (enumDef.values && Object.keys(enumDef.values).length > 0) {
    lines.push('| Name | Value |');
    lines.push('|------|-------|');

    for (const [name, value] of Object.entries(enumDef.values)) {
      const hexVal = typeof value === 'number' ? toHex(value) : value;
      lines.push(`| ${name} | \`${hexVal}\` |`);
    }

    lines.push('');
  }

  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

function generateChangelogMarkdown(changelog: DiffResult): string {
  const lines: string[] = [];

  // Filter by type
  const addedStructs = changelog.structs.filter(s => s.type === 'added');
  const removedStructs = changelog.structs.filter(s => s.type === 'removed');
  const modifiedStructs = changelog.structs.filter(s => s.type === 'modified');
  const addedEnums = changelog.enums.filter(e => e.type === 'added');
  const removedEnums = changelog.enums.filter(e => e.type === 'removed');

  // Structs
  if (addedStructs.length > 0) {
    lines.push('### Added Structs');
    lines.push('');
    for (const s of addedStructs) {
      lines.push(`- \`${s.structName}\``);
    }
    lines.push('');
  }

  if (removedStructs.length > 0) {
    lines.push('### Removed Structs');
    lines.push('');
    for (const s of removedStructs) {
      lines.push(`- \`${s.structName}\``);
    }
    lines.push('');
  }

  if (modifiedStructs.length > 0) {
    lines.push('### Modified Structs');
    lines.push('');

    for (const mod of modifiedStructs) {
      lines.push(`#### ${mod.structName}`);
      lines.push('');

      if (mod.oldSize !== undefined && mod.newSize !== undefined && mod.oldSize !== mod.newSize) {
        lines.push(`- Size: \`${toHex(mod.oldSize)}\` → \`${toHex(mod.newSize)}\``);
      }

      const addedFields = mod.fieldChanges.filter(f => f.type === 'added');
      const removedFields = mod.fieldChanges.filter(f => f.type === 'removed');
      const changedFields = mod.fieldChanges.filter(f => f.type === 'modified');

      if (addedFields.length > 0) {
        lines.push(`- Added fields: ${addedFields.map(f => `\`${f.fieldName}\``).join(', ')}`);
      }

      if (removedFields.length > 0) {
        lines.push(`- Removed fields: ${removedFields.map(f => `\`${f.fieldName}\``).join(', ')}`);
      }

      if (changedFields.length > 0) {
        lines.push('- Field changes:');
        for (const fc of changedFields.slice(0, 10)) {
          if (fc.oldOffset !== undefined && fc.newOffset !== undefined && fc.oldOffset !== fc.newOffset) {
            lines.push(`  - \`${fc.fieldName}\`: offset \`${toHex(fc.oldOffset)}\` → \`${toHex(fc.newOffset)}\``);
          }
          if (fc.oldType !== undefined && fc.newType !== undefined && fc.oldType !== fc.newType) {
            lines.push(`  - \`${fc.fieldName}\`: type \`${fc.oldType}\` → \`${fc.newType}\``);
          }
        }
        if (changedFields.length > 10) {
          lines.push(`  - ... and ${changedFields.length - 10} more changes`);
        }
      }

      lines.push('');
    }
  }

  // Enums
  if (addedEnums.length > 0) {
    lines.push('### Added Enums');
    lines.push('');
    for (const e of addedEnums) {
      lines.push(`- \`${e.enumName}\``);
    }
    lines.push('');
  }

  if (removedEnums.length > 0) {
    lines.push('### Removed Enums');
    lines.push('');
    for (const e of removedEnums) {
      lines.push(`- \`${e.enumName}\``);
    }
    lines.push('');
  }

  if (lines.length === 0) {
    lines.push('*No changes detected.*');
    lines.push('');
  }

  return lines.join('\n');
}

function generateMermaidGraph(structs: StructInfo[], depth: number): string {
  const lines: string[] = [];
  lines.push('graph TD');

  const addedNodes = new Set<string>();
  const addedEdges = new Set<string>();

  // Add nodes and edges
  for (const info of structs) {
    const name = info.struct.type;
    const shortName = name.split('.').pop() || name;

    if (!addedNodes.has(name)) {
      addedNodes.add(name);
      lines.push(`    ${sanitizeMermaidId(name)}["${shortName}"]`);
    }

    // Inheritance
    if (info.struct.base) {
      const baseName = info.struct.base;
      const baseShort = baseName.split('.').pop() || baseName;
      const edgeKey = `${name}->${baseName}`;

      if (!addedNodes.has(baseName)) {
        addedNodes.add(baseName);
        lines.push(`    ${sanitizeMermaidId(baseName)}["${baseShort}"]`);
      }

      if (!addedEdges.has(edgeKey)) {
        addedEdges.add(edgeKey);
        lines.push(`    ${sanitizeMermaidId(name)} -->|inherits| ${sanitizeMermaidId(baseName)}`);
      }
    }

    // References (limit to depth)
    if (depth > 0) {
      for (const ref of info.references.slice(0, 5)) {
        if (ref === info.struct.base) continue; // Skip inheritance, already shown

        const refShort = ref.split('.').pop() || ref;
        const edgeKey = `${name}->${ref}`;

        if (!addedNodes.has(ref)) {
          addedNodes.add(ref);
          lines.push(`    ${sanitizeMermaidId(ref)}["${refShort}"]`);
        }

        if (!addedEdges.has(edgeKey)) {
          addedEdges.add(edgeKey);
          lines.push(`    ${sanitizeMermaidId(name)} -.->|uses| ${sanitizeMermaidId(ref)}`);
        }
      }
    }
  }

  return lines.join('\n');
}

function sanitizeMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

function generateHtmlReport(
  structs: StructInfo[],
  enums: Map<string, { enum: YamlEnum; file: string }>,
  changelog: DiffResult | null,
  title: string,
  options: ReportOptions
): string {
  // Generate markdown first, then wrap in HTML
  const markdown = generateMarkdownReport(structs, enums, changelog, title, options);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.6;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      color: #333;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    th {
      background-color: #f5f5f5;
    }
    code {
      background-color: #f5f5f5;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Consolas', 'Monaco', monospace;
    }
    pre {
      background-color: #f5f5f5;
      padding: 15px;
      border-radius: 5px;
      overflow-x: auto;
    }
    h1, h2, h3 {
      color: #2c3e50;
    }
    hr {
      border: none;
      border-top: 1px solid #eee;
      margin: 2em 0;
    }
    .mermaid {
      text-align: center;
    }
  </style>
</head>
<body>
  <div id="content"></div>
  <script>
    mermaid.initialize({ startOnLoad: false });
    const markdown = ${JSON.stringify(markdown)};
    document.getElementById('content').innerHTML = marked.parse(markdown);
    mermaid.init(undefined, document.querySelectorAll('.language-mermaid'));
  </script>
</body>
</html>`;
}

function generateJsonReport(
  structs: StructInfo[],
  enums: Map<string, { enum: YamlEnum; file: string }>,
  changelog: DiffResult | null,
  options: ReportOptions
): string {
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      structCount: structs.length,
      enumCount: enums.size,
    },
    structs: structs.map(info => ({
      ...info.struct,
      file: info.file,
      references: info.references,
      referencedBy: info.referencedBy,
    })),
    enums: Array.from(enums.values()).map(e => ({
      ...e.enum,
      file: e.file,
    })),
    changelog: changelog ? {
      structs: changelog.structs,
      enums: changelog.enums,
    } : null,
  };

  return JSON.stringify(report, null, 2);
}
