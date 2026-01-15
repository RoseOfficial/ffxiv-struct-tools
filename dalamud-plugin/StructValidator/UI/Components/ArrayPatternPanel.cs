using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using Dalamud.Bindings.ImGui;
using StructValidator.Memory;

namespace StructValidator.UI.Components;

/// <summary>
/// ImGui panel for displaying detected array patterns in memory.
/// </summary>
public static class ArrayPatternPanel
{
    private static float _minConfidence = 0.6f;

    /// <summary>
    /// Draw the array pattern panel.
    /// </summary>
    /// <param name="patterns">The detected array patterns.</param>
    /// <param name="onGenerateYaml">Callback to generate YAML suggestions.</param>
    public static void Draw(List<ArrayPattern>? patterns, System.Action<ArrayPattern>? onGenerateYaml = null)
    {
        if (patterns == null || patterns.Count == 0)
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f), "No array patterns detected.");
            ImGui.TextWrapped("Click 'Detect Arrays' to scan for repeating memory patterns that might indicate arrays or inline structs.");
            return;
        }

        // Summary
        ImGui.Text($"Detected {patterns.Count} potential array patterns");
        ImGui.Spacing();

        // Filter
        ImGui.SetNextItemWidth(150);
        ImGui.SliderFloat("Min Confidence", ref _minConfidence, 0.0f, 1.0f, "%.1f");

        ImGui.Separator();

        // Table
        var filtered = patterns.Where(p => p.Confidence >= _minConfidence).OrderBy(p => p.StartOffset).ToList();

        if (filtered.Count == 0)
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f), "No patterns above confidence threshold.");
            return;
        }

        if (ImGui.BeginTable("ArrayPatternTable", 6,
            ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg | ImGuiTableFlags.Resizable | ImGuiTableFlags.ScrollY))
        {
            ImGui.TableSetupColumn("Offset", ImGuiTableColumnFlags.None, 60);
            ImGui.TableSetupColumn("Stride", ImGuiTableColumnFlags.None, 50);
            ImGui.TableSetupColumn("Count", ImGuiTableColumnFlags.None, 50);
            ImGui.TableSetupColumn("Total", ImGuiTableColumnFlags.None, 60);
            ImGui.TableSetupColumn("Confidence", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupColumn("Suggested", ImGuiTableColumnFlags.None, 150);
            ImGui.TableSetupScrollFreeze(0, 1);
            ImGui.TableHeadersRow();

            foreach (var pattern in filtered)
            {
                ImGui.TableNextRow();

                // Color based on confidence
                var confColor = GetConfidenceColor(pattern.Confidence);
                ImGui.PushStyleColor(ImGuiCol.Text, confColor);

                var totalSize = pattern.Stride * pattern.Count;
                var suggestedType = $"FixedArray<byte, {pattern.Stride}>";

                // Offset
                ImGui.TableNextColumn();
                ImGui.Text($"0x{pattern.StartOffset:X}");

                // Stride
                ImGui.TableNextColumn();
                ImGui.Text($"{pattern.Stride}");

                // Count
                ImGui.TableNextColumn();
                ImGui.Text($"{pattern.Count}");

                // Total size
                ImGui.TableNextColumn();
                ImGui.Text($"0x{totalSize:X}");

                // Confidence bar
                ImGui.TableNextColumn();
                DrawConfidenceBar(pattern.Confidence);

                // Suggested type
                ImGui.TableNextColumn();
                ImGui.Text(suggestedType);

                if (onGenerateYaml != null)
                {
                    ImGui.SameLine();
                    if (ImGui.SmallButton($"Copy##arr{pattern.StartOffset}"))
                    {
                        onGenerateYaml(pattern);
                    }
                }

                ImGui.PopStyleColor();
            }

            ImGui.EndTable();
        }

        // YAML suggestions
        ImGui.Spacing();
        if (ImGui.CollapsingHeader("YAML Suggestions"))
        {
            DrawYamlSuggestions(filtered);
        }
    }

    private static void DrawConfidenceBar(float confidence)
    {
        var color = GetConfidenceColor(confidence);

        // Draw text and simple bar
        ImGui.Text($"{confidence:P0}");
        ImGui.SameLine();

        // Simple visual bar using colored text
        var barLength = (int)(confidence * 10);
        var bar = new string('|', barLength) + new string('.', 10 - barLength);
        ImGui.TextColored(color, bar);
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

    private static void DrawYamlSuggestions(List<ArrayPattern> patterns)
    {
        ImGui.BeginChild("YamlSuggestions", new Vector2(0, 200), true);

        ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f), "# Suggested field definitions for detected arrays:");
        ImGui.Spacing();

        foreach (var pattern in patterns.Where(p => p.Confidence >= 0.7f))
        {
            var fieldName = $"Array_0x{pattern.StartOffset:X}";
            var suggestedType = $"FixedArray<byte, {pattern.Stride}>";
            var suggestion = $"      - type: {suggestedType}";
            ImGui.Text(suggestion);
            ImGui.Text($"        name: {fieldName}");
            ImGui.Text($"        offset: 0x{pattern.StartOffset:X}");
            ImGui.Text($"        size: {pattern.Count}");
            ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1.0f), $"        # confidence: {pattern.Confidence:P0}, stride: {pattern.Stride}");
            ImGui.Spacing();
        }

        ImGui.EndChild();
    }
}
