using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Text.Json;
using Dalamud.Interface.Windowing;
using Dalamud.Bindings.ImGui;
using StructValidator.Discovery;
using StructValidator.Memory;

namespace StructValidator.UI;

/// <summary>
/// Memory Explorer window for discovering struct layouts.
/// </summary>
public class MemoryExplorerWindow : Window, IDisposable
{
    private readonly StructValidationEngine validationEngine;
    private readonly Configuration configuration;

    private List<string> singletonNames = new();
    private int selectedSingletonIndex = -1;
    private string selectedSingletonName = "";

    private DiscoveredLayout? currentLayout;
    private StructValidationResult? currentValidation;
    private LayoutComparisonResult? currentComparison;

    private string statusMessage = "";

    private DiscoveredField? selectedField;
    private bool showOnlyUndocumented = false;
    private bool showPadding = false;
    private float minConfidence = 0.0f;

    public MemoryExplorerWindow(StructValidationEngine validationEngine, Configuration configuration)
        : base("Memory Explorer##MemoryExplorer", ImGuiWindowFlags.None)
    {
        this.validationEngine = validationEngine;
        this.configuration = configuration;

        SizeConstraints = new WindowSizeConstraints
        {
            MinimumSize = new Vector2(800, 600),
            MaximumSize = new Vector2(float.MaxValue, float.MaxValue)
        };
    }

    public void Dispose() { }

    /// <summary>
    /// Refresh the list of available singletons.
    /// </summary>
    public void RefreshSingletonList()
    {
        singletonNames = validationEngine.GetSingletonNames().ToList();
        singletonNames.Sort();
    }

    public override void OnOpen()
    {
        base.OnOpen();
        if (singletonNames.Count == 0)
        {
            RefreshSingletonList();
        }
    }

    public override void Draw()
    {
        DrawToolbar();
        ImGui.Separator();

        if (currentLayout == null)
        {
            ImGui.TextWrapped("Select a singleton from the dropdown and click 'Analyze' to discover its memory layout.");
            ImGui.TextWrapped("The explorer will scan memory and infer field types, then compare with FFXIVClientStructs definitions.");
        }
        else
        {
            DrawMainContent();
        }

        // Status bar
        if (!string.IsNullOrEmpty(statusMessage))
        {
            ImGui.Separator();
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 1.0f, 1.0f), statusMessage);
        }
    }

    private void DrawToolbar()
    {
        // Singleton selector
        ImGui.Text("Singleton:");
        ImGui.SameLine();
        ImGui.SetNextItemWidth(300);

        if (ImGui.BeginCombo("##SingletonCombo", selectedSingletonName))
        {
            for (int i = 0; i < singletonNames.Count; i++)
            {
                var name = singletonNames[i];
                var shortName = name.Split('.').Last();

                bool isSelected = i == selectedSingletonIndex;
                if (ImGui.Selectable(shortName, isSelected))
                {
                    selectedSingletonIndex = i;
                    selectedSingletonName = shortName;
                }

                if (ImGui.IsItemHovered())
                {
                    ImGui.BeginTooltip();
                    ImGui.Text(name);
                    ImGui.EndTooltip();
                }

                if (isSelected)
                    ImGui.SetItemDefaultFocus();
            }
            ImGui.EndCombo();
        }

        ImGui.SameLine();

        if (ImGui.Button("Analyze") && selectedSingletonIndex >= 0)
        {
            AnalyzeSelectedSingleton();
        }

        ImGui.SameLine();

        if (ImGui.Button("Refresh List"))
        {
            RefreshSingletonList();
            statusMessage = $"Found {singletonNames.Count} singletons";
        }

        ImGui.SameLine();
        ImGui.Spacing();
        ImGui.SameLine();

        if (currentLayout != null)
        {
            if (ImGui.Button("Export JSON"))
            {
                ExportToJson();
            }

            ImGui.SameLine();

            if (ImGui.Button("Export YAML"))
            {
                ExportToYaml();
            }
        }
    }

    private void AnalyzeSelectedSingleton()
    {
        if (selectedSingletonIndex < 0 || selectedSingletonIndex >= singletonNames.Count)
            return;

        statusMessage = "Analyzing...";

        try
        {
            var fullName = singletonNames[selectedSingletonIndex];

            // First, validate to get the instance pointer and declared fields
            currentValidation = validationEngine.ValidateByName(fullName);
            if (currentValidation == null)
            {
                statusMessage = "Failed to validate singleton";
                return;
            }

            // Get instance address from validation result
            var instanceIssue = currentValidation.Issues.FirstOrDefault(i => i.Rule == "instance-valid");
            if (instanceIssue == null)
            {
                statusMessage = "Failed to get instance address";
                return;
            }

            // Parse address from "Instance at 0x..."
            var addrMatch = System.Text.RegularExpressions.Regex.Match(instanceIssue.Message, @"0x([0-9A-Fa-f]+)");
            if (!addrMatch.Success)
            {
                statusMessage = "Failed to parse instance address";
                return;
            }

            nint address = nint.Parse(addrMatch.Groups[1].Value, System.Globalization.NumberStyles.HexNumber);

            // Determine size to analyze
            int size = currentValidation.DeclaredSize ?? currentValidation.ActualSize ?? 0x400;

            // Run memory analysis
            currentLayout = MemoryAnalyzer.Analyze(address, size, fullName);

            // Compare with declared fields
            LayoutComparator.UpdateWithDeclaredFields(currentLayout, currentValidation);
            currentComparison = LayoutComparator.Compare(currentLayout, currentValidation);

            statusMessage = $"Analyzed {currentLayout.Fields.Count} fields, {currentLayout.Summary.MatchedFields} matched, {currentLayout.Summary.UndocumentedFields} undocumented";
            selectedField = null;
        }
        catch (Exception ex)
        {
            statusMessage = $"Analysis failed: {ex.Message}";
        }
    }

    private void DrawMainContent()
    {
        if (currentLayout == null) return;

        // Summary bar
        DrawSummary();

        ImGui.Separator();

        // Filters
        ImGui.Checkbox("Show Only Undocumented", ref showOnlyUndocumented);
        ImGui.SameLine();
        ImGui.Checkbox("Show Padding", ref showPadding);
        ImGui.SameLine();
        ImGui.SetNextItemWidth(100);
        ImGui.SliderFloat("Min Confidence", ref minConfidence, 0.0f, 1.0f, "%.1f");

        ImGui.Separator();

        // Split view
        var availableWidth = ImGui.GetContentRegionAvail().X;
        var listWidth = availableWidth * 0.5f;
        var detailWidth = availableWidth * 0.5f - 10;

        // Left panel - field list
        if (ImGui.BeginChild("FieldList", new Vector2(listWidth, -1), true))
        {
            DrawFieldList();
        }
        ImGui.EndChild();

        ImGui.SameLine();

        // Right panel - field details + hex view
        if (ImGui.BeginChild("FieldDetails", new Vector2(detailWidth, -1), true))
        {
            DrawFieldDetails();
        }
        ImGui.EndChild();
    }

    private void DrawSummary()
    {
        if (currentLayout == null) return;

        var summary = currentLayout.Summary;

        ImGui.Columns(5, "SummaryColumns", false);

        ImGui.Text("Address");
        ImGui.Text($"0x{currentLayout.BaseAddress:X}");
        ImGui.NextColumn();

        ImGui.Text("Size");
        ImGui.Text($"0x{currentLayout.AnalyzedSize:X}");
        if (currentLayout.DeclaredSize.HasValue)
        {
            ImGui.SameLine();
            ImGui.TextColored(
                currentLayout.AnalyzedSize == currentLayout.DeclaredSize.Value
                    ? new Vector4(0, 1, 0, 1)
                    : new Vector4(1, 1, 0, 1),
                $"(declared: 0x{currentLayout.DeclaredSize.Value:X})"
            );
        }
        ImGui.NextColumn();

        ImGui.TextColored(new Vector4(0.5f, 1, 0.5f, 1), "Matched");
        ImGui.TextColored(new Vector4(0.5f, 1, 0.5f, 1), $"{summary.MatchedFields}");
        ImGui.NextColumn();

        ImGui.TextColored(new Vector4(1, 1, 0.5f, 1), "Undocumented");
        ImGui.TextColored(new Vector4(1, 1, 0.5f, 1), $"{summary.UndocumentedFields}");
        ImGui.NextColumn();

        ImGui.Text("Pointers");
        ImGui.Text($"{summary.PointerCount}");
        ImGui.NextColumn();

        ImGui.Columns(1);

        // VTable info
        if (currentLayout.VTableAddress.HasValue)
        {
            ImGui.Text($"VTable: 0x{currentLayout.VTableAddress.Value:X} ({currentLayout.VTableSlotCount} slots)");
        }
    }

    private void DrawFieldList()
    {
        if (currentLayout == null) return;

        if (ImGui.BeginTable("DiscoveredFieldsTable", 5, ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg | ImGuiTableFlags.Resizable | ImGuiTableFlags.ScrollY))
        {
            ImGui.TableSetupColumn("Offset", ImGuiTableColumnFlags.None, 60);
            ImGui.TableSetupColumn("Type", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupColumn("Conf", ImGuiTableColumnFlags.None, 40);
            ImGui.TableSetupColumn("Declared", ImGuiTableColumnFlags.None, 100);
            ImGui.TableSetupColumn("Value", ImGuiTableColumnFlags.None, 100);
            ImGui.TableSetupScrollFreeze(0, 1);
            ImGui.TableHeadersRow();

            var fields = currentLayout.Fields
                .Where(f => !showOnlyUndocumented || !f.HasMatch)
                .Where(f => showPadding || f.InferredType != InferredTypeKind.Padding)
                .Where(f => f.Confidence >= minConfidence);

            foreach (var field in fields)
            {
                ImGui.TableNextRow();

                // Determine row color
                Vector4 rowColor;
                if (field.HasMatch)
                    rowColor = new Vector4(0.5f, 1.0f, 0.5f, 1.0f);
                else if (field.InferredType == InferredTypeKind.Padding)
                    rowColor = new Vector4(0.5f, 0.5f, 0.5f, 1.0f);
                else if (field.Confidence > 0.7f)
                    rowColor = new Vector4(1.0f, 1.0f, 0.5f, 1.0f);
                else
                    rowColor = new Vector4(1.0f, 1.0f, 1.0f, 1.0f);

                ImGui.PushStyleColor(ImGuiCol.Text, rowColor);

                ImGui.TableNextColumn();
                bool isSelected = selectedField == field;
                if (ImGui.Selectable($"0x{field.Offset:X}##field{field.Offset}", isSelected, ImGuiSelectableFlags.SpanAllColumns))
                {
                    selectedField = field;
                }
                ImGui.TableNextColumn();
                ImGui.Text(field.TypeString);
                ImGui.TableNextColumn();
                ImGui.Text($"{field.Confidence:P0}");
                ImGui.TableNextColumn();
                ImGui.Text(field.DeclaredName ?? "");
                ImGui.TableNextColumn();
                ImGui.Text(TruncateValue(field.Value, 15));

                ImGui.PopStyleColor();
            }

            ImGui.EndTable();
        }
    }

    private void DrawFieldDetails()
    {
        if (selectedField == null)
        {
            ImGui.TextWrapped("Select a field from the list to view details.");
            return;
        }

        var field = selectedField;

        // Header
        ImGui.TextColored(new Vector4(0.8f, 0.8f, 1.0f, 1.0f), $"Field at offset 0x{field.Offset:X}");
        ImGui.Separator();

        // Basic info
        ImGui.Text($"Inferred Type: {field.TypeString}");
        ImGui.Text($"Size: {field.Size} bytes");
        ImGui.Text($"Confidence: {field.Confidence:P1}");

        if (!string.IsNullOrEmpty(field.Notes))
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f), $"Notes: {field.Notes}");
        }

        ImGui.Separator();

        // Declared info
        if (field.HasMatch)
        {
            ImGui.TextColored(new Vector4(0.5f, 1.0f, 0.5f, 1.0f), "Matches FFXIVClientStructs:");
            ImGui.Indent();
            ImGui.Text($"Name: {field.DeclaredName}");
            ImGui.Text($"Type: {field.DeclaredType}");
            ImGui.Unindent();
        }
        else if (field.InferredType != InferredTypeKind.Padding)
        {
            ImGui.TextColored(new Vector4(1.0f, 1.0f, 0.5f, 1.0f), "Not in FFXIVClientStructs (undocumented)");
        }

        ImGui.Separator();

        // Value
        if (!string.IsNullOrEmpty(field.Value))
        {
            ImGui.Text($"Value: {field.Value}");
        }

        // Pointer target
        if (field.PointerTarget.HasValue && field.PointerTarget.Value != 0)
        {
            ImGui.Text($"Points to: 0x{field.PointerTarget.Value:X}");
        }

        ImGui.Separator();

        // Raw bytes
        if (field.RawBytes != null && field.RawBytes.Length > 0)
        {
            ImGui.Text("Raw Bytes:");
            ImGui.Indent();

            var hexStr = string.Join(" ", field.RawBytes.Select(b => $"{b:X2}"));
            ImGui.TextColored(new Vector4(0.8f, 0.8f, 0.8f, 1.0f), hexStr);

            ImGui.Unindent();
        }
    }

    private void ExportToJson()
    {
        if (currentLayout == null) return;

        try
        {
            var report = new DiscoveryReport
            {
                Timestamp = DateTime.UtcNow,
                GameVersion = "Unknown", // Would get from FFXIVClientStructs assembly
                Layouts = new List<DiscoveredLayout> { currentLayout },
                Summary = new DiscoveryReportSummary
                {
                    TotalStructsAnalyzed = 1,
                    TotalFieldsDiscovered = currentLayout.Fields.Count,
                    TotalUndocumentedFields = currentLayout.Summary.UndocumentedFields,
                    TotalPointersFound = currentLayout.Summary.PointerCount
                }
            };

            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                $"discovery-{currentLayout.StructName.Split('.').Last()}-{DateTime.Now:yyyyMMdd-HHmmss}.json"
            );

            var json = JsonSerializer.Serialize(report, new JsonSerializerOptions
            {
                WriteIndented = true,
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });

            File.WriteAllText(path, json);
            statusMessage = $"Exported to {path}";
        }
        catch (Exception ex)
        {
            statusMessage = $"Export failed: {ex.Message}";
        }
    }

    private void ExportToYaml()
    {
        if (currentLayout == null) return;

        try
        {
            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                $"discovery-{currentLayout.StructName.Split('.').Last()}-{DateTime.Now:yyyyMMdd-HHmmss}.yaml"
            );

            using var writer = new StreamWriter(path);

            writer.WriteLine($"# Auto-discovered layout for {currentLayout.StructName}");
            writer.WriteLine($"# Analyzed: {currentLayout.Timestamp:yyyy-MM-dd HH:mm:ss}");
            writer.WriteLine($"# Address: 0x{currentLayout.BaseAddress:X}");
            writer.WriteLine();
            writer.WriteLine("structs:");
            writer.WriteLine($"  - type: {currentLayout.StructName.Split('.').Last()}_Discovered");
            writer.WriteLine($"    size: 0x{currentLayout.AnalyzedSize:X}");
            writer.WriteLine("    fields:");

            foreach (var field in currentLayout.Fields.Where(f => f.InferredType != InferredTypeKind.Padding))
            {
                var name = field.DeclaredName ?? $"Unknown_0x{field.Offset:X}";
                var type = MapToYamlType(field);

                writer.WriteLine($"      - type: {type}");
                writer.WriteLine($"        name: {name}");
                writer.WriteLine($"        offset: 0x{field.Offset:X}");

                if (field.Confidence < 0.7f)
                {
                    writer.WriteLine($"        # confidence: {field.Confidence:P0}");
                }

                if (!string.IsNullOrEmpty(field.Notes))
                {
                    writer.WriteLine($"        # {field.Notes}");
                }
            }

            statusMessage = $"Exported to {path}";
        }
        catch (Exception ex)
        {
            statusMessage = $"Export failed: {ex.Message}";
        }
    }

    private static string MapToYamlType(DiscoveredField field)
    {
        return field.InferredType switch
        {
            InferredTypeKind.Pointer => "void*",
            InferredTypeKind.VTablePointer => "void*",
            InferredTypeKind.StringPointer => "byte*",
            InferredTypeKind.Float => "float",
            InferredTypeKind.Double => "double",
            InferredTypeKind.Bool => "bool",
            InferredTypeKind.Byte => "byte",
            InferredTypeKind.Int16 => "short",
            InferredTypeKind.Int32 => "int",
            InferredTypeKind.Int64 => "long",
            InferredTypeKind.Enum => "int",
            _ => "byte"
        };
    }

    private static string TruncateValue(string? value, int maxLen)
    {
        if (string.IsNullOrEmpty(value)) return "";
        return value.Length <= maxLen ? value : value[..(maxLen - 3)] + "...";
    }
}
