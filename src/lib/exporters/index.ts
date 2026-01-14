/**
 * Exporter index - registry of all available exporters
 */

export * from './base.js';
export { idaExporter } from './ida.js';
export { reclassExporter } from './reclass.js';
export { headersExporter } from './headers.js';
export { ghidraExporter } from './ghidra.js';

import { idaExporter } from './ida.js';
import { reclassExporter } from './reclass.js';
import { headersExporter } from './headers.js';
import { ghidraExporter } from './ghidra.js';
import type { Exporter, ExportFormat } from './base.js';

/**
 * Registry of all available exporters
 */
export const exporters: Record<ExportFormat, Exporter> = {
  ida: idaExporter,
  reclass: reclassExporter,
  headers: headersExporter,
  ghidra: ghidraExporter,
};

/**
 * Get an exporter by format name
 */
export function getExporter(format: ExportFormat): Exporter | undefined {
  return exporters[format];
}

/**
 * Get list of available format names
 */
export function getAvailableFormats(): ExportFormat[] {
  return Object.keys(exporters) as ExportFormat[];
}
