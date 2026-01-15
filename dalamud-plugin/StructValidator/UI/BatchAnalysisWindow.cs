using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Threading;
using System.Threading.Tasks;
using Dalamud.Interface.Windowing;
using Dalamud.Bindings.ImGui;
using Dalamud.Plugin.Services;
using StructValidator.Models;
using StructValidator.Services;

namespace StructValidator.UI;

/// <summary>
/// Window for batch analysis of all singleton structs.
/// </summary>
public class BatchAnalysisWindow : Window, IDisposable
{
    private readonly BatchAnalyzer _batchAnalyzer;
    private readonly ExportService _exportService;
    private readonly IPluginLog _log;
    private readonly string _exportPath;

    // Analysis state
    private bool _isRunning;
    private CancellationTokenSource? _cancellationSource;
    private List<BatchProgress> _results = new();
    private BatchProgress? _currentProgress;
    private BatchSummary? _summary;

    // Filter state
    private bool _showMatches = true;
    private bool _showMismatches = true;
    private bool _showSizeErrors = true;
    private bool _showUndocumented = true;
    private bool _showUnavailable = false;
    private bool _showErrors = true;

    public BatchAnalysisWindow(
        BatchAnalyzer batchAnalyzer,
        ExportService exportService,
        IPluginLog log,
        string exportPath)
        : base("Batch Analysis##BatchAnalysis", ImGuiWindowFlags.None)
    {
        _batchAnalyzer = batchAnalyzer;
        _exportService = exportService;
        _log = log;
        _exportPath = exportPath;

        SizeConstraints = new WindowSizeConstraints
        {
            MinimumSize = new Vector2(800, 500),
            MaximumSize = new Vector2(float.MaxValue, float.MaxValue)
        };
    }

    public void Dispose()
    {
        _cancellationSource?.Cancel();
        _cancellationSource?.Dispose();
    }

    public override void Draw()
    {
        DrawToolbar();
        ImGui.Separator();

        if (_isRunning && _currentProgress != null)
        {
            DrawProgress();
            ImGui.Separator();
        }

        if (_summary != null)
        {
            DrawSummary();
            ImGui.Separator();
        }

        DrawFilters();
        ImGui.Separator();

        DrawResultsTable();
    }

    private void DrawToolbar()
    {
        if (_isRunning)
        {
            if (ImGui.Button("Cancel"))
            {
                _cancellationSource?.Cancel();
            }
            ImGui.SameLine();
            ImGui.TextColored(new Vector4(1.0f, 0.8f, 0.3f, 1.0f), "Analysis in progress...");
        }
        else
        {
            if (ImGui.Button("Run Full Analysis"))
            {
                StartAnalysis();
            }

            if (_results.Count > 0)
            {
                ImGui.SameLine();
                if (ImGui.Button("Export Report"))
                {
                    ExportMarkdownReport();
                }

                ImGui.SameLine();
                if (ImGui.Button("Export JSON"))
                {
                    ExportJsonReport();
                }
            }
        }
    }

    private void DrawProgress()
    {
        var progress = _currentProgress!;
        ImGui.Text($"Progress: {progress.Current}/{progress.Total}");

        // Progress bar
        var fraction = progress.ProgressPercent / 100f;
        ImGui.ProgressBar(fraction, new Vector2(-1, 0), $"{progress.ProgressPercent:F0}%");

        ImGui.Text($"Current: {progress.StructName}");
    }

    private void DrawSummary()
    {
        var summary = _summary!;

        ImGui.Text("Analysis Summary");
        ImGui.Spacing();

        // Summary stats in a row
        ImGui.Columns(7, "SummaryColumns", false);

        DrawSummaryStat("Total", summary.TotalAnalyzed, new Vector4(1f, 1f, 1f, 1f));
        ImGui.NextColumn();
        DrawSummaryStat("Match", summary.PerfectMatches, new Vector4(0.5f, 1f, 0.5f, 1f));
        ImGui.NextColumn();
        DrawSummaryStat("Mismatch", summary.TypeMismatches, new Vector4(1f, 0.8f, 0.3f, 1f));
        ImGui.NextColumn();
        DrawSummaryStat("Size Error", summary.SizeErrors, new Vector4(1f, 0.5f, 0.5f, 1f));
        ImGui.NextColumn();
        DrawSummaryStat("Undocumented", summary.Undocumented, new Vector4(0.3f, 0.7f, 1f, 1f));
        ImGui.NextColumn();
        DrawSummaryStat("Unavailable", summary.Unavailable, new Vector4(0.7f, 0.7f, 0.7f, 1f));
        ImGui.NextColumn();
        DrawSummaryStat("Errors", summary.Errors, new Vector4(1f, 0.3f, 0.3f, 1f));

        ImGui.Columns(1);
    }

    private void DrawSummaryStat(string label, int count, Vector4 color)
    {
        ImGui.TextColored(color, $"{count}");
        ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1f), label);
    }

    private void DrawFilters()
    {
        ImGui.Text("Filters:");
        ImGui.SameLine();
        ImGui.Checkbox("Match", ref _showMatches);
        ImGui.SameLine();
        ImGui.Checkbox("Mismatch", ref _showMismatches);
        ImGui.SameLine();
        ImGui.Checkbox("Size Error", ref _showSizeErrors);
        ImGui.SameLine();
        ImGui.Checkbox("Undocumented", ref _showUndocumented);
        ImGui.SameLine();
        ImGui.Checkbox("Unavailable", ref _showUnavailable);
        ImGui.SameLine();
        ImGui.Checkbox("Errors", ref _showErrors);
    }

    private void DrawResultsTable()
    {
        if (_results.Count == 0)
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1f), "No analysis results. Click 'Run Full Analysis' to start.");
            return;
        }

        var filteredResults = _results.Where(r => r.State != AnalysisState.InProgress && ShouldShow(r.State)).ToList();

        ImGui.Text($"Showing {filteredResults.Count} of {_results.Count(r => r.State != AnalysisState.InProgress)} results");
        ImGui.Spacing();

        if (ImGui.BeginTable("BatchResultsTable", 6,
            ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg | ImGuiTableFlags.Resizable |
            ImGuiTableFlags.ScrollY | ImGuiTableFlags.Sortable))
        {
            ImGui.TableSetupColumn("Struct Name", ImGuiTableColumnFlags.DefaultSort, 200);
            ImGui.TableSetupColumn("Status", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupColumn("Size", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupColumn("Matches", ImGuiTableColumnFlags.None, 60);
            ImGui.TableSetupColumn("Mismatches", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupColumn("Undocumented", ImGuiTableColumnFlags.None, 90);
            ImGui.TableSetupScrollFreeze(0, 1);
            ImGui.TableHeadersRow();

            foreach (var result in filteredResults)
            {
                ImGui.TableNextRow();
                var (statusText, statusColor) = GetStatusDisplay(result.State);

                // Struct Name
                ImGui.TableNextColumn();
                ImGui.Text(result.StructName);

                // Status
                ImGui.TableNextColumn();
                ImGui.TextColored(statusColor, statusText);

                // Size
                ImGui.TableNextColumn();
                if (result.Result?.Discovery != null)
                {
                    var declaredSize = result.Result.Discovery.DeclaredSize;
                    var actualSize = result.Result.Discovery.AnalyzedSize;
                    if (declaredSize.HasValue && declaredSize != actualSize)
                    {
                        ImGui.TextColored(new Vector4(1f, 0.5f, 0.5f, 1f),
                            $"0x{declaredSize:X}/{actualSize:X}");
                    }
                    else
                    {
                        ImGui.Text($"0x{actualSize:X}");
                    }
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1f), "-");
                }

                // Matches
                ImGui.TableNextColumn();
                if (result.Result?.Comparison != null)
                {
                    ImGui.TextColored(new Vector4(0.5f, 1f, 0.5f, 1f),
                        result.Result.Comparison.MatchCount.ToString());
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1f), "-");
                }

                // Mismatches
                ImGui.TableNextColumn();
                if (result.Result?.Comparison != null)
                {
                    var count = result.Result.Comparison.MismatchCount;
                    if (count > 0)
                    {
                        ImGui.TextColored(new Vector4(1f, 0.8f, 0.3f, 1f), count.ToString());
                    }
                    else
                    {
                        ImGui.Text("0");
                    }
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1f), "-");
                }

                // Undocumented
                ImGui.TableNextColumn();
                if (result.Result?.Comparison != null)
                {
                    var count = result.Result.Comparison.UndocumentedCount;
                    if (count > 0)
                    {
                        ImGui.TextColored(new Vector4(0.3f, 0.7f, 1f, 1f), count.ToString());
                    }
                    else
                    {
                        ImGui.Text("0");
                    }
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1f), "-");
                }
            }

            ImGui.EndTable();
        }
    }

    private bool ShouldShow(AnalysisState state)
    {
        return state switch
        {
            AnalysisState.Match => _showMatches,
            AnalysisState.Mismatch => _showMismatches,
            AnalysisState.SizeError => _showSizeErrors,
            AnalysisState.Undocumented => _showUndocumented,
            AnalysisState.Unavailable => _showUnavailable,
            AnalysisState.Error => _showErrors,
            _ => true
        };
    }

    private (string Text, Vector4 Color) GetStatusDisplay(AnalysisState state)
    {
        return state switch
        {
            AnalysisState.Match => ("Match", new Vector4(0.5f, 1f, 0.5f, 1f)),
            AnalysisState.Mismatch => ("Mismatch", new Vector4(1f, 0.8f, 0.3f, 1f)),
            AnalysisState.SizeError => ("Size Error", new Vector4(1f, 0.5f, 0.5f, 1f)),
            AnalysisState.Undocumented => ("Undocumented", new Vector4(0.3f, 0.7f, 1f, 1f)),
            AnalysisState.Unavailable => ("Unavailable", new Vector4(0.7f, 0.7f, 0.7f, 1f)),
            AnalysisState.Error => ("Error", new Vector4(1f, 0.3f, 0.3f, 1f)),
            _ => ("Unknown", new Vector4(1f, 1f, 1f, 1f))
        };
    }

    private void StartAnalysis()
    {
        if (_isRunning) return;

        _isRunning = true;
        _results.Clear();
        _summary = null;
        _cancellationSource = new CancellationTokenSource();

        Task.Run(async () =>
        {
            try
            {
                await foreach (var progress in _batchAnalyzer.AnalyzeAllAsync(_cancellationSource.Token))
                {
                    _currentProgress = progress;

                    // Store completed results
                    if (progress.State != AnalysisState.InProgress)
                    {
                        _results.Add(progress);
                    }
                }

                _summary = BatchAnalyzer.GetSummary(_results);
                _log.Info($"Batch analysis complete: {_summary.TotalAnalyzed} structs analyzed");
            }
            catch (OperationCanceledException)
            {
                _log.Info("Batch analysis cancelled");
            }
            catch (Exception ex)
            {
                _log.Error($"Batch analysis failed: {ex.Message}");
            }
            finally
            {
                _isRunning = false;
                _currentProgress = null;
            }
        });
    }

    private void ExportMarkdownReport()
    {
        try
        {
            var analysisResults = _results
                .Where(r => r.Result != null)
                .Select(r => r.Result!)
                .ToList();

            var gameVersion = analysisResults.FirstOrDefault()?.GameVersion ?? "Unknown";
            var markdown = _exportService.ExportBatchToMarkdown(analysisResults, gameVersion);

            var fileName = $"batch-analysis-{DateTime.UtcNow:yyyyMMdd-HHmmss}.md";
            var filePath = Path.Combine(_exportPath, fileName);

            Directory.CreateDirectory(_exportPath);
            File.WriteAllText(filePath, markdown);

            _log.Info($"Exported batch report to: {filePath}");
        }
        catch (Exception ex)
        {
            _log.Error($"Failed to export report: {ex.Message}");
        }
    }

    private async void ExportJsonReport()
    {
        try
        {
            var analysisResults = _results
                .Where(r => r.Result != null)
                .Select(r => r.Result!)
                .ToList();

            var fileName = $"batch-analysis-{DateTime.UtcNow:yyyyMMdd-HHmmss}.json";
            var filePath = Path.Combine(_exportPath, fileName);

            Directory.CreateDirectory(_exportPath);

            var json = await _exportService.ExportToJsonAsync(analysisResults.FirstOrDefault()!);
            // TODO: Export all results as array
            File.WriteAllText(filePath, json);

            _log.Info($"Exported batch JSON to: {filePath}");
        }
        catch (Exception ex)
        {
            _log.Error($"Failed to export JSON: {ex.Message}");
        }
    }
}
