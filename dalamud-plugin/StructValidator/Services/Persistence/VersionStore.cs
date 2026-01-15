using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Dalamud.Plugin.Services;
using StructValidator.Models;

namespace StructValidator.Services.Persistence;

/// <summary>
/// Store for saving and loading version snapshots.
/// </summary>
public class VersionStore : FileDataStore<VersionSnapshot>
{
    public VersionStore(string basePath, IPluginLog log)
        : base(basePath, "versions", log)
    {
    }

    /// <summary>
    /// Get all version snapshots, sorted by version (newest first).
    /// </summary>
    public IEnumerable<string> ListVersions()
    {
        return ListKeys().OrderByDescending(v => v);
    }

    /// <summary>
    /// Get the most recent version snapshot.
    /// </summary>
    public async Task<VersionSnapshot?> GetLatestAsync()
    {
        var latestKey = ListVersions().FirstOrDefault();
        if (latestKey == null)
            return null;

        return await LoadAsync(latestKey);
    }

    /// <summary>
    /// Save a version snapshot using the game version as the key.
    /// </summary>
    public async Task SaveVersionAsync(VersionSnapshot snapshot)
    {
        await SaveAsync(snapshot.GameVersion, snapshot);
    }

    /// <summary>
    /// Compare two version snapshots and return the differences.
    /// </summary>
    public async Task<VersionDiff?> CompareVersionsAsync(string oldVersion, string newVersion)
    {
        var oldSnapshot = await LoadAsync(oldVersion);
        var newSnapshot = await LoadAsync(newVersion);

        if (oldSnapshot == null || newSnapshot == null)
            return null;

        return CompareSnapshots(oldSnapshot, newSnapshot);
    }

    /// <summary>
    /// Compare two snapshots and detect differences.
    /// </summary>
    private static VersionDiff CompareSnapshots(VersionSnapshot oldSnapshot, VersionSnapshot newSnapshot)
    {
        var diff = new VersionDiff
        {
            OldVersion = oldSnapshot.GameVersion,
            NewVersion = newSnapshot.GameVersion,
            SizeChanges = new List<SizeChange>(),
            OffsetPatterns = new List<OffsetPattern>(),
            VTableChanges = new List<VTableChange>(),
            NewStructs = new List<string>(),
            RemovedStructs = new List<string>()
        };

        var oldStructs = oldSnapshot.Structs.ToDictionary(s => s.FullName);
        var newStructs = newSnapshot.Structs.ToDictionary(s => s.FullName);

        // Find new and removed structs
        foreach (var name in newStructs.Keys.Except(oldStructs.Keys))
        {
            diff.NewStructs.Add(name);
        }

        foreach (var name in oldStructs.Keys.Except(newStructs.Keys))
        {
            diff.RemovedStructs.Add(name);
        }

        // Find size and vtable changes
        foreach (var name in oldStructs.Keys.Intersect(newStructs.Keys))
        {
            var oldStruct = oldStructs[name];
            var newStruct = newStructs[name];

            // Size changes
            if (oldStruct.Size != newStruct.Size)
            {
                diff.SizeChanges.Add(new SizeChange
                {
                    StructName = name,
                    OldSize = oldStruct.Size,
                    NewSize = newStruct.Size
                });
            }

            // VTable changes
            if (oldStruct.VTableSlotCount != newStruct.VTableSlotCount)
            {
                diff.VTableChanges.Add(new VTableChange
                {
                    StructName = name,
                    OldSlotCount = oldStruct.VTableSlotCount ?? 0,
                    NewSlotCount = newStruct.VTableSlotCount ?? 0
                });
            }
        }

        // Detect bulk offset patterns
        DetectOffsetPatterns(oldSnapshot, newSnapshot, diff);

        return diff;
    }

    /// <summary>
    /// Detect bulk offset shift patterns across structs.
    /// </summary>
    private static void DetectOffsetPatterns(VersionSnapshot oldSnapshot, VersionSnapshot newSnapshot, VersionDiff diff)
    {
        var oldStructs = oldSnapshot.Structs.ToDictionary(s => s.FullName);
        var newStructs = newSnapshot.Structs.ToDictionary(s => s.FullName);

        // Group offset changes by delta
        var deltaGroups = new Dictionary<int, List<(string Struct, string Field, int OldOffset, int NewOffset)>>();

        foreach (var name in oldStructs.Keys.Intersect(newStructs.Keys))
        {
            var oldStruct = oldStructs[name];
            var newStruct = newStructs[name];

            var oldFields = oldStruct.Fields.ToDictionary(f => f.Name);
            var newFields = newStruct.Fields.ToDictionary(f => f.Name);

            foreach (var fieldName in oldFields.Keys.Intersect(newFields.Keys))
            {
                var oldField = oldFields[fieldName];
                var newField = newFields[fieldName];

                if (oldField.Offset != newField.Offset)
                {
                    var delta = newField.Offset - oldField.Offset;

                    if (!deltaGroups.ContainsKey(delta))
                        deltaGroups[delta] = new List<(string, string, int, int)>();

                    deltaGroups[delta].Add((name, fieldName, oldField.Offset, newField.Offset));
                }
            }
        }

        // Convert significant patterns to OffsetPattern objects
        foreach (var (delta, changes) in deltaGroups)
        {
            if (changes.Count < 3) // Require at least 3 changes to be a pattern
                continue;

            var affectedStructs = changes.Select(c => c.Struct).Distinct().ToList();
            var minOffset = changes.Min(c => c.OldOffset);

            var confidence = Math.Min(1.0f, changes.Count / 10.0f); // Higher count = higher confidence

            diff.OffsetPatterns.Add(new OffsetPattern
            {
                Description = $"Bulk shift of +0x{delta:X} from offset 0x{minOffset:X}",
                Delta = delta,
                StartOffset = minOffset,
                AffectedStructs = affectedStructs,
                Confidence = confidence
            });
        }
    }
}
