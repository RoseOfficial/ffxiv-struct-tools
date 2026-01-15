using System;
using System.Numerics;
using Dalamud.Bindings.ImGui;
using StructValidator.Services;

namespace StructValidator.UI.Components;

/// <summary>
/// ImGui panel for displaying VTable analysis results.
/// </summary>
public static class VTablePanel
{
    private static bool _showOnlyDeclared = false;
    private static bool _showOnlyUndeclared = false;
    private static string _searchFilter = "";

    /// <summary>
    /// Draw the VTable analysis panel.
    /// </summary>
    /// <param name="analysis">The VTable analysis to display.</param>
    /// <param name="onExportIDA">Callback for IDA export.</param>
    /// <param name="onExportGhidra">Callback for Ghidra export.</param>
    /// <param name="onCopyAddresses">Callback for copying addresses.</param>
    public static void Draw(
        EnhancedVTableAnalysis? analysis,
        Action<EnhancedVTableAnalysis>? onExportIDA = null,
        Action<EnhancedVTableAnalysis>? onExportGhidra = null,
        Action<EnhancedVTableAnalysis>? onCopyAddresses = null)
    {
        if (analysis == null || !analysis.IsValid)
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f), "No VTable analysis available.");
            ImGui.TextWrapped("Analyze a struct with a virtual function table to see VTable details.");
            return;
        }

        // Header with summary
        DrawHeader(analysis);

        ImGui.Separator();

        // Export buttons
        DrawExportButtons(analysis, onExportIDA, onExportGhidra, onCopyAddresses);

        ImGui.Separator();

        // Filters
        DrawFilters();

        ImGui.Separator();

        // Slot table
        DrawSlotTable(analysis);
    }

    private static void DrawHeader(EnhancedVTableAnalysis analysis)
    {
        // VTable address
        ImGui.Text("VTable Address:");
        ImGui.SameLine();
        ImGui.TextColored(new Vector4(0.8f, 0.8f, 1.0f, 1.0f), analysis.VTableAddressHex);

        if (!string.IsNullOrEmpty(analysis.StructName))
        {
            ImGui.SameLine();
            ImGui.Text(" | Struct:");
            ImGui.SameLine();
            ImGui.TextColored(new Vector4(0.8f, 1.0f, 0.8f, 1.0f), analysis.StructName);
        }

        ImGui.Spacing();

        // Statistics row
        ImGui.Columns(5, "VTableStatsColumns", false);

        DrawStatBox("Total Slots", analysis.Slots.Count, new Vector4(1f, 1f, 1f, 1f));
        ImGui.NextColumn();
        DrawStatBox("Declared", analysis.MatchedSlotCount, new Vector4(0.5f, 1f, 0.5f, 1f));
        ImGui.NextColumn();
        DrawStatBox("Undeclared", analysis.UndeclaredSlotCount, new Vector4(0.3f, 0.7f, 1f, 1f));
        ImGui.NextColumn();
        DrawStatBox("Confidence", $"{analysis.Confidence:P0}", GetConfidenceColor(analysis.Confidence));
        ImGui.NextColumn();

        ImGui.Columns(1);
    }

    private static void DrawStatBox(string label, int value, Vector4 color)
    {
        ImGui.TextColored(color, value.ToString());
        ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1f), label);
    }

    private static void DrawStatBox(string label, string value, Vector4 color)
    {
        ImGui.TextColored(color, value);
        ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1f), label);
    }

    private static void DrawExportButtons(
        EnhancedVTableAnalysis analysis,
        Action<EnhancedVTableAnalysis>? onExportIDA,
        Action<EnhancedVTableAnalysis>? onExportGhidra,
        Action<EnhancedVTableAnalysis>? onCopyAddresses)
    {
        if (onExportIDA != null && ImGui.Button("Export for IDA"))
        {
            onExportIDA(analysis);
        }

        ImGui.SameLine();

        if (onExportGhidra != null && ImGui.Button("Export for Ghidra"))
        {
            onExportGhidra(analysis);
        }

        ImGui.SameLine();

        if (onCopyAddresses != null && ImGui.Button("Copy Addresses"))
        {
            onCopyAddresses(analysis);
        }
    }

    private static void DrawFilters()
    {
        ImGui.Text("Filters:");
        ImGui.SameLine();

        ImGui.Checkbox("Declared Only", ref _showOnlyDeclared);
        if (_showOnlyDeclared) _showOnlyUndeclared = false;

        ImGui.SameLine();

        ImGui.Checkbox("Undeclared Only", ref _showOnlyUndeclared);
        if (_showOnlyUndeclared) _showOnlyDeclared = false;

        ImGui.SameLine();
        ImGui.SetNextItemWidth(150);
        ImGui.InputText("Search", ref _searchFilter, 100);
    }

    private static void DrawSlotTable(EnhancedVTableAnalysis analysis)
    {
        if (ImGui.BeginTable("VTableSlotTable", 5,
            ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg | ImGuiTableFlags.Resizable |
            ImGuiTableFlags.ScrollY | ImGuiTableFlags.Sortable))
        {
            ImGui.TableSetupColumn("Slot", ImGuiTableColumnFlags.DefaultSort, 50);
            ImGui.TableSetupColumn("Address", ImGuiTableColumnFlags.None, 140);
            ImGui.TableSetupColumn("Size", ImGuiTableColumnFlags.None, 70);
            ImGui.TableSetupColumn("Name", ImGuiTableColumnFlags.None, 150);
            ImGui.TableSetupColumn("Status", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupScrollFreeze(0, 1);
            ImGui.TableHeadersRow();

            foreach (var slot in analysis.Slots)
            {
                // Apply filters
                if (_showOnlyDeclared && !slot.IsDeclared) continue;
                if (_showOnlyUndeclared && slot.IsDeclared) continue;

                if (!string.IsNullOrEmpty(_searchFilter))
                {
                    var nameMatch = slot.DeclaredName?.Contains(_searchFilter, StringComparison.OrdinalIgnoreCase) ?? false;
                    var indexMatch = slot.Index.ToString().Contains(_searchFilter);
                    if (!nameMatch && !indexMatch) continue;
                }

                ImGui.TableNextRow();

                var statusColor = slot.IsDeclared
                    ? new Vector4(0.5f, 1f, 0.5f, 1f)
                    : new Vector4(0.3f, 0.7f, 1f, 1f);

                // Slot index
                ImGui.TableNextColumn();
                ImGui.Text(slot.Index.ToString());

                // Function address
                ImGui.TableNextColumn();
                ImGui.TextColored(new Vector4(0.8f, 0.8f, 1f, 1f), slot.FunctionAddressHex);

                // Copy address on click
                if (ImGui.IsItemClicked())
                {
                    ImGui.SetClipboardText(slot.FunctionAddressHex);
                }
                if (ImGui.IsItemHovered())
                {
                    ImGui.SetTooltip("Click to copy address");
                }

                // Estimated size
                ImGui.TableNextColumn();
                if (slot.EstimatedSize.HasValue)
                {
                    ImGui.Text($"0x{slot.EstimatedSize.Value:X}");
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1f), "-");
                }

                // Name
                ImGui.TableNextColumn();
                if (!string.IsNullOrEmpty(slot.DeclaredName))
                {
                    ImGui.Text(slot.DeclaredName);

                    // Show signature tooltip
                    if (!string.IsNullOrEmpty(slot.DeclaredSignature) && ImGui.IsItemHovered())
                    {
                        ImGui.SetTooltip(slot.DeclaredSignature);
                    }
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1f), "(unknown)");
                }

                // Status
                ImGui.TableNextColumn();
                if (slot.IsDeclared)
                {
                    ImGui.TextColored(statusColor, "Declared");
                }
                else
                {
                    ImGui.TextColored(statusColor, "New");
                }
            }

            ImGui.EndTable();
        }
    }

    private static Vector4 GetConfidenceColor(float confidence)
    {
        if (confidence >= 0.9f)
            return new Vector4(0.3f, 1.0f, 0.3f, 1.0f); // Green
        if (confidence >= 0.7f)
            return new Vector4(0.8f, 1.0f, 0.3f, 1.0f); // Yellow-green
        if (confidence >= 0.5f)
            return new Vector4(1.0f, 0.8f, 0.3f, 1.0f); // Orange
        return new Vector4(1.0f, 0.5f, 0.5f, 1.0f); // Red
    }
}
