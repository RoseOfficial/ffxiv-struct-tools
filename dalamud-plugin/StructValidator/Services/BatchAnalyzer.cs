using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Dalamud.Plugin.Services;
using StructValidator.Discovery;
using StructValidator.Memory;
using StructValidator.Models;

namespace StructValidator.Services;

/// <summary>
/// Service for batch analysis of all singleton structs.
/// </summary>
public class BatchAnalyzer
{
    private readonly StructValidationEngine _validationEngine;
    private readonly IPluginLog _log;

    public BatchAnalyzer(StructValidationEngine validationEngine, IPluginLog log)
    {
        _validationEngine = validationEngine;
        _log = log;
    }

    /// <summary>
    /// Analyze all singletons asynchronously with progress reporting.
    /// </summary>
    public async IAsyncEnumerable<BatchProgress> AnalyzeAllAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var singletons = _validationEngine.GetSingletonNames().ToList();
        var total = singletons.Count;

        _log.Info($"Starting batch analysis of {total} singletons");

        for (var i = 0; i < singletons.Count; i++)
        {
            if (cancellationToken.IsCancellationRequested)
            {
                _log.Info("Batch analysis cancelled");
                yield break;
            }

            var singletonName = singletons[i];

            yield return new BatchProgress
            {
                Current = i + 1,
                Total = total,
                StructName = singletonName,
                State = AnalysisState.InProgress,
                Result = null
            };

            AnalysisResult? result = null;
            AnalysisState state;

            try
            {
                // Small delay to avoid blocking the UI
                await Task.Delay(1, cancellationToken);

                result = AnalyzeSingleton(singletonName);

                if (result == null)
                {
                    state = AnalysisState.Unavailable;
                }
                else if (result.Comparison?.MismatchCount > 0)
                {
                    state = AnalysisState.Mismatch;
                }
                else if (result.Comparison?.SizeMatches == false)
                {
                    state = AnalysisState.SizeError;
                }
                else if (result.Comparison?.UndocumentedCount > 0)
                {
                    state = AnalysisState.Undocumented;
                }
                else
                {
                    state = AnalysisState.Match;
                }
            }
            catch (Exception ex)
            {
                _log.Error($"Error analyzing {singletonName}: {ex.Message}");
                state = AnalysisState.Error;
            }

            yield return new BatchProgress
            {
                Current = i + 1,
                Total = total,
                StructName = singletonName,
                State = state,
                Result = result
            };
        }

        _log.Info("Batch analysis complete");
    }

    /// <summary>
    /// Analyze a single singleton struct.
    /// </summary>
    private AnalysisResult? AnalyzeSingleton(string singletonName)
    {
        // Get singleton info
        var (address, size, type) = _validationEngine.GetSingletonInfo(singletonName);

        if (address == nint.Zero)
        {
            _log.Debug($"Singleton {singletonName} is not available");
            return null;
        }

        // Get struct type name for analysis
        var typeName = type?.FullName ?? type?.Name ?? singletonName;

        // Analyze memory
        var layout = MemoryAnalyzer.Analyze(address, size, typeName);
        if (layout == null)
        {
            return null;
        }

        // Compare with declared layout using validation result
        LayoutComparisonResult? comparison = null;
        var validationResult = _validationEngine.ValidateByName(singletonName);
        if (validationResult != null)
        {
            comparison = LayoutComparator.Compare(layout, validationResult);
        }

        // Detect array patterns
        List<Models.ArrayPattern>? detectedArrays = null;
        try
        {
            var patternResult = PatternRecognizer.DetectPatterns(address, size);
            if (patternResult.ArrayPatterns.Count > 0)
            {
                detectedArrays = patternResult.ArrayPatterns.Select(p => new Models.ArrayPattern
                {
                    Offset = p.StartOffset,
                    Stride = p.Stride,
                    Count = p.Count,
                    Confidence = p.Confidence
                }).ToList();
            }
        }
        catch (Exception ex)
        {
            _log.Debug($"Array detection failed for {singletonName}: {ex.Message}");
        }

        return new AnalysisResult
        {
            StructName = singletonName,
            Address = address,
            AddressHex = $"0x{address:X}",
            Timestamp = DateTime.UtcNow,
            GameVersion = _validationEngine.GameVersion,
            Discovery = layout,
            Comparison = comparison,
            DetectedArrays = detectedArrays
        };
    }

    /// <summary>
    /// Get a summary of batch analysis results.
    /// </summary>
    public static BatchSummary GetSummary(IEnumerable<BatchProgress> results)
    {
        var completed = results.Where(r => r.State != AnalysisState.InProgress).ToList();

        return new BatchSummary
        {
            TotalAnalyzed = completed.Count,
            PerfectMatches = completed.Count(r => r.State == AnalysisState.Match),
            TypeMismatches = completed.Count(r => r.State == AnalysisState.Mismatch),
            SizeErrors = completed.Count(r => r.State == AnalysisState.SizeError),
            Undocumented = completed.Count(r => r.State == AnalysisState.Undocumented),
            Unavailable = completed.Count(r => r.State == AnalysisState.Unavailable),
            Errors = completed.Count(r => r.State == AnalysisState.Error)
        };
    }
}

/// <summary>
/// Progress report for batch analysis.
/// </summary>
public class BatchProgress
{
    /// <summary>
    /// Current struct number (1-based).
    /// </summary>
    public int Current { get; init; }

    /// <summary>
    /// Total number of structs to analyze.
    /// </summary>
    public int Total { get; init; }

    /// <summary>
    /// Name of the current struct.
    /// </summary>
    public string StructName { get; init; } = "";

    /// <summary>
    /// Current analysis state.
    /// </summary>
    public AnalysisState State { get; init; }

    /// <summary>
    /// Analysis result (null if in progress or unavailable).
    /// </summary>
    public AnalysisResult? Result { get; init; }

    /// <summary>
    /// Progress percentage (0-100).
    /// </summary>
    public float ProgressPercent => Total > 0 ? (float)Current / Total * 100 : 0;
}

/// <summary>
/// Analysis state for a single struct.
/// </summary>
public enum AnalysisState
{
    /// <summary>
    /// Analysis in progress.
    /// </summary>
    InProgress,

    /// <summary>
    /// All declared fields match discovered memory layout.
    /// </summary>
    Match,

    /// <summary>
    /// Type mismatches found.
    /// </summary>
    Mismatch,

    /// <summary>
    /// Struct size doesn't match.
    /// </summary>
    SizeError,

    /// <summary>
    /// Undocumented fields found (but no errors).
    /// </summary>
    Undocumented,

    /// <summary>
    /// Singleton not available (null pointer).
    /// </summary>
    Unavailable,

    /// <summary>
    /// Error during analysis.
    /// </summary>
    Error
}

/// <summary>
/// Summary of batch analysis results.
/// </summary>
public class BatchSummary
{
    public int TotalAnalyzed { get; init; }
    public int PerfectMatches { get; init; }
    public int TypeMismatches { get; init; }
    public int SizeErrors { get; init; }
    public int Undocumented { get; init; }
    public int Unavailable { get; init; }
    public int Errors { get; init; }

    /// <summary>
    /// Number of structs with issues (mismatches, size errors, or undocumented fields).
    /// </summary>
    public int WithIssues => TypeMismatches + SizeErrors + Undocumented;
}
