using System.Linq;
using System.Numerics;
using Dalamud.Bindings.ImGui;
using StructValidator.Discovery;

namespace StructValidator.UI.Components;

/// <summary>
/// ImGui panel for displaying side-by-side comparison of discovered vs declared fields.
/// </summary>
public static class ComparisonPanel
{
    /// <summary>
    /// Draw the comparison panel.
    /// </summary>
    /// <param name="comparison">The comparison result to display.</param>
    /// <param name="layout">The discovered layout for additional context.</param>
    /// <returns>True if the panel is open, false if closed.</returns>
    public static void Draw(LayoutComparisonResult? comparison, DiscoveredLayout? layout)
    {
        if (comparison == null)
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f), "No comparison data available.");
            ImGui.TextWrapped("Analyze a singleton struct to see the comparison between discovered memory layout and FFXIVClientStructs declarations.");
            return;
        }

        // Summary header
        DrawSummary(comparison);

        ImGui.Separator();

        // Filter options
        DrawFilters(out var showMatches, out var showMismatches, out var showMissing, out var showUndocumented);

        ImGui.Separator();

        // Comparison table
        DrawComparisonTable(comparison, showMatches, showMismatches, showMissing, showUndocumented);
    }

    private static bool _showMatches = true;
    private static bool _showMismatches = true;
    private static bool _showMissing = false;
    private static bool _showUndocumented = true;

    private static void DrawFilters(out bool showMatches, out bool showMismatches, out bool showMissing, out bool showUndocumented)
    {
        ImGui.Checkbox("Matches", ref _showMatches);
        ImGui.SameLine();
        ImGui.Checkbox("Mismatches", ref _showMismatches);
        ImGui.SameLine();
        ImGui.Checkbox("Missing", ref _showMissing);
        ImGui.SameLine();
        ImGui.Checkbox("Undocumented", ref _showUndocumented);

        showMatches = _showMatches;
        showMismatches = _showMismatches;
        showMissing = _showMissing;
        showUndocumented = _showUndocumented;
    }

    private static void DrawSummary(LayoutComparisonResult comparison)
    {
        // Size comparison
        ImGui.Text($"Struct: ");
        ImGui.SameLine();
        ImGui.TextColored(new Vector4(0.8f, 0.8f, 1.0f, 1.0f), comparison.StructName);

        if (comparison.DeclaredSize.HasValue && comparison.AnalyzedSize.HasValue)
        {
            ImGui.SameLine();
            ImGui.Text(" | Size: ");
            ImGui.SameLine();

            if (comparison.SizeMatches)
            {
                ImGui.TextColored(new Vector4(0.5f, 1.0f, 0.5f, 1.0f), $"0x{comparison.DeclaredSize.Value:X} (match)");
            }
            else
            {
                ImGui.TextColored(new Vector4(1.0f, 0.5f, 0.5f, 1.0f),
                    $"Declared: 0x{comparison.DeclaredSize.Value:X}, Actual: 0x{comparison.AnalyzedSize.Value:X}");
            }
        }

        // Stats row
        ImGui.Spacing();

        var matchColor = new Vector4(0.5f, 1.0f, 0.5f, 1.0f);
        var mismatchColor = new Vector4(1.0f, 0.8f, 0.3f, 1.0f);
        var missingColor = new Vector4(0.7f, 0.7f, 0.7f, 1.0f);
        var undocColor = new Vector4(0.3f, 0.7f, 1.0f, 1.0f);

        DrawStatBox("Match", comparison.MatchCount, matchColor);
        ImGui.SameLine();
        DrawStatBox("Mismatch", comparison.MismatchCount, mismatchColor);
        ImGui.SameLine();
        DrawStatBox("Missing", comparison.MissingCount, missingColor);
        ImGui.SameLine();
        DrawStatBox("Undocumented", comparison.UndocumentedCount, undocColor);

        // Overall status
        ImGui.Spacing();
        if (comparison.MismatchCount == 0 && comparison.SizeMatches)
        {
            ImGui.TextColored(new Vector4(0.5f, 1.0f, 0.5f, 1.0f), "All declared fields match discovered memory layout.");
        }
        else if (comparison.MismatchCount > 0)
        {
            ImGui.TextColored(new Vector4(1.0f, 0.8f, 0.3f, 1.0f),
                $"{comparison.MismatchCount} field(s) have type mismatches that may need review.");
        }
    }

    private static void DrawStatBox(string label, int count, Vector4 color)
    {
        var textColor = count > 0 ? color : new Vector4(0.5f, 0.5f, 0.5f, 1.0f);
        ImGui.TextColored(textColor, $"{label}: {count}");
    }

    private static void DrawComparisonTable(LayoutComparisonResult comparison, bool showMatches, bool showMismatches, bool showMissing, bool showUndocumented)
    {
        if (ImGui.BeginTable("ComparisonTable", 6,
            ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg | ImGuiTableFlags.Resizable |
            ImGuiTableFlags.ScrollY | ImGuiTableFlags.Sortable))
        {
            ImGui.TableSetupColumn("Offset", ImGuiTableColumnFlags.DefaultSort, 60);
            ImGui.TableSetupColumn("Status", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupColumn("Declared Name", ImGuiTableColumnFlags.None, 120);
            ImGui.TableSetupColumn("Declared Type", ImGuiTableColumnFlags.None, 100);
            ImGui.TableSetupColumn("Inferred Type", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupColumn("Notes", ImGuiTableColumnFlags.None, 150);
            ImGui.TableSetupScrollFreeze(0, 1);
            ImGui.TableHeadersRow();

            var comparisons = comparison.Comparisons
                .Where(c => ShouldShow(c.Status, showMatches, showMismatches, showMissing, showUndocumented))
                .OrderBy(c => c.Offset);

            foreach (var comp in comparisons)
            {
                ImGui.TableNextRow();

                // Get colors for this status
                var (statusText, statusColor, rowTint) = GetStatusDisplay(comp.Status);

                // Apply row tint
                ImGui.TableSetBgColor(ImGuiTableBgTarget.RowBg0, ImGui.GetColorU32(rowTint));

                // Offset
                ImGui.TableNextColumn();
                ImGui.Text($"0x{comp.Offset:X}");

                // Status
                ImGui.TableNextColumn();
                ImGui.TextColored(statusColor, statusText);

                // Declared Name
                ImGui.TableNextColumn();
                if (!string.IsNullOrEmpty(comp.DeclaredName))
                {
                    ImGui.Text(comp.DeclaredName);
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1.0f), "-");
                }

                // Declared Type
                ImGui.TableNextColumn();
                if (!string.IsNullOrEmpty(comp.DeclaredType))
                {
                    ImGui.Text(comp.DeclaredType);
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1.0f), "-");
                }

                // Inferred Type
                ImGui.TableNextColumn();
                if (comp.InferredType.HasValue)
                {
                    var confStr = comp.InferredConfidence > 0 ? $" ({comp.InferredConfidence:P0})" : "";
                    ImGui.Text($"{comp.InferredType.Value}{confStr}");
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1.0f), "-");
                }

                // Notes
                ImGui.TableNextColumn();
                if (!string.IsNullOrEmpty(comp.Notes))
                {
                    ImGui.TextWrapped(comp.Notes);
                }
            }

            ImGui.EndTable();
        }
    }

    private static bool ShouldShow(ComparisonStatus status, bool showMatches, bool showMismatches, bool showMissing, bool showUndocumented)
    {
        return status switch
        {
            ComparisonStatus.Match => showMatches,
            ComparisonStatus.TypeMismatch => showMismatches,
            ComparisonStatus.MissingInMemory => showMissing,
            ComparisonStatus.Undocumented => showUndocumented,
            _ => true
        };
    }

    private static (string Text, Vector4 Color, Vector4 RowTint) GetStatusDisplay(ComparisonStatus status)
    {
        return status switch
        {
            ComparisonStatus.Match => ("Match", new Vector4(0.5f, 1.0f, 0.5f, 1.0f), new Vector4(0.1f, 0.2f, 0.1f, 0.3f)),
            ComparisonStatus.TypeMismatch => ("Mismatch", new Vector4(1.0f, 0.8f, 0.3f, 1.0f), new Vector4(0.2f, 0.15f, 0.05f, 0.3f)),
            ComparisonStatus.MissingInMemory => ("Missing", new Vector4(0.7f, 0.7f, 0.7f, 1.0f), new Vector4(0.1f, 0.1f, 0.1f, 0.3f)),
            ComparisonStatus.Undocumented => ("New", new Vector4(0.3f, 0.7f, 1.0f, 1.0f), new Vector4(0.05f, 0.1f, 0.2f, 0.3f)),
            _ => ("Unknown", new Vector4(1.0f, 1.0f, 1.0f, 1.0f), new Vector4(0.0f, 0.0f, 0.0f, 0.0f))
        };
    }
}
