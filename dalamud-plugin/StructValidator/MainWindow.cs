using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Text.Json;
using Dalamud.Interface.Windowing;
using Dalamud.Bindings.ImGui;

namespace StructValidator;

/// <summary>
/// Main UI window for the struct validator.
/// </summary>
public class MainWindow : Window, IDisposable
{
    private readonly Plugin plugin;
    private readonly StructValidationEngine validationEngine;
    private readonly Configuration configuration;

    private ValidationReport? currentReport;
    private string searchFilter = "";
    private string structNameInput = "";
    private bool showOnlyFailed = false;
    private StructValidationResult? selectedResult;

    public MainWindow(Plugin plugin, StructValidationEngine validationEngine, Configuration configuration)
        : base("Struct Validator##MainWindow", ImGuiWindowFlags.None)
    {
        this.plugin = plugin;
        this.validationEngine = validationEngine;
        this.configuration = configuration;

        SizeConstraints = new WindowSizeConstraints
        {
            MinimumSize = new Vector2(600, 400),
            MaximumSize = new Vector2(float.MaxValue, float.MaxValue)
        };
    }

    public void Dispose() { }

    public override void Draw()
    {
        // Top bar with actions
        DrawActionBar();

        ImGui.Separator();

        // Main content
        if (currentReport == null)
        {
            ImGui.TextWrapped("Click 'Run All Validations' to validate FFXIVClientStructs definitions against live memory.");
            ImGui.TextWrapped("Use 'Validate Single' to check a specific struct by name.");
        }
        else
        {
            DrawResults();
        }
    }

    private void DrawActionBar()
    {
        if (ImGui.Button("Run All Validations"))
        {
            currentReport = validationEngine.ValidateAll();
            selectedResult = null;
        }

        ImGui.SameLine();

        ImGui.SetNextItemWidth(200);
        ImGui.InputTextWithHint("##StructName", "Struct name...", ref structNameInput, 256);

        ImGui.SameLine();

        if (ImGui.Button("Validate Single"))
        {
            if (!string.IsNullOrWhiteSpace(structNameInput))
            {
                var result = validationEngine.ValidateByName(structNameInput);
                if (result != null)
                {
                    currentReport = new ValidationReport
                    {
                        Timestamp = DateTime.UtcNow,
                        Results = new List<StructValidationResult> { result },
                        Summary = new ValidationSummary
                        {
                            TotalStructs = 1,
                            PassedStructs = result.Passed ? 1 : 0,
                            FailedStructs = result.Passed ? 0 : 1,
                            TotalIssues = result.Issues.Count,
                            ErrorCount = result.Issues.Count(i => i.Severity == "error"),
                            WarningCount = result.Issues.Count(i => i.Severity == "warning"),
                            InfoCount = result.Issues.Count(i => i.Severity == "info")
                        }
                    };
                    selectedResult = result;
                }
            }
        }

        ImGui.SameLine();
        ImGui.Spacing();
        ImGui.SameLine();

        if (ImGui.Button("Export JSON") && currentReport != null)
        {
            ExportReport();
        }

        ImGui.SameLine();

        if (ImGui.Button("Settings"))
        {
            ImGui.OpenPopup("SettingsPopup");
        }

        DrawSettingsPopup();
    }

    private void DrawSettingsPopup()
    {
        if (ImGui.BeginPopup("SettingsPopup"))
        {
            ImGui.Text("Display Settings");
            ImGui.Separator();

            var showInfo = configuration.ShowInfoIssues;
            if (ImGui.Checkbox("Show Info Issues", ref showInfo))
            {
                configuration.ShowInfoIssues = showInfo;
                configuration.Save();
            }

            var showWarnings = configuration.ShowWarnings;
            if (ImGui.Checkbox("Show Warnings", ref showWarnings))
            {
                configuration.ShowWarnings = showWarnings;
                configuration.Save();
            }

            ImGui.Separator();

            ImGui.Text("Validation Settings");

            var onlyDeclared = configuration.OnlyDeclaredSizes;
            if (ImGui.Checkbox("Only Structs with Declared Sizes", ref onlyDeclared))
            {
                configuration.OnlyDeclaredSizes = onlyDeclared;
                configuration.Save();
            }

            ImGui.SetNextItemWidth(200);
            var nsFilter = configuration.NamespaceFilter;
            if (ImGui.InputText("Namespace Filter", ref nsFilter, 256))
            {
                configuration.NamespaceFilter = nsFilter;
                configuration.Save();
            }

            ImGui.EndPopup();
        }
    }

    private void DrawResults()
    {
        // Summary
        DrawSummary();

        ImGui.Separator();

        // Filter bar
        ImGui.SetNextItemWidth(200);
        ImGui.InputTextWithHint("##Filter", "Filter structs...", ref searchFilter, 256);

        ImGui.SameLine();
        ImGui.Checkbox("Show Only Failed", ref showOnlyFailed);

        ImGui.Separator();

        // Split view
        var availableWidth = ImGui.GetContentRegionAvail().X;
        var listWidth = availableWidth * 0.4f;
        var detailWidth = availableWidth * 0.6f - 10;

        // Left panel - struct list
        if (ImGui.BeginChild("StructList", new Vector2(listWidth, -1), true))
        {
            DrawStructList();
        }
        ImGui.EndChild();

        ImGui.SameLine();

        // Right panel - details
        if (ImGui.BeginChild("StructDetails", new Vector2(detailWidth, -1), true))
        {
            DrawStructDetails();
        }
        ImGui.EndChild();
    }

    private void DrawSummary()
    {
        if (currentReport == null) return;

        var summary = currentReport.Summary;

        ImGui.Text($"Validation Time: {currentReport.Timestamp:yyyy-MM-dd HH:mm:ss}");

        ImGui.Columns(4, "SummaryColumns", false);

        ImGui.Text("Total Structs");
        ImGui.Text($"{summary.TotalStructs}");
        ImGui.NextColumn();

        ImGui.TextColored(new Vector4(0, 1, 0, 1), "Passed");
        ImGui.TextColored(new Vector4(0, 1, 0, 1), $"{summary.PassedStructs}");
        ImGui.NextColumn();

        ImGui.TextColored(new Vector4(1, 0, 0, 1), "Failed");
        ImGui.TextColored(new Vector4(1, 0, 0, 1), $"{summary.FailedStructs}");
        ImGui.NextColumn();

        ImGui.Text("Issues");
        ImGui.Text($"{summary.ErrorCount} errors, {summary.WarningCount} warnings");
        ImGui.NextColumn();

        ImGui.Columns(1);
    }

    private void DrawStructList()
    {
        if (currentReport == null) return;

        var filteredResults = currentReport.Results
            .Where(r => string.IsNullOrEmpty(searchFilter) ||
                       r.StructName.Contains(searchFilter, StringComparison.OrdinalIgnoreCase))
            .Where(r => !showOnlyFailed || !r.Passed)
            .OrderBy(r => r.Passed)
            .ThenBy(r => r.StructName);

        foreach (var result in filteredResults)
        {
            var shortName = result.StructName.Split('.').Last();
            var isSelected = selectedResult == result;

            // Color based on status
            Vector4 color;
            string prefix;
            if (result.Passed)
            {
                color = new Vector4(0.5f, 1, 0.5f, 1);
                prefix = "[OK] ";
            }
            else
            {
                color = new Vector4(1, 0.5f, 0.5f, 1);
                prefix = "[FAIL] ";
            }

            ImGui.PushStyleColor(ImGuiCol.Text, color);

            if (ImGui.Selectable($"{prefix}{shortName}", isSelected))
            {
                selectedResult = result;
            }

            if (ImGui.IsItemHovered())
            {
                ImGui.BeginTooltip();
                ImGui.Text(result.StructName);
                ImGui.EndTooltip();
            }

            ImGui.PopStyleColor();
        }
    }

    private void DrawStructDetails()
    {
        if (selectedResult == null)
        {
            ImGui.TextWrapped("Select a struct from the list to view details.");
            return;
        }

        var result = selectedResult;

        // Header
        ImGui.TextColored(
            result.Passed ? new Vector4(0, 1, 0, 1) : new Vector4(1, 0, 0, 1),
            result.Passed ? "PASSED" : "FAILED"
        );

        ImGui.SameLine();
        ImGui.Text($"  {result.StructName}");

        ImGui.Separator();

        // Size info
        if (result.DeclaredSize.HasValue || result.ActualSize.HasValue)
        {
            ImGui.Text("Size Information:");
            ImGui.Indent();

            if (result.DeclaredSize.HasValue)
                ImGui.Text($"Declared: 0x{result.DeclaredSize.Value:X}");

            if (result.ActualSize.HasValue)
                ImGui.Text($"Actual: 0x{result.ActualSize.Value:X}");

            if (result.BaseType != null)
                ImGui.Text($"Base Type: {result.BaseType} (0x{result.BaseTypeSize ?? 0:X})");

            ImGui.Unindent();
            ImGui.Separator();
        }

        // Issues
        if (result.Issues.Count > 0)
        {
            ImGui.Text($"Issues ({result.Issues.Count}):");

            foreach (var issue in result.Issues)
            {
                if (issue.Severity == "info" && !configuration.ShowInfoIssues)
                    continue;
                if (issue.Severity == "warning" && !configuration.ShowWarnings)
                    continue;

                Vector4 issueColor = issue.Severity switch
                {
                    "error" => new Vector4(1, 0.3f, 0.3f, 1),
                    "warning" => new Vector4(1, 1, 0.3f, 1),
                    _ => new Vector4(0.7f, 0.7f, 1, 1)
                };

                ImGui.TextColored(issueColor, $"[{issue.Severity.ToUpper()}] [{issue.Rule}]");
                ImGui.Indent();

                if (!string.IsNullOrEmpty(issue.Field))
                    ImGui.Text($"Field: {issue.Field}");

                ImGui.TextWrapped(issue.Message);

                if (!string.IsNullOrEmpty(issue.Expected))
                    ImGui.Text($"Expected: {issue.Expected}");

                if (!string.IsNullOrEmpty(issue.Actual))
                    ImGui.Text($"Actual: {issue.Actual}");

                ImGui.Unindent();
                ImGui.Spacing();
            }
        }
        else
        {
            ImGui.TextColored(new Vector4(0.5f, 1, 0.5f, 1), "No issues found.");
        }

        // Field validations
        if (result.FieldValidations != null && result.FieldValidations.Count > 0)
        {
            ImGui.Separator();
            ImGui.Text($"Field Validations ({result.FieldValidations.Count}):");

            if (ImGui.BeginTable("FieldsTable", 4, ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg))
            {
                ImGui.TableSetupColumn("Name");
                ImGui.TableSetupColumn("Offset");
                ImGui.TableSetupColumn("Type");
                ImGui.TableSetupColumn("Size");
                ImGui.TableHeadersRow();

                foreach (var field in result.FieldValidations)
                {
                    ImGui.TableNextRow();
                    ImGui.TableNextColumn();
                    ImGui.Text(field.Name);
                    ImGui.TableNextColumn();
                    ImGui.Text($"0x{field.Offset:X}");
                    ImGui.TableNextColumn();
                    ImGui.Text(field.Type);
                    ImGui.TableNextColumn();
                    ImGui.Text($"0x{field.Size:X}");
                }

                ImGui.EndTable();
            }
        }
    }

    private void ExportReport()
    {
        if (currentReport == null) return;

        try
        {
            var path = string.IsNullOrEmpty(configuration.DefaultExportPath)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                              $"struct-validation-{DateTime.Now:yyyyMMdd-HHmmss}.json")
                : configuration.DefaultExportPath;

            var json = JsonSerializer.Serialize(currentReport, new JsonSerializerOptions
            {
                WriteIndented = true,
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });

            File.WriteAllText(path, json);

            // Show confirmation (would need chat access, simplified here)
        }
        catch (Exception)
        {
            // Would show error
        }
    }
}
