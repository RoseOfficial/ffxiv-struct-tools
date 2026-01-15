using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Numerics;
using Dalamud.Interface.Windowing;
using Dalamud.Bindings.ImGui;
using Dalamud.Plugin.Services;
using StructValidator.Memory;
using StructValidator.Models;
using StructValidator.Services;

namespace StructValidator.UI;

/// <summary>
/// Window for generating and managing memory signatures.
/// </summary>
public class SignatureWindow : Window, IDisposable
{
    private readonly SignatureGenerator _sigGenerator;
    private readonly StructValidationEngine _validationEngine;
    private readonly IPluginLog _log;

    // Input state
    private string _offsetInput = "0x0";
    private string _structFilter = "";
    private List<string> _singletonNames = new();
    private int _selectedSingletonIndex = -1;
    private string _selectedSingletonName = "";

    // Results
    private List<FieldSignature> _currentSignatures = new();
    private SignatureCollection? _currentCollection;
    private Dictionary<int, string>? _selectedStructFields;

    private string _statusMessage = "";

    public SignatureWindow(
        SignatureGenerator sigGenerator,
        StructValidationEngine validationEngine,
        IPluginLog log)
        : base("Signature Generator##SignatureGenerator", ImGuiWindowFlags.None)
    {
        _sigGenerator = sigGenerator;
        _validationEngine = validationEngine;
        _log = log;

        SizeConstraints = new WindowSizeConstraints
        {
            MinimumSize = new Vector2(700, 500),
            MaximumSize = new Vector2(float.MaxValue, float.MaxValue)
        };
    }

    public void Dispose() { }

    public override void OnOpen()
    {
        base.OnOpen();
        RefreshSingletonList();
    }

    private void RefreshSingletonList()
    {
        _singletonNames = _validationEngine.GetSingletonNames().ToList();
        _singletonNames.Sort();
    }

    public override void Draw()
    {
        DrawToolbar();
        ImGui.Separator();

        var availHeight = ImGui.GetContentRegionAvail().Y;

        // Main content area
        if (ImGui.BeginChild("SignatureContent", new Vector2(-1, availHeight - 30), false))
        {
            if (ImGui.BeginTabBar("SignatureTabs"))
            {
                if (ImGui.BeginTabItem("Single Offset"))
                {
                    DrawSingleOffsetTab();
                    ImGui.EndTabItem();
                }

                if (ImGui.BeginTabItem("Struct Fields"))
                {
                    DrawStructFieldsTab();
                    ImGui.EndTabItem();
                }

                if (ImGui.BeginTabItem("Results"))
                {
                    DrawResultsTab();
                    ImGui.EndTabItem();
                }

                ImGui.EndTabBar();
            }
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
        if (ImGui.Button("Initialize"))
        {
            if (_sigGenerator.Initialize())
            {
                _statusMessage = "Signature generator initialized";
            }
            else
            {
                _statusMessage = "Failed to initialize signature generator";
            }
        }

        ImGui.SameLine();

        if (_currentCollection != null && _currentCollection.Count > 0)
        {
            if (ImGui.Button("Export JSON"))
            {
                ExportJson();
            }

            ImGui.SameLine();

            if (ImGui.Button("Copy All"))
            {
                CopyAllSignatures();
            }
        }
    }

    private void DrawSingleOffsetTab()
    {
        ImGui.Text("Generate signature for a specific field offset:");
        ImGui.Spacing();

        ImGui.Text("Offset:");
        ImGui.SameLine();
        ImGui.SetNextItemWidth(150);
        ImGui.InputText("##OffsetInput", ref _offsetInput, 32);

        ImGui.SameLine();

        if (ImGui.Button("Generate"))
        {
            GenerateForSingleOffset();
        }

        ImGui.Separator();

        // Show results
        if (_currentSignatures.Count > 0)
        {
            DrawSignatureList(_currentSignatures);
        }
        else
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f),
                "Enter a field offset (e.g., 0x100) and click Generate.");
        }
    }

    private void DrawStructFieldsTab()
    {
        // Struct selector
        ImGui.Text("Struct:");
        ImGui.SameLine();
        ImGui.SetNextItemWidth(250);

        if (ImGui.BeginCombo("##StructCombo", _selectedSingletonName))
        {
            ImGui.SetNextItemWidth(-1);
            ImGui.InputTextWithHint("##StructFilter", "Search...", ref _structFilter, 64);

            var filter = _structFilter.ToLowerInvariant();

            foreach (var name in _singletonNames)
            {
                var shortName = name.Split('.').Last();

                if (!string.IsNullOrEmpty(filter) && !shortName.ToLowerInvariant().Contains(filter))
                    continue;

                var isSelected = shortName == _selectedSingletonName;
                if (ImGui.Selectable(shortName, isSelected))
                {
                    _selectedSingletonName = shortName;
                    _selectedSingletonIndex = _singletonNames.IndexOf(name);
                    LoadStructFields(name);
                }

                if (ImGui.IsItemHovered())
                {
                    ImGui.BeginTooltip();
                    ImGui.Text(name);
                    ImGui.EndTooltip();
                }
            }
            ImGui.EndCombo();
        }

        ImGui.SameLine();

        if (ImGui.Button("Generate All") && _selectedStructFields != null)
        {
            GenerateForStruct();
        }

        ImGui.Separator();

        // Show struct fields
        if (_selectedStructFields != null && _selectedStructFields.Count > 0)
        {
            ImGui.Text($"Fields ({_selectedStructFields.Count}):");
            ImGui.Spacing();

            if (ImGui.BeginTable("FieldsTable", 3, ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg | ImGuiTableFlags.ScrollY))
            {
                ImGui.TableSetupColumn("Offset", ImGuiTableColumnFlags.None, 80);
                ImGui.TableSetupColumn("Name", ImGuiTableColumnFlags.None, 200);
                ImGui.TableSetupColumn("Action", ImGuiTableColumnFlags.None, 100);
                ImGui.TableSetupScrollFreeze(0, 1);
                ImGui.TableHeadersRow();

                foreach (var (offset, fieldName) in _selectedStructFields.OrderBy(kv => kv.Key))
                {
                    ImGui.TableNextRow();

                    ImGui.TableNextColumn();
                    ImGui.Text($"0x{offset:X}");

                    ImGui.TableNextColumn();
                    ImGui.Text(fieldName);

                    ImGui.TableNextColumn();
                    if (ImGui.SmallButton($"Generate##{offset}"))
                    {
                        GenerateForField(offset, fieldName);
                    }
                }

                ImGui.EndTable();
            }
        }
        else
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f),
                "Select a struct to view its fields.");
        }
    }

    private void DrawResultsTab()
    {
        if (_currentCollection == null || _currentCollection.Count == 0)
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f),
                "No signatures generated yet. Use the other tabs to generate signatures.");
            return;
        }

        ImGui.Text($"Game Version: {_currentCollection.GameVersion}");
        ImGui.Text($"Generated: {_currentCollection.Timestamp:yyyy-MM-dd HH:mm:ss}");
        ImGui.Text($"Fields with signatures: {_currentCollection.Count}");
        ImGui.Separator();

        if (ImGui.BeginTable("ResultsTable", 4, ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg | ImGuiTableFlags.ScrollY))
        {
            ImGui.TableSetupColumn("Field", ImGuiTableColumnFlags.None, 150);
            ImGui.TableSetupColumn("Signature", ImGuiTableColumnFlags.None, 300);
            ImGui.TableSetupColumn("Confidence", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupColumn("Action", ImGuiTableColumnFlags.None, 60);
            ImGui.TableSetupScrollFreeze(0, 1);
            ImGui.TableHeadersRow();

            foreach (var sig in _currentCollection.Signatures)
            {
                ImGui.TableNextRow();

                ImGui.TableNextColumn();
                ImGui.Text(sig.FieldName);

                ImGui.TableNextColumn();
                var displaySig = sig.Pattern.Length > 50
                    ? sig.Pattern.Substring(0, 47) + "..."
                    : sig.Pattern;
                ImGui.Text(displaySig);

                if (ImGui.IsItemHovered())
                {
                    ImGui.BeginTooltip();
                    ImGui.Text(sig.Pattern);
                    ImGui.Text($"Address: {sig.FoundAtHex}");
                    ImGui.Text($"Instruction: {sig.InstructionType}");
                    ImGui.EndTooltip();
                }

                ImGui.TableNextColumn();
                DrawConfidenceBar(sig.Confidence);

                ImGui.TableNextColumn();
                if (ImGui.SmallButton($"Copy##{sig.FieldName}"))
                {
                    ImGui.SetClipboardText(sig.Pattern);
                    _statusMessage = $"Copied signature for {sig.FieldName}";
                }
            }

            ImGui.EndTable();
        }
    }

    private void DrawSignatureList(List<FieldSignature> signatures)
    {
        ImGui.Text($"Found {signatures.Count} signature(s):");
        ImGui.Spacing();

        foreach (var sig in signatures.OrderByDescending(s => s.Confidence))
        {
            ImGui.PushStyleColor(ImGuiCol.Header, new Vector4(0.2f, 0.3f, 0.4f, 1.0f));

            if (ImGui.CollapsingHeader($"{sig.InstructionType} @ {sig.FoundAtHex}##sig{sig.FoundAtHex}", ImGuiTreeNodeFlags.DefaultOpen))
            {
                ImGui.Indent();

                ImGui.Text("Signature:");
                ImGui.SameLine();
                ImGui.PushStyleColor(ImGuiCol.Text, new Vector4(0.8f, 1.0f, 0.8f, 1.0f));
                ImGui.TextWrapped(sig.Pattern);
                ImGui.PopStyleColor();

                ImGui.Text($"Confidence: {sig.Confidence:P0} (Matches: {sig.MatchCount})");
                DrawConfidenceBar(sig.Confidence);

                if (ImGui.Button($"Copy##copy{sig.FoundAtHex}"))
                {
                    ImGui.SetClipboardText(sig.Pattern);
                    _statusMessage = "Signature copied to clipboard";
                }

                ImGui.Unindent();
            }

            ImGui.PopStyleColor();
        }
    }

    private void DrawConfidenceBar(float confidence)
    {
        var color = confidence >= 0.9f
            ? new Vector4(0.3f, 1.0f, 0.3f, 1.0f)
            : confidence >= 0.7f
                ? new Vector4(0.8f, 1.0f, 0.3f, 1.0f)
                : new Vector4(1.0f, 0.8f, 0.3f, 1.0f);

        ImGui.PushStyleColor(ImGuiCol.PlotHistogram, color);
        ImGui.ProgressBar(confidence, new Vector2(60, 14), "");
        ImGui.PopStyleColor();
    }

    private void GenerateForSingleOffset()
    {
        var offsetStr = _offsetInput.Trim();
        if (offsetStr.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            offsetStr = offsetStr[2..];

        if (!int.TryParse(offsetStr, System.Globalization.NumberStyles.HexNumber, null, out var offset))
        {
            _statusMessage = "Invalid offset format. Use hex like 0x100";
            return;
        }

        _statusMessage = "Scanning for signatures...";

        try
        {
            _currentSignatures = _sigGenerator.GenerateForOffset("Unknown", $"Field_0x{offset:X}", offset, 10);

            if (_currentSignatures.Count > 0)
            {
                _statusMessage = $"Found {_currentSignatures.Count} signature(s) for offset 0x{offset:X}";
            }
            else
            {
                _statusMessage = $"No signatures found for offset 0x{offset:X}";
            }
        }
        catch (Exception ex)
        {
            _statusMessage = $"Signature generation failed: {ex.Message}";
        }
    }

    private void LoadStructFields(string fullName)
    {
        _selectedStructFields = new Dictionary<int, string>();

        try
        {
            var validation = _validationEngine.ValidateByName(fullName);
            if (validation?.FieldValidations != null)
            {
                foreach (var field in validation.FieldValidations)
                {
                    if (!string.IsNullOrEmpty(field.Name) && !_selectedStructFields.ContainsKey(field.Offset))
                    {
                        _selectedStructFields[field.Offset] = field.Name;
                    }
                }
            }

            _statusMessage = $"Loaded {_selectedStructFields.Count} fields from {fullName.Split('.').Last()}";
        }
        catch (Exception ex)
        {
            _statusMessage = $"Failed to load fields: {ex.Message}";
        }
    }

    private void GenerateForField(int offset, string fieldName)
    {
        _statusMessage = $"Generating signatures for {fieldName}...";

        try
        {
            _currentSignatures = _sigGenerator.GenerateForOffset(_selectedSingletonName, fieldName, offset, 10);

            if (_currentSignatures.Count > 0)
            {
                _statusMessage = $"Found {_currentSignatures.Count} signature(s) for {fieldName}";

                // Add to collection if we have one
                if (_currentCollection != null && _currentSignatures.Count > 0)
                {
                    _currentCollection.Signatures.Add(_currentSignatures[0]);
                }
            }
            else
            {
                _statusMessage = $"No signatures found for {fieldName}";
            }
        }
        catch (Exception ex)
        {
            _statusMessage = $"Failed: {ex.Message}";
        }
    }

    private void GenerateForStruct()
    {
        if (_selectedStructFields == null || _selectedStructFields.Count == 0)
        {
            _statusMessage = "No fields to generate signatures for";
            return;
        }

        _statusMessage = "Generating signatures for all fields...";

        try
        {
            _currentCollection = _sigGenerator.GenerateForStruct(
                _selectedSingletonName,
                _validationEngine.GameVersion,
                _selectedStructFields);

            var successCount = _currentCollection.Count;
            var totalFields = _selectedStructFields.Count;

            _statusMessage = $"Generated signatures for {successCount}/{totalFields} fields";
        }
        catch (Exception ex)
        {
            _statusMessage = $"Generation failed: {ex.Message}";
        }
    }

    private void ExportJson()
    {
        if (_currentCollection == null) return;

        try
        {
            var json = _sigGenerator.ExportToJson(_currentCollection);
            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                $"signatures-{_currentCollection.GameVersion}-{DateTime.Now:yyyyMMdd-HHmmss}.json");

            File.WriteAllText(path, json);
            _statusMessage = $"Exported to {path}";
        }
        catch (Exception ex)
        {
            _statusMessage = $"Export failed: {ex.Message}";
        }
    }

    private void CopyAllSignatures()
    {
        if (_currentCollection == null) return;

        try
        {
            var json = _sigGenerator.ExportToJson(_currentCollection);
            ImGui.SetClipboardText(json);
            _statusMessage = "All signatures copied to clipboard";
        }
        catch (Exception ex)
        {
            _statusMessage = $"Copy failed: {ex.Message}";
        }
    }
}
