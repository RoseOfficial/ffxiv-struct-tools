import { describe, it, expect, beforeAll } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

const CLI_PATH = path.resolve(__dirname, '../../../dist/index.js');
const FIXTURES_PATH = path.resolve(__dirname, '../../../test-fixtures');

describe('fst report command', () => {
  describe('markdown output', () => {
    it('should generate markdown report for test fixtures', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" report "${FIXTURES_PATH}/new-version.yaml"`
      );

      expect(stdout).toContain('# FFXIVClientStructs Documentation');
      expect(stdout).toContain('## Structs');
      expect(stdout).toContain('## Enums');
      expect(stdout).toContain('PlayerCharacter');
      expect(stdout).toContain('ActionManager');
      expect(stdout).toContain('JobType');
    });

    it('should include summary statistics', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" report "${FIXTURES_PATH}/new-version.yaml"`
      );

      expect(stdout).toContain('**Structs**: 3');
      expect(stdout).toContain('**Enums**: 1');
    });

    it('should filter by struct name', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" report "${FIXTURES_PATH}/new-version.yaml" --struct PlayerCharacter`
      );

      expect(stdout).toContain('PlayerCharacter');
      expect(stdout).not.toContain('### ActionManager');
    });
  });

  describe('JSON output', () => {
    it('should generate valid JSON report', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" report "${FIXTURES_PATH}/new-version.yaml" --format json`
      );

      const report = JSON.parse(stdout);
      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('structs');
      expect(report).toHaveProperty('enums');
      expect(report.summary.structCount).toBe(3);
      expect(report.summary.enumCount).toBe(1);
    });

    it('should include struct details in JSON', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" report "${FIXTURES_PATH}/new-version.yaml" --format json`
      );

      const report = JSON.parse(stdout);
      const playerStruct = report.structs.find((s: any) => s.type === 'PlayerCharacter');
      expect(playerStruct).toBeDefined();
      expect(playerStruct.size).toBe(6784); // 0x1A80
      expect(playerStruct.fields).toBeDefined();
    });
  });

  describe('changelog generation', () => {
    it('should generate changelog when comparing versions', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" report "${FIXTURES_PATH}/new-version.yaml" --changelog "${FIXTURES_PATH}/old-version.yaml"`
      );

      expect(stdout).toContain('## Changelog');
      expect(stdout).toContain('Added Structs');
      expect(stdout).toContain('NewStruct');
      expect(stdout).toContain('Modified Structs');
      expect(stdout).toContain('PlayerCharacter');
    });

    it('should include changelog in JSON output', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" report "${FIXTURES_PATH}/new-version.yaml" --changelog "${FIXTURES_PATH}/old-version.yaml" --format json`
      );

      const report = JSON.parse(stdout);
      expect(report.changelog).not.toBeNull();
      expect(report.changelog.structs).toBeDefined();
      expect(report.changelog.enums).toBeDefined();
    });
  });

  describe('relationship graph', () => {
    it('should include mermaid graph when --graph is specified', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" report "${FIXTURES_PATH}/new-version.yaml" --graph`
      );

      expect(stdout).toContain('## Relationship Graph');
      expect(stdout).toContain('```mermaid');
      expect(stdout).toContain('graph TD');
    });
  });

  describe('notes support', () => {
    it('should include notes in markdown output', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" report "${FIXTURES_PATH}/with-notes.yaml"`
      );

      expect(stdout).toContain('Main player character struct');
      expect(stdout).toContain('Current job level');
    });

    it('should include notes in JSON output', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" report "${FIXTURES_PATH}/with-notes.yaml" --format json`
      );

      const report = JSON.parse(stdout);
      const playerStruct = report.structs.find((s: any) => s.type === 'PlayerCharacter');
      expect(playerStruct.notes).toContain('Main player character struct');
      expect(playerStruct.category).toBe('Character');
    });

    it('should filter by category', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" report "${FIXTURES_PATH}/with-notes.yaml" --category Combat`
      );

      expect(stdout).toContain('ActionManager');
      expect(stdout).not.toContain('### PlayerCharacter');
    });
  });

  describe('HTML output', () => {
    it('should generate HTML report', async () => {
      const { stdout } = await execAsync(
        `node "${CLI_PATH}" report "${FIXTURES_PATH}/new-version.yaml" --format html`
      );

      expect(stdout).toContain('<!DOCTYPE html>');
      expect(stdout).toContain('<title>FFXIVClientStructs Documentation</title>');
      expect(stdout).toContain('mermaid');
      expect(stdout).toContain('marked');
    });
  });

  describe('error handling', () => {
    it('should error when no files match pattern', async () => {
      try {
        await execAsync(
          `node "${CLI_PATH}" report "${FIXTURES_PATH}/nonexistent*.yaml"`
        );
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.stderr || error.message).toContain('No files matched');
      }
    });
  });
});
