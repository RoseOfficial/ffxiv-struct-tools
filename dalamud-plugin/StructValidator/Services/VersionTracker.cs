using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Dalamud.Plugin.Services;
using StructValidator.Models;
using StructValidator.Services.Persistence;

namespace StructValidator.Services;

/// <summary>
/// Service for tracking struct changes across game versions.
/// Provides auto-snapshot, version detection, and diff analysis.
/// </summary>
public class VersionTracker
{
    private readonly VersionStore _versionStore;
    private readonly StructValidationEngine _validationEngine;
    private readonly IPluginLog _log;

    private string? _lastKnownVersion;
    private bool _autoSnapshotEnabled = true;

    /// <summary>
    /// Event raised when a version change is detected.
    /// </summary>
    public event Action<string, string>? VersionChanged;

    /// <summary>
    /// Event raised when an auto-snapshot is created.
    /// </summary>
    public event Action<VersionSnapshot>? SnapshotCreated;

    public VersionTracker(
        VersionStore versionStore,
        StructValidationEngine validationEngine,
        IPluginLog log)
    {
        _versionStore = versionStore;
        _validationEngine = validationEngine;
        _log = log;
    }

    /// <summary>
    /// Gets or sets whether auto-snapshot is enabled on version change.
    /// </summary>
    public bool AutoSnapshotEnabled
    {
        get => _autoSnapshotEnabled;
        set => _autoSnapshotEnabled = value;
    }

    /// <summary>
    /// Gets the current game version.
    /// </summary>
    public string CurrentVersion => _validationEngine.GameVersion;

    /// <summary>
    /// Gets all available version snapshots.
    /// </summary>
    public IEnumerable<string> GetAvailableVersions()
    {
        return _versionStore.ListKeys();
    }

    /// <summary>
    /// Initialize tracker with the current version.
    /// </summary>
    public void Initialize()
    {
        _lastKnownVersion = CurrentVersion;
        _log.Info($"VersionTracker initialized with version {_lastKnownVersion}");
    }

    /// <summary>
    /// Check for version changes and handle accordingly.
    /// Call this periodically or on specific events.
    /// </summary>
    public async Task CheckForVersionChangeAsync()
    {
        var currentVersion = CurrentVersion;

        if (_lastKnownVersion != null && _lastKnownVersion != currentVersion)
        {
            _log.Info($"Version change detected: {_lastKnownVersion} -> {currentVersion}");

            if (_autoSnapshotEnabled)
            {
                // Create snapshot of current version before it's lost
                await CreateSnapshotAsync(currentVersion);
            }

            VersionChanged?.Invoke(_lastKnownVersion, currentVersion);
        }

        _lastKnownVersion = currentVersion;
    }

    /// <summary>
    /// Create a snapshot of the current struct state.
    /// </summary>
    public async Task<VersionSnapshot> CreateSnapshotAsync(string? version = null)
    {
        version ??= CurrentVersion;

        _log.Info($"Creating snapshot for version {version}");

        var snapshot = new VersionSnapshot
        {
            GameVersion = version,
            Timestamp = DateTime.UtcNow,
            Structs = new List<StructSnapshot>()
        };

        // Get all singleton names and create snapshots
        var singletonNames = _validationEngine.GetSingletonNames().ToList();

        foreach (var name in singletonNames)
        {
            try
            {
                var validation = _validationEngine.ValidateByName(name);
                if (validation == null) continue;

                var structSnapshot = new StructSnapshot
                {
                    Name = name.Split('.').Last(),
                    FullName = name,
                    Size = validation.ActualSize ?? validation.DeclaredSize,
                    Fields = new List<FieldSnapshot>()
                };

                if (validation.FieldValidations != null)
                {
                    foreach (var field in validation.FieldValidations)
                    {
                        structSnapshot.Fields.Add(new FieldSnapshot
                        {
                            Name = field.Name ?? $"Unknown_0x{field.Offset:X}",
                            Offset = field.Offset,
                            Type = field.Type ?? "unknown",
                            Size = field.Size
                        });
                    }
                }

                snapshot.Structs.Add(structSnapshot);
            }
            catch (Exception ex)
            {
                _log.Debug($"Failed to snapshot {name}: {ex.Message}");
            }
        }

        // Save to store
        await _versionStore.SaveAsync(version, snapshot);

        _log.Info($"Snapshot created with {snapshot.Structs.Count} structs");

        SnapshotCreated?.Invoke(snapshot);

        return snapshot;
    }

    /// <summary>
    /// Load a snapshot for a specific version.
    /// </summary>
    public async Task<VersionSnapshot?> LoadSnapshotAsync(string version)
    {
        return await _versionStore.LoadAsync(version);
    }

    /// <summary>
    /// Compare two versions and return the differences.
    /// </summary>
    public async Task<VersionDiff?> CompareVersionsAsync(string oldVersion, string newVersion)
    {
        return await _versionStore.CompareVersionsAsync(oldVersion, newVersion);
    }

    /// <summary>
    /// Delete a version snapshot.
    /// </summary>
    public async Task DeleteSnapshotAsync(string version)
    {
        await _versionStore.DeleteAsync(version);
        _log.Info($"Deleted snapshot for version {version}");
    }

    /// <summary>
    /// Get a summary of changes between two versions.
    /// </summary>
    public async Task<VersionChangeSummary?> GetChangeSummaryAsync(string oldVersion, string newVersion)
    {
        var diff = await CompareVersionsAsync(oldVersion, newVersion);
        if (diff == null) return null;

        return new VersionChangeSummary
        {
            OldVersion = oldVersion,
            NewVersion = newVersion,
            TotalSizeChanges = diff.SizeChanges?.Count ?? 0,
            TotalOffsetPatterns = diff.OffsetPatterns?.Count ?? 0,
            TotalVTableChanges = diff.VTableChanges?.Count ?? 0,
            NewStructCount = diff.NewStructs?.Count ?? 0,
            RemovedStructCount = diff.RemovedStructs?.Count ?? 0,
            AffectedStructs = GetAffectedStructs(diff)
        };
    }

    private List<string> GetAffectedStructs(VersionDiff diff)
    {
        var affected = new HashSet<string>();

        if (diff.SizeChanges != null)
        {
            foreach (var change in diff.SizeChanges)
            {
                affected.Add(change.StructName);
            }
        }

        if (diff.OffsetPatterns != null)
        {
            foreach (var pattern in diff.OffsetPatterns)
            {
                if (pattern.AffectedStructs != null)
                {
                    foreach (var s in pattern.AffectedStructs)
                    {
                        affected.Add(s);
                    }
                }
            }
        }

        if (diff.VTableChanges != null)
        {
            foreach (var change in diff.VTableChanges)
            {
                affected.Add(change.StructName);
            }
        }

        return affected.OrderBy(s => s).ToList();
    }
}

/// <summary>
/// Summary of changes between two versions.
/// </summary>
public class VersionChangeSummary
{
    public string OldVersion { get; set; } = "";
    public string NewVersion { get; set; } = "";
    public int TotalSizeChanges { get; set; }
    public int TotalOffsetPatterns { get; set; }
    public int TotalVTableChanges { get; set; }
    public int NewStructCount { get; set; }
    public int RemovedStructCount { get; set; }
    public List<string> AffectedStructs { get; set; } = new();
}
