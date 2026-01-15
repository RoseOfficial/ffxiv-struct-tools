using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Text;
using System.Threading.Tasks;
using Dalamud.Interface.Windowing;
using Dalamud.Bindings.ImGui;
using Dalamud.Plugin.Services;
using StructValidator.Models;
using StructValidator.Services;

namespace StructValidator.UI;

/// <summary>
/// Window for viewing and comparing version history.
/// </summary>
public class VersionHistoryWindow : Window, IDisposable
{
    private readonly VersionTracker _versionTracker;
    private readonly IPluginLog _log;

    // State
    private List<string> _availableVersions = new();
    private int _selectedVersionIndex = -1;
    private int _compareVersionIndex = -1;
    private VersionSnapshot? _selectedSnapshot;
    private VersionDiff? _currentDiff;
    private VersionChangeSummary? _changeSummary;
    private string _statusMessage = "";
    private bool _isLoading;

    // Filter state
    private string _structFilter = "";
    private bool _showSizeChangesOnly;
    private bool _showOffsetPatternsOnly;

    public VersionHistoryWindow(VersionTracker versionTracker, IPluginLog log)
        : base("Version History##VersionHistory", ImGuiWindowFlags.None)
    {
        _versionTracker = versionTracker;
        _log = log;

        SizeConstraints = new WindowSizeConstraints
        {
            MinimumSize = new Vector2(800, 600),
            MaximumSize = new Vector2(float.MaxValue, float.MaxValue)
        };

        // Subscribe to events
        _versionTracker.VersionChanged += OnVersionChanged;
        _versionTracker.SnapshotCreated += OnSnapshotCreated;
    }

    public void Dispose()
    {
        _versionTracker.VersionChanged -= OnVersionChanged;
        _versionTracker.SnapshotCreated -= OnSnapshotCreated;
    }

    private void OnVersionChanged(string oldVersion, string newVersion)
    {
        _statusMessage = $"Version changed: {oldVersion} -> {newVersion}";
        RefreshVersionList();
    }

    private void OnSnapshotCreated(VersionSnapshot snapshot)
    {
        _statusMessage = $"Snapshot created for version {snapshot.GameVersion}";
        RefreshVersionList();
    }

    public override void OnOpen()
    {
        base.OnOpen();
        RefreshVersionList();
    }

    private void RefreshVersionList()
    {
        _availableVersions = _versionTracker.GetAvailableVersions().OrderByDescending(v => v).ToList();
    }

    public override void Draw()
    {
        DrawToolbar();
        ImGui.Separator();

        var availHeight = ImGui.GetContentRegionAvail().Y - 30;

        if (ImGui.BeginChild("VersionContent", new Vector2(-1, availHeight), false))
        {
            // Left panel: Version list
            if (ImGui.BeginChild("VersionList", new Vector2(250, -1), true))
            {
                DrawVersionList();
            }
            ImGui.EndChild();

            ImGui.SameLine();

            // Right panel: Details/Comparison
            if (ImGui.BeginChild("DetailsPanel", new Vector2(-1, -1), true))
            {
                if (_currentDiff != null && _changeSummary != null)
                {
                    DrawComparisonResults();
                }
                else if (_selectedSnapshot != null)
                {
                    DrawSnapshotDetails();
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f),
                        "Select a version to view details or compare versions.");
                }
            }
            ImGui.EndChild();
        }
        ImGui.EndChild();

        // Status bar
        if (!string.IsNullOrEmpty(_statusMessage))
        {
            ImGui.Separator();
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 1.0f, 1.0f), _statusMessage);
        }
    }

    private void DrawToolbar()
    {
        ImGui.Text($"Current Version: {_versionTracker.CurrentVersion}");
        ImGui.SameLine();

        if (ImGui.Button("Create Snapshot"))
        {
            _ = CreateSnapshotAsync();
        }

        ImGui.SameLine();

        if (ImGui.Button("Refresh"))
        {
            RefreshVersionList();
        }

        ImGui.SameLine();

        var autoSnapshot = _versionTracker.AutoSnapshotEnabled;
        if (ImGui.Checkbox("Auto-snapshot on version change", ref autoSnapshot))
        {
            _versionTracker.AutoSnapshotEnabled = autoSnapshot;
        }

        if (_selectedVersionIndex >= 0 && _compareVersionIndex >= 0 &&
            _selectedVersionIndex != _compareVersionIndex)
        {
            ImGui.SameLine();
            if (ImGui.Button("Export Diff Report"))
            {
                ExportDiffReport();
            }
        }
    }

    private void DrawVersionList()
    {
        ImGui.Text("Snapshots:");
        ImGui.Separator();

        if (_availableVersions.Count == 0)
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f),
                "No snapshots available.\nCreate a snapshot to start tracking.");
            return;
        }

        for (int i = 0; i < _availableVersions.Count; i++)
        {
            var version = _availableVersions[i];
            var isSelected = i == _selectedVersionIndex;
            var isCompare = i == _compareVersionIndex;

            var label = version;
            if (version == _versionTracker.CurrentVersion)
            {
                label += " [Current]";
            }

            // Selection indicator
            if (isSelected)
            {
                ImGui.PushStyleColor(ImGuiCol.Text, new Vector4(0.5f, 1.0f, 0.5f, 1.0f));
            }
            else if (isCompare)
            {
                ImGui.PushStyleColor(ImGuiCol.Text, new Vector4(0.5f, 0.8f, 1.0f, 1.0f));
            }

            if (ImGui.Selectable($"{label}##version{i}", isSelected || isCompare))
            {
                if (ImGui.GetIO().KeyCtrl && _selectedVersionIndex >= 0)
                {
                    // Ctrl+click to select for comparison
                    _compareVersionIndex = i;
                    _ = CompareVersionsAsync();
                }
                else
                {
                    _selectedVersionIndex = i;
                    _compareVersionIndex = -1;
                    _currentDiff = null;
                    _changeSummary = null;
                    _ = LoadSnapshotAsync(version);
                }
            }

            if (isSelected || isCompare)
            {
                ImGui.PopStyleColor();
            }

            // Context menu
            if (ImGui.BeginPopupContextItem($"version_context_{i}"))
            {
                if (ImGui.MenuItem("View Details"))
                {
                    _selectedVersionIndex = i;
                    _ = LoadSnapshotAsync(version);
                }

                if (_selectedVersionIndex >= 0 && _selectedVersionIndex != i)
                {
                    if (ImGui.MenuItem("Compare with Selected"))
                    {
                        _compareVersionIndex = i;
                        _ = CompareVersionsAsync();
                    }
                }

                ImGui.Separator();

                if (ImGui.MenuItem("Delete", version != _versionTracker.CurrentVersion))
                {
                    _ = DeleteSnapshotAsync(version);
                }

                ImGui.EndPopup();
            }

            // Show hint
            if (ImGui.IsItemHovered())
            {
                ImGui.SetTooltip("Click to select\nCtrl+Click to compare with selected\nRight-click for options");
            }
        }

        ImGui.Separator();
        ImGui.TextColored(new Vector4(0.5f, 1.0f, 0.5f, 1.0f), "● Selected");
        ImGui.TextColored(new Vector4(0.5f, 0.8f, 1.0f, 1.0f), "● Compare");
    }

    private void DrawSnapshotDetails()
    {
        if (_selectedSnapshot == null) return;

        ImGui.Text($"Version: {_selectedSnapshot.GameVersion}");
        ImGui.Text($"Created: {_selectedSnapshot.Timestamp:yyyy-MM-dd HH:mm:ss}");
        ImGui.Text($"Structs: {_selectedSnapshot.Structs.Count}");
        ImGui.Separator();

        // Filter
        ImGui.SetNextItemWidth(200);
        ImGui.InputTextWithHint("##StructFilter", "Search structs...", ref _structFilter, 64);

        ImGui.Separator();

        // Struct list
        if (ImGui.BeginTable("SnapshotStructs", 3,
            ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg | ImGuiTableFlags.ScrollY))
        {
            ImGui.TableSetupColumn("Struct", ImGuiTableColumnFlags.None, 200);
            ImGui.TableSetupColumn("Size", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupColumn("Fields", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupScrollFreeze(0, 1);
            ImGui.TableHeadersRow();

            var filter = _structFilter.ToLowerInvariant();

            foreach (var s in _selectedSnapshot.Structs.OrderBy(x => x.Name))
            {
                if (!string.IsNullOrEmpty(filter) &&
                    !s.Name.ToLowerInvariant().Contains(filter))
                    continue;

                ImGui.TableNextRow();

                ImGui.TableNextColumn();
                ImGui.Text(s.Name);

                if (ImGui.IsItemHovered() && !string.IsNullOrEmpty(s.FullName))
                {
                    ImGui.SetTooltip(s.FullName);
                }

                ImGui.TableNextColumn();
                ImGui.Text($"0x{s.Size:X}");

                ImGui.TableNextColumn();
                ImGui.Text(s.Fields.Count.ToString());
            }

            ImGui.EndTable();
        }
    }

    private void DrawComparisonResults()
    {
        if (_changeSummary == null || _currentDiff == null) return;

        // Header
        ImGui.TextColored(new Vector4(1.0f, 0.8f, 0.3f, 1.0f),
            $"Changes: {_changeSummary.OldVersion} → {_changeSummary.NewVersion}");
        ImGui.Separator();

        // Summary stats
        ImGui.Columns(5, "SummaryColumns", false);

        DrawStatBox("Size Changes", _changeSummary.TotalSizeChanges,
            _changeSummary.TotalSizeChanges > 0 ? new Vector4(1f, 0.5f, 0.5f, 1f) : new Vector4(0.5f, 1f, 0.5f, 1f));
        ImGui.NextColumn();

        DrawStatBox("Offset Patterns", _changeSummary.TotalOffsetPatterns,
            _changeSummary.TotalOffsetPatterns > 0 ? new Vector4(1f, 0.8f, 0.3f, 1f) : new Vector4(0.5f, 1f, 0.5f, 1f));
        ImGui.NextColumn();

        DrawStatBox("VTable Changes", _changeSummary.TotalVTableChanges,
            _changeSummary.TotalVTableChanges > 0 ? new Vector4(1f, 0.8f, 0.3f, 1f) : new Vector4(0.5f, 1f, 0.5f, 1f));
        ImGui.NextColumn();

        DrawStatBox("New Structs", _changeSummary.NewStructCount,
            new Vector4(0.3f, 0.7f, 1f, 1f));
        ImGui.NextColumn();

        DrawStatBox("Removed", _changeSummary.RemovedStructCount,
            _changeSummary.RemovedStructCount > 0 ? new Vector4(1f, 0.5f, 0.5f, 1f) : new Vector4(0.7f, 0.7f, 0.7f, 1f));

        ImGui.Columns(1);
        ImGui.Separator();

        // Filters
        ImGui.Checkbox("Size Changes Only", ref _showSizeChangesOnly);
        ImGui.SameLine();
        ImGui.Checkbox("Offset Patterns Only", ref _showOffsetPatternsOnly);

        ImGui.Separator();

        // Tabbed detail view
        if (ImGui.BeginTabBar("DiffTabs"))
        {
            if (ImGui.BeginTabItem("Size Changes"))
            {
                DrawSizeChanges();
                ImGui.EndTabItem();
            }

            if (ImGui.BeginTabItem("Offset Patterns"))
            {
                DrawOffsetPatterns();
                ImGui.EndTabItem();
            }

            if (ImGui.BeginTabItem("VTable Changes"))
            {
                DrawVTableChanges();
                ImGui.EndTabItem();
            }

            if (ImGui.BeginTabItem("New/Removed"))
            {
                DrawNewRemovedStructs();
                ImGui.EndTabItem();
            }

            ImGui.EndTabBar();
        }
    }

    private void DrawSizeChanges()
    {
        if (_currentDiff?.SizeChanges == null || _currentDiff.SizeChanges.Count == 0)
        {
            ImGui.TextColored(new Vector4(0.5f, 1f, 0.5f, 1f), "No size changes detected.");
            return;
        }

        if (ImGui.BeginTable("SizeChanges", 4,
            ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg | ImGuiTableFlags.ScrollY))
        {
            ImGui.TableSetupColumn("Struct", ImGuiTableColumnFlags.None, 200);
            ImGui.TableSetupColumn("Old Size", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupColumn("New Size", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupColumn("Delta", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupScrollFreeze(0, 1);
            ImGui.TableHeadersRow();

            foreach (var change in _currentDiff.SizeChanges.OrderBy(c => c.StructName))
            {
                ImGui.TableNextRow();

                ImGui.TableNextColumn();
                ImGui.Text(change.StructName);

                ImGui.TableNextColumn();
                ImGui.Text($"0x{change.OldSize:X}");

                ImGui.TableNextColumn();
                ImGui.Text($"0x{change.NewSize:X}");

                ImGui.TableNextColumn();
                var delta = change.NewSize - change.OldSize;
                var deltaColor = delta > 0
                    ? new Vector4(0.3f, 0.7f, 1f, 1f)
                    : new Vector4(1f, 0.5f, 0.5f, 1f);
                ImGui.TextColored(deltaColor, $"{(delta >= 0 ? "+" : "")}{delta:+0x0;-0x0}");
            }

            ImGui.EndTable();
        }
    }

    private void DrawOffsetPatterns()
    {
        if (_currentDiff?.OffsetPatterns == null || _currentDiff.OffsetPatterns.Count == 0)
        {
            ImGui.TextColored(new Vector4(0.5f, 1f, 0.5f, 1f), "No bulk offset patterns detected.");
            return;
        }

        foreach (var pattern in _currentDiff.OffsetPatterns)
        {
            var headerColor = pattern.Confidence >= 0.9f
                ? new Vector4(0.5f, 1f, 0.5f, 1f)
                : pattern.Confidence >= 0.7f
                    ? new Vector4(1f, 0.8f, 0.3f, 1f)
                    : new Vector4(1f, 0.5f, 0.5f, 1f);

            ImGui.PushStyleColor(ImGuiCol.Header, new Vector4(0.2f, 0.3f, 0.4f, 1f));

            var header = $"BULK SHIFT: +0x{pattern.Delta:X} from offset 0x{pattern.StartOffset:X}";
            if (ImGui.CollapsingHeader($"{header}##pattern{pattern.StartOffset}", ImGuiTreeNodeFlags.DefaultOpen))
            {
                ImGui.Indent();

                ImGui.Text($"Confidence: {pattern.Confidence:P0}");
                ImGui.SameLine();
                DrawConfidenceBar(pattern.Confidence);

                if (pattern.AffectedStructs != null && pattern.AffectedStructs.Count > 0)
                {
                    ImGui.Text($"Affected Structs ({pattern.AffectedStructs.Count}):");
                    ImGui.Indent();
                    foreach (var s in pattern.AffectedStructs)
                    {
                        ImGui.BulletText(s);
                    }
                    ImGui.Unindent();
                }

                ImGui.Unindent();
            }

            ImGui.PopStyleColor();
        }
    }

    private void DrawVTableChanges()
    {
        if (_currentDiff?.VTableChanges == null || _currentDiff.VTableChanges.Count == 0)
        {
            ImGui.TextColored(new Vector4(0.5f, 1f, 0.5f, 1f), "No VTable changes detected.");
            return;
        }

        if (ImGui.BeginTable("VTableChanges", 4,
            ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg | ImGuiTableFlags.ScrollY))
        {
            ImGui.TableSetupColumn("Struct", ImGuiTableColumnFlags.None, 200);
            ImGui.TableSetupColumn("Old Slots", ImGuiTableColumnFlags.None, 100);
            ImGui.TableSetupColumn("New Slots", ImGuiTableColumnFlags.None, 100);
            ImGui.TableSetupColumn("Shift", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupScrollFreeze(0, 1);
            ImGui.TableHeadersRow();

            foreach (var change in _currentDiff.VTableChanges.OrderBy(c => c.StructName))
            {
                ImGui.TableNextRow();

                ImGui.TableNextColumn();
                ImGui.Text(change.StructName);

                ImGui.TableNextColumn();
                ImGui.Text($"{change.OldSlotCount}");

                ImGui.TableNextColumn();
                ImGui.Text($"{change.NewSlotCount}");

                ImGui.TableNextColumn();
                if (change.SlotShift != 0)
                {
                    var shiftColor = change.SlotShift > 0
                        ? new Vector4(0.3f, 0.7f, 1f, 1f)
                        : new Vector4(1f, 0.5f, 0.5f, 1f);
                    ImGui.TextColored(shiftColor, $"{(change.SlotShift >= 0 ? "+" : "")}{change.SlotShift}");
                }
                else
                {
                    ImGui.Text("-");
                }
            }

            ImGui.EndTable();
        }
    }

    private void DrawNewRemovedStructs()
    {
        ImGui.Columns(2, "NewRemovedColumns", true);

        // New structs
        ImGui.Text("New Structs:");
        ImGui.Separator();

        if (_currentDiff?.NewStructs == null || _currentDiff.NewStructs.Count == 0)
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1f), "None");
        }
        else
        {
            foreach (var s in _currentDiff.NewStructs.OrderBy(x => x))
            {
                ImGui.TextColored(new Vector4(0.3f, 0.7f, 1f, 1f), $"+ {s}");
            }
        }

        ImGui.NextColumn();

        // Removed structs
        ImGui.Text("Removed Structs:");
        ImGui.Separator();

        if (_currentDiff?.RemovedStructs == null || _currentDiff.RemovedStructs.Count == 0)
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1f), "None");
        }
        else
        {
            foreach (var s in _currentDiff.RemovedStructs.OrderBy(x => x))
            {
                ImGui.TextColored(new Vector4(1f, 0.5f, 0.5f, 1f), $"- {s}");
            }
        }

        ImGui.Columns(1);
    }

    private void DrawStatBox(string label, int value, Vector4 color)
    {
        ImGui.TextColored(color, value.ToString());
        ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1f), label);
    }

    private void DrawConfidenceBar(float confidence)
    {
        var color = confidence >= 0.9f
            ? new Vector4(0.3f, 1.0f, 0.3f, 1.0f)
            : confidence >= 0.7f
                ? new Vector4(0.8f, 1.0f, 0.3f, 1.0f)
                : new Vector4(1.0f, 0.8f, 0.3f, 1.0f);

        ImGui.PushStyleColor(ImGuiCol.PlotHistogram, color);
        ImGui.ProgressBar(confidence, new Vector2(100, 14), $"{confidence:P0}");
        ImGui.PopStyleColor();
    }

    private async Task CreateSnapshotAsync()
    {
        if (_isLoading) return;

        _isLoading = true;
        _statusMessage = "Creating snapshot...";

        try
        {
            await _versionTracker.CreateSnapshotAsync();
            RefreshVersionList();
            _statusMessage = "Snapshot created successfully";
        }
        catch (Exception ex)
        {
            _statusMessage = $"Failed to create snapshot: {ex.Message}";
            _log.Error(ex, "Failed to create snapshot");
        }
        finally
        {
            _isLoading = false;
        }
    }

    private async Task LoadSnapshotAsync(string version)
    {
        if (_isLoading) return;

        _isLoading = true;
        _statusMessage = $"Loading snapshot {version}...";

        try
        {
            _selectedSnapshot = await _versionTracker.LoadSnapshotAsync(version);
            _statusMessage = _selectedSnapshot != null
                ? $"Loaded snapshot for {version}"
                : $"Failed to load snapshot for {version}";
        }
        catch (Exception ex)
        {
            _statusMessage = $"Failed to load snapshot: {ex.Message}";
            _log.Error(ex, $"Failed to load snapshot {version}");
        }
        finally
        {
            _isLoading = false;
        }
    }

    private async Task CompareVersionsAsync()
    {
        if (_isLoading || _selectedVersionIndex < 0 || _compareVersionIndex < 0) return;

        var oldVersion = _availableVersions[_selectedVersionIndex];
        var newVersion = _availableVersions[_compareVersionIndex];

        // Ensure old < new
        if (string.Compare(oldVersion, newVersion, StringComparison.Ordinal) > 0)
        {
            (oldVersion, newVersion) = (newVersion, oldVersion);
        }

        _isLoading = true;
        _statusMessage = $"Comparing {oldVersion} to {newVersion}...";

        try
        {
            _currentDiff = await _versionTracker.CompareVersionsAsync(oldVersion, newVersion);
            _changeSummary = await _versionTracker.GetChangeSummaryAsync(oldVersion, newVersion);
            _selectedSnapshot = null;

            _statusMessage = _currentDiff != null
                ? $"Comparison complete: {oldVersion} -> {newVersion}"
                : "Failed to compare versions";
        }
        catch (Exception ex)
        {
            _statusMessage = $"Comparison failed: {ex.Message}";
            _log.Error(ex, "Failed to compare versions");
        }
        finally
        {
            _isLoading = false;
        }
    }

    private async Task DeleteSnapshotAsync(string version)
    {
        if (_isLoading) return;

        _isLoading = true;

        try
        {
            await _versionTracker.DeleteSnapshotAsync(version);
            RefreshVersionList();

            if (_selectedVersionIndex >= 0 && _availableVersions[_selectedVersionIndex] == version)
            {
                _selectedVersionIndex = -1;
                _selectedSnapshot = null;
            }

            _statusMessage = $"Deleted snapshot for {version}";
        }
        catch (Exception ex)
        {
            _statusMessage = $"Failed to delete snapshot: {ex.Message}";
            _log.Error(ex, $"Failed to delete snapshot {version}");
        }
        finally
        {
            _isLoading = false;
        }
    }

    private void ExportDiffReport()
    {
        if (_currentDiff == null || _changeSummary == null) return;

        try
        {
            var sb = new StringBuilder();
            sb.AppendLine($"# Version Diff Report: {_changeSummary.OldVersion} -> {_changeSummary.NewVersion}");
            sb.AppendLine();
            sb.AppendLine($"Generated: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
            sb.AppendLine();

            sb.AppendLine("## Summary");
            sb.AppendLine($"- Size Changes: {_changeSummary.TotalSizeChanges}");
            sb.AppendLine($"- Offset Patterns: {_changeSummary.TotalOffsetPatterns}");
            sb.AppendLine($"- VTable Changes: {_changeSummary.TotalVTableChanges}");
            sb.AppendLine($"- New Structs: {_changeSummary.NewStructCount}");
            sb.AppendLine($"- Removed Structs: {_changeSummary.RemovedStructCount}");
            sb.AppendLine();

            if (_currentDiff.SizeChanges?.Count > 0)
            {
                sb.AppendLine("## Size Changes");
                foreach (var change in _currentDiff.SizeChanges)
                {
                    var delta = change.NewSize - change.OldSize;
                    sb.AppendLine($"- {change.StructName}: 0x{change.OldSize:X} -> 0x{change.NewSize:X} ({(delta >= 0 ? "+" : "")}{delta})");
                }
                sb.AppendLine();
            }

            if (_currentDiff.OffsetPatterns?.Count > 0)
            {
                sb.AppendLine("## Detected Offset Patterns");
                foreach (var pattern in _currentDiff.OffsetPatterns)
                {
                    sb.AppendLine($"### BULK SHIFT: +0x{pattern.Delta:X} from offset 0x{pattern.StartOffset:X}");
                    sb.AppendLine($"Confidence: {pattern.Confidence:P0}");
                    if (pattern.AffectedStructs?.Count > 0)
                    {
                        sb.AppendLine("Affected structs:");
                        foreach (var s in pattern.AffectedStructs)
                        {
                            sb.AppendLine($"  - {s}");
                        }
                    }
                    sb.AppendLine();
                }
            }

            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                $"version-diff-{_changeSummary.OldVersion}-to-{_changeSummary.NewVersion}-{DateTime.Now:yyyyMMdd-HHmmss}.md");

            File.WriteAllText(path, sb.ToString());
            _statusMessage = $"Exported to {path}";
        }
        catch (Exception ex)
        {
            _statusMessage = $"Export failed: {ex.Message}";
            _log.Error(ex, "Failed to export diff report");
        }
    }
}
