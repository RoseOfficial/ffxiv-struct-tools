using System;

namespace StructValidator.Models;

/// <summary>
/// A saved analysis session that can be persisted and loaded.
/// </summary>
public class SavedSession
{
    /// <summary>
    /// User-provided name for this session.
    /// </summary>
    public string Name { get; init; } = "";

    /// <summary>
    /// Name of the struct that was analyzed.
    /// </summary>
    public string StructName { get; init; } = "";

    /// <summary>
    /// Game version when the session was created.
    /// </summary>
    public string GameVersion { get; init; } = "";

    /// <summary>
    /// When the session was saved.
    /// </summary>
    public DateTime Timestamp { get; init; } = DateTime.UtcNow;

    /// <summary>
    /// The full analysis result.
    /// </summary>
    public AnalysisResult? Result { get; init; }

    /// <summary>
    /// Optional notes about this session.
    /// </summary>
    public string? Notes { get; init; }

    /// <summary>
    /// Generate a storage key for this session.
    /// </summary>
    public string StorageKey => $"{Timestamp:yyyyMMdd-HHmmss}_{SanitizeName(Name)}";

    private static string SanitizeName(string name)
    {
        var sanitized = name.Replace(" ", "-").ToLowerInvariant();
        foreach (var c in System.IO.Path.GetInvalidFileNameChars())
        {
            sanitized = sanitized.Replace(c.ToString(), "");
        }
        return sanitized.Length > 50 ? sanitized[..50] : sanitized;
    }
}
