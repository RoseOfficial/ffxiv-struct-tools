using System;
using System.Numerics;
using Dalamud.Bindings.ImGui;
using StructValidator.Services;
using StructValidator.Memory;

namespace StructValidator.UI.Components;

/// <summary>
/// ImGui panel for displaying and managing watched memory addresses.
/// Shows changes over time to help identify field purposes.
/// </summary>
public static class ChangeMonitorPanel
{
    private static nint _selectedWatch = 0;
    private static string _newWatchAddress = "";
    private static string _newWatchLabel = "";
    private static int _newWatchSize = 4;

    /// <summary>
    /// Draw the change monitor panel.
    /// </summary>
    /// <param name="monitor">The change monitor service.</param>
    /// <param name="onNavigateToAddress">Callback when user wants to navigate to an address.</param>
    public static void Draw(
        ChangeMonitor monitor,
        Action<nint>? onNavigateToAddress = null)
    {
        if (monitor == null)
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f), "Change monitor not available.");
            return;
        }

        // Controls
        DrawControls(monitor);

        ImGui.Separator();

        // Add new watch
        DrawAddWatchSection(monitor);

        ImGui.Separator();

        // Watched addresses list
        var watches = monitor.GetWatches();
        if (watches.Count == 0)
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f), "No addresses being watched.");
            ImGui.TextWrapped("Use the [+] button in the field list or enter an address above to start watching.");
            return;
        }

        DrawWatchList(monitor, watches, onNavigateToAddress);

        // If a watch is selected, show its history
        if (_selectedWatch != 0)
        {
            ImGui.Separator();
            DrawHistorySection(monitor, onNavigateToAddress);
        }
    }

    private static void DrawControls(ChangeMonitor monitor)
    {
        // Active toggle
        var isActive = monitor.IsActive;
        if (ImGui.Checkbox("Active", ref isActive))
        {
            monitor.IsActive = isActive;
        }

        if (ImGui.IsItemHovered())
        {
            ImGui.SetTooltip("Toggle change monitoring on/off");
        }

        ImGui.SameLine();

        // Clear all button
        if (ImGui.Button("Clear All Watches"))
        {
            monitor.ClearAll();
            _selectedWatch = 0;
        }
    }

    private static void DrawAddWatchSection(ChangeMonitor monitor)
    {
        ImGui.Text("Add Watch:");

        ImGui.SetNextItemWidth(120);
        ImGui.InputText("Address", ref _newWatchAddress, 32);

        ImGui.SameLine();

        ImGui.SetNextItemWidth(100);
        ImGui.InputText("Label", ref _newWatchLabel, 64);

        ImGui.SameLine();

        ImGui.SetNextItemWidth(60);
        ImGui.InputInt("Size", ref _newWatchSize);
        if (_newWatchSize < 1) _newWatchSize = 1;
        if (_newWatchSize > 8) _newWatchSize = 8;

        ImGui.SameLine();

        if (ImGui.Button("Add"))
        {
            if (TryParseAddress(_newWatchAddress, out var address))
            {
                var label = string.IsNullOrEmpty(_newWatchLabel) ? $"0x{address:X}" : _newWatchLabel;
                monitor.WatchAddress(address, _newWatchSize, label);
                _newWatchAddress = "";
                _newWatchLabel = "";
            }
        }
    }

    private static void DrawWatchList(
        ChangeMonitor monitor,
        System.Collections.Generic.IReadOnlyList<WatchedAddress> watches,
        Action<nint>? onNavigateToAddress)
    {
        ImGui.Text($"Watched Addresses ({watches.Count}):");

        if (ImGui.BeginTable("WatchList", 7,
            ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg | ImGuiTableFlags.Resizable |
            ImGuiTableFlags.ScrollY, new Vector2(0, 200)))
        {
            ImGui.TableSetupColumn("", ImGuiTableColumnFlags.WidthFixed, 20); // Select
            ImGui.TableSetupColumn("Label", ImGuiTableColumnFlags.None, 100);
            ImGui.TableSetupColumn("Address", ImGuiTableColumnFlags.None, 100);
            ImGui.TableSetupColumn("Size", ImGuiTableColumnFlags.WidthFixed, 40);
            ImGui.TableSetupColumn("Current Value", ImGuiTableColumnFlags.None, 150);
            ImGui.TableSetupColumn("Changes", ImGuiTableColumnFlags.WidthFixed, 60);
            ImGui.TableSetupColumn("Actions", ImGuiTableColumnFlags.WidthFixed, 80);
            ImGui.TableSetupScrollFreeze(0, 1);
            ImGui.TableHeadersRow();

            foreach (var watch in watches)
            {
                ImGui.TableNextRow();

                var isSelected = _selectedWatch == watch.Address;

                // Selection
                ImGui.TableNextColumn();
                if (ImGui.RadioButton($"##{watch.Address:X}", isSelected))
                {
                    _selectedWatch = watch.Address;
                }

                // Label
                ImGui.TableNextColumn();
                ImGui.Text(watch.Label);

                // Address
                ImGui.TableNextColumn();
                ImGui.TextColored(new Vector4(0.8f, 0.8f, 1.0f, 1.0f), $"0x{watch.Address:X}");
                if (ImGui.IsItemClicked())
                {
                    ImGui.SetClipboardText($"0x{watch.Address:X}");
                }
                if (ImGui.IsItemHovered())
                {
                    ImGui.SetTooltip("Click to copy");
                }

                // Size
                ImGui.TableNextColumn();
                ImGui.Text(watch.Size.ToString());

                // Current value (hex)
                ImGui.TableNextColumn();
                var hexValue = BitConverter.ToString(watch.LastValue).Replace("-", " ");
                ImGui.Text(hexValue);

                // Show interpretations tooltip
                if (ImGui.IsItemHovered())
                {
                    var interp = watch.GetInterpretations();
                    ImGui.BeginTooltip();
                    ImGui.Text("Interpretations:");
                    ImGui.Separator();
                    if (interp.AsInt32 != null) ImGui.Text($"Int32: {interp.AsInt32}");
                    if (interp.AsUInt32 != null) ImGui.Text($"UInt32: {interp.AsUInt32}");
                    if (interp.AsFloat != null) ImGui.Text($"Float: {interp.AsFloat}");
                    if (interp.AsPointer != null) ImGui.Text($"Pointer: {interp.AsPointer}");
                    ImGui.EndTooltip();
                }

                // Change count
                ImGui.TableNextColumn();
                if (watch.ChangeCount > 0)
                {
                    ImGui.TextColored(new Vector4(1.0f, 0.8f, 0.3f, 1.0f), watch.ChangeCount.ToString());
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1.0f), "0");
                }

                // Actions
                ImGui.TableNextColumn();

                if (onNavigateToAddress != null)
                {
                    if (ImGui.SmallButton($"Go##{watch.Address:X}"))
                    {
                        onNavigateToAddress(watch.Address);
                    }
                    ImGui.SameLine();
                }

                if (ImGui.SmallButton($"X##{watch.Address:X}"))
                {
                    monitor.UnwatchAddress(watch.Address);
                    if (_selectedWatch == watch.Address)
                    {
                        _selectedWatch = 0;
                    }
                }
            }

            ImGui.EndTable();
        }
    }

    private static void DrawHistorySection(ChangeMonitor monitor, Action<nint>? onNavigateToAddress)
    {
        var watch = monitor.GetWatch(_selectedWatch);
        if (watch == null)
        {
            _selectedWatch = 0;
            return;
        }

        ImGui.Text($"Change History for: {watch.Label}");

        ImGui.SameLine();
        if (ImGui.SmallButton("Clear History"))
        {
            monitor.ClearHistory(_selectedWatch);
        }

        var history = monitor.GetHistory(_selectedWatch);
        if (history.Count == 0)
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f), "No changes recorded yet.");
            return;
        }

        if (ImGui.BeginTable("ChangeHistory", 4,
            ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg | ImGuiTableFlags.ScrollY,
            new Vector2(0, 150)))
        {
            ImGui.TableSetupColumn("Time", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupColumn("Previous", ImGuiTableColumnFlags.None, 150);
            ImGui.TableSetupColumn("New", ImGuiTableColumnFlags.None, 150);
            ImGui.TableSetupColumn("Delta", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupScrollFreeze(0, 1);
            ImGui.TableHeadersRow();

            // Show most recent first
            for (int i = history.Count - 1; i >= 0; i--)
            {
                var record = history[i];
                ImGui.TableNextRow();

                // Time
                ImGui.TableNextColumn();
                ImGui.Text(record.Timestamp.ToString("HH:mm:ss.fff"));

                // Previous value
                ImGui.TableNextColumn();
                ImGui.Text(record.PreviousHex);

                // Tooltip with interpretations
                if (ImGui.IsItemHovered() && record.PreviousValue.Length >= 4)
                {
                    ImGui.BeginTooltip();
                    ImGui.Text($"Int32: {BitConverter.ToInt32(record.PreviousValue, 0)}");
                    ImGui.Text($"Float: {BitConverter.ToSingle(record.PreviousValue, 0):G6}");
                    ImGui.EndTooltip();
                }

                // New value
                ImGui.TableNextColumn();
                ImGui.TextColored(new Vector4(0.5f, 1.0f, 0.5f, 1.0f), record.NewHex);

                // Tooltip with interpretations
                if (ImGui.IsItemHovered() && record.NewValue.Length >= 4)
                {
                    ImGui.BeginTooltip();
                    ImGui.Text($"Int32: {BitConverter.ToInt32(record.NewValue, 0)}");
                    ImGui.Text($"Float: {BitConverter.ToSingle(record.NewValue, 0):G6}");
                    ImGui.EndTooltip();
                }

                // Time since last change
                ImGui.TableNextColumn();
                if (record.TimeSinceLastChange.TotalSeconds > 0)
                {
                    ImGui.Text($"+{record.TimeSinceLastChange.TotalSeconds:F2}s");
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1.0f), "-");
                }
            }

            ImGui.EndTable();
        }
    }

    private static bool TryParseAddress(string input, out nint address)
    {
        address = 0;
        if (string.IsNullOrWhiteSpace(input))
            return false;

        input = input.Trim();

        // Handle hex prefix
        if (input.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
        {
            input = input[2..];
        }

        if (long.TryParse(input, System.Globalization.NumberStyles.HexNumber, null, out var value))
        {
            address = (nint)value;
            return true;
        }

        return false;
    }

    /// <summary>
    /// Helper method for other UI to add a watch.
    /// </summary>
    public static void AddWatch(ChangeMonitor monitor, nint address, int size, string label)
    {
        monitor?.WatchAddress(address, size, label);
    }
}
