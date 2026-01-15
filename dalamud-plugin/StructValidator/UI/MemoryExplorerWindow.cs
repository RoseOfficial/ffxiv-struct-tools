using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dalamud.Interface.Windowing;
using Dalamud.Bindings.ImGui;
using Dalamud.Plugin.Services;
using StructValidator.Discovery;
using StructValidator.Memory;
using StructValidator.Models;
using StructValidator.Services;
using StructValidator.Services.Persistence;
using StructValidator.UI.Components;

namespace StructValidator.UI;

/// <summary>
/// Memory Explorer window for discovering struct layouts.
/// Supports navigation through pointer chains to explore non-singleton structs.
/// </summary>
public class MemoryExplorerWindow : Window, IDisposable
{
    private readonly StructValidationEngine validationEngine;
    private readonly Configuration configuration;
    private readonly SessionStore? sessionStore;
    private readonly SessionPanel? sessionPanel;
    private readonly VTableAnalyzerService vtableAnalyzer;
    private readonly ChangeMonitor changeMonitor;
    private readonly IPluginLog log;

    // Singleton selection
    private List<string> singletonNames = new();
    private int selectedSingletonIndex = -1;
    private string selectedSingletonName = "";

    // Navigation state
    private Stack<NavigationEntry> navigationHistory = new();
    private NavigationEntry? currentNavigation;

    // Manual address entry
    private string addressInput = "";
    private string sizeInput = "0x400";

    // Type selection for manual navigation
    private List<Type> allStructTypes = new();
    private int selectedTypeIndex = -1;
    private string typeSearchFilter = "";

    // Current analysis results
    private DiscoveredLayout? currentLayout;
    private StructValidationResult? currentValidation;
    private LayoutComparisonResult? currentComparison;
    private List<Memory.ArrayPattern>? currentArrayPatterns;
    private EnhancedVTableAnalysis? currentVTableAnalysis;

    private string statusMessage = "";

    // Field list state
    private DiscoveredField? selectedField;
    private bool showOnlyUnmatched = false;
    private bool showPadding = false;

    public MemoryExplorerWindow(
        StructValidationEngine validationEngine,
        Configuration configuration,
        SessionStore? sessionStore,
        IPluginLog log)
        : base("Memory Explorer##MemoryExplorer", ImGuiWindowFlags.None)
    {
        this.validationEngine = validationEngine;
        this.configuration = configuration;
        this.sessionStore = sessionStore;
        this.log = log;
        this.vtableAnalyzer = new VTableAnalyzerService(log);
        this.changeMonitor = new ChangeMonitor();

        if (sessionStore != null)
        {
            this.sessionPanel = new SessionPanel(sessionStore, msg => statusMessage = msg);
        }

        SizeConstraints = new WindowSizeConstraints
        {
            MinimumSize = new Vector2(900, 650),
            MaximumSize = new Vector2(float.MaxValue, float.MaxValue)
        };
    }

    public void Dispose()
    {
        changeMonitor?.Dispose();
    }

    /// <summary>
    /// Refresh the list of available singletons.
    /// </summary>
    public void RefreshSingletonList()
    {
        singletonNames = validationEngine.GetSingletonNames().ToList();
        singletonNames.Sort();
    }

    /// <summary>
    /// Refresh the list of all struct types for type selection.
    /// </summary>
    private void RefreshStructTypes()
    {
        TypeResolver.Initialize();
        allStructTypes = TypeResolver.GetAllStructTypes().ToList();
    }

    public override void OnOpen()
    {
        base.OnOpen();
        if (singletonNames.Count == 0)
        {
            RefreshSingletonList();
        }
        if (allStructTypes.Count == 0)
        {
            RefreshStructTypes();
        }
    }

    public override void Draw()
    {
        // Update change monitor
        changeMonitor.Update();

        DrawToolbar();
        ImGui.Separator();

        // Navigation breadcrumbs
        if (navigationHistory.Count > 0 || currentNavigation != null)
        {
            DrawNavigationBreadcrumbs();
            ImGui.Separator();
        }

        if (currentLayout == null)
        {
            DrawWelcomeMessage();
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

    private void DrawWelcomeMessage()
    {
        ImGui.TextWrapped("Memory Explorer - View struct layouts in game memory");
        ImGui.Spacing();
        ImGui.TextWrapped("Options:");
        ImGui.BulletText("Select a singleton from the dropdown and click 'Analyze'");
        ImGui.BulletText("Enter a memory address directly and click 'Go'");
        ImGui.BulletText("Click 'Explore' on pointer fields to navigate to their targets");
        ImGui.BulletText("Use the 'Watch' tab to monitor fields for changes during gameplay");
        ImGui.Spacing();
        ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f), "View memory with multiple interpretations (int/float/pointer). Use FFXIVClientStructs definitions for declared types.");
    }

    private void DrawToolbar()
    {
        // Row 1: Singleton selector
        ImGui.Text("Singleton:");
        ImGui.SameLine();
        ImGui.SetNextItemWidth(250);

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

        if (ImGui.Button("Refresh"))
        {
            RefreshSingletonList();
            RefreshStructTypes();
            statusMessage = $"Found {singletonNames.Count} singletons, {allStructTypes.Count} struct types";
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

            ImGui.SameLine();

            if (ImGui.Button("Export ReClass"))
            {
                ExportToReClass();
            }
        }

        // Row 2: Manual address entry
        ImGui.Text("Address: ");
        ImGui.SameLine();
        ImGui.SetNextItemWidth(150);
        ImGui.InputText("##AddressInput", ref addressInput, 32);

        ImGui.SameLine();
        ImGui.Text("Size:");
        ImGui.SameLine();
        ImGui.SetNextItemWidth(80);
        ImGui.InputText("##SizeInput", ref sizeInput, 16);

        ImGui.SameLine();
        ImGui.Text("Type:");
        ImGui.SameLine();
        ImGui.SetNextItemWidth(200);
        DrawTypeSelector();

        ImGui.SameLine();

        if (ImGui.Button("Go"))
        {
            NavigateToAddress();
        }
    }

    private void DrawTypeSelector()
    {
        var displayName = selectedTypeIndex >= 0 && selectedTypeIndex < allStructTypes.Count
            ? allStructTypes[selectedTypeIndex].Name
            : "(auto-detect)";

        if (ImGui.BeginCombo("##TypeCombo", displayName))
        {
            // Search filter
            ImGui.SetNextItemWidth(-1);
            ImGui.InputTextWithHint("##TypeSearch", "Search types...", ref typeSearchFilter, 64);

            // Auto option
            if (ImGui.Selectable("(auto-detect)", selectedTypeIndex == -1))
            {
                selectedTypeIndex = -1;
            }

            ImGui.Separator();

            // Filtered type list
            var filter = typeSearchFilter.ToLowerInvariant();
            for (int i = 0; i < allStructTypes.Count; i++)
            {
                var type = allStructTypes[i];
                var name = type.Name;

                if (!string.IsNullOrEmpty(filter) && !name.ToLowerInvariant().Contains(filter))
                    continue;

                bool isSelected = i == selectedTypeIndex;
                if (ImGui.Selectable(name, isSelected))
                {
                    selectedTypeIndex = i;
                }

                if (ImGui.IsItemHovered())
                {
                    ImGui.BeginTooltip();
                    ImGui.Text(type.FullName ?? name);
                    var size = TypeResolver.GetDeclaredSize(type);
                    if (size.HasValue)
                        ImGui.Text($"Size: 0x{size.Value:X}");
                    ImGui.EndTooltip();
                }

                if (isSelected)
                    ImGui.SetItemDefaultFocus();
            }
            ImGui.EndCombo();
        }
    }

    private void DrawNavigationBreadcrumbs()
    {
        // Back button
        var canGoBack = navigationHistory.Count > 0;
        if (!canGoBack)
            ImGui.BeginDisabled();

        if (ImGui.Button("<- Back"))
        {
            NavigateBack();
        }

        if (!canGoBack)
            ImGui.EndDisabled();

        ImGui.SameLine();
        ImGui.Text("Path:");
        ImGui.SameLine();

        // Build breadcrumb trail
        var entries = navigationHistory.Reverse().ToList();
        if (currentNavigation != null)
            entries.Add(currentNavigation);

        for (int i = 0; i < entries.Count; i++)
        {
            var entry = entries[i];
            var isLast = i == entries.Count - 1;

            if (i > 0)
            {
                ImGui.SameLine();
                ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1.0f), "->");
                ImGui.SameLine();
            }

            if (isLast)
            {
                ImGui.TextColored(new Vector4(0.8f, 0.8f, 1.0f, 1.0f), entry.DisplayName);
            }
            else
            {
                // Make earlier entries clickable
                if (ImGui.SmallButton($"{entry.DisplayName}##{i}"))
                {
                    // Navigate back to this entry
                    NavigateToHistoryIndex(i);
                }
            }

            if (ImGui.IsItemHovered())
            {
                ImGui.BeginTooltip();
                ImGui.Text($"Address: 0x{entry.Address:X}");
                ImGui.Text($"Size: 0x{entry.Size:X}");
                if (!string.IsNullOrEmpty(entry.TypeName))
                    ImGui.Text($"Type: {entry.TypeName}");
                ImGui.EndTooltip();
            }
        }
    }

    private void NavigateToHistoryIndex(int index)
    {
        var entries = navigationHistory.Reverse().ToList();
        if (index < 0 || index >= entries.Count)
            return;

        // Clear history past this point
        var newHistory = new Stack<NavigationEntry>();
        for (int i = 0; i < index; i++)
        {
            newHistory.Push(entries[i]);
        }

        navigationHistory = new Stack<NavigationEntry>(newHistory.Reverse());
        currentNavigation = entries[index];
        AnalyzeCurrentNavigation();
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
            var addrMatch = Regex.Match(instanceIssue.Message, @"0x([0-9A-Fa-f]+)");
            if (!addrMatch.Success)
            {
                statusMessage = "Failed to parse instance address";
                return;
            }

            nint address = nint.Parse(addrMatch.Groups[1].Value, NumberStyles.HexNumber);

            // Determine size to analyze
            int size = currentValidation.DeclaredSize ?? currentValidation.ActualSize ?? 0x400;

            // Clear navigation history and start fresh
            navigationHistory.Clear();
            currentNavigation = NavigationEntry.FromSingleton(address, size, fullName);

            // Run memory analysis
            AnalyzeCurrentNavigation();
        }
        catch (Exception ex)
        {
            statusMessage = $"Analysis failed: {ex.Message}";
        }
    }

    private void NavigateToAddress()
    {
        // Parse address
        var addrStr = addressInput.Trim();
        if (addrStr.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            addrStr = addrStr[2..];

        if (!nint.TryParse(addrStr, NumberStyles.HexNumber, null, out var address) || address == 0)
        {
            statusMessage = "Invalid address format. Use hex like 0x1A2B3C4D";
            return;
        }

        // Parse size
        var sizeStr = sizeInput.Trim();
        if (sizeStr.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            sizeStr = sizeStr[2..];

        if (!int.TryParse(sizeStr, NumberStyles.HexNumber, null, out var size) || size <= 0)
        {
            size = 0x400;
        }

        // Get type if selected
        string? typeName = null;
        if (selectedTypeIndex >= 0 && selectedTypeIndex < allStructTypes.Count)
        {
            typeName = allStructTypes[selectedTypeIndex].FullName;

            // Update size from type if available
            var declaredSize = TypeResolver.GetDeclaredSize(allStructTypes[selectedTypeIndex]);
            if (declaredSize.HasValue)
                size = declaredSize.Value;
        }

        // Clear navigation history and start fresh
        navigationHistory.Clear();
        currentNavigation = NavigationEntry.FromAddress(address, size, typeName);
        currentValidation = null;

        AnalyzeCurrentNavigation();
    }

    /// <summary>
    /// Navigate to a pointer target from a field.
    /// </summary>
    private void NavigateTo(nint address, int size, string? typeName, string sourceField, int sourceOffset)
    {
        if (address == 0)
        {
            statusMessage = "Cannot navigate to null pointer";
            return;
        }

        // Push current to history
        if (currentNavigation != null)
        {
            navigationHistory.Push(currentNavigation);
        }

        currentNavigation = NavigationEntry.FromPointer(address, size, typeName, sourceField, sourceOffset);
        currentValidation = null;

        AnalyzeCurrentNavigation();
    }

    private void NavigateBack()
    {
        if (navigationHistory.Count == 0)
            return;

        currentNavigation = navigationHistory.Pop();
        AnalyzeCurrentNavigation();
    }

    private void AnalyzeCurrentNavigation()
    {
        if (currentNavigation == null)
        {
            currentLayout = null;
            statusMessage = "No navigation target";
            return;
        }

        statusMessage = "Analyzing...";

        try
        {
            // Run memory analysis
            currentLayout = MemoryAnalyzer.Analyze(
                currentNavigation.Address,
                currentNavigation.Size,
                currentNavigation.TypeName ?? "");

            // Update with type info if we have it
            if (!string.IsNullOrEmpty(currentNavigation.TypeName))
            {
                var type = TypeResolver.FindType(currentNavigation.TypeName);
                if (type != null)
                {
                    LayoutComparator.UpdateWithDeclaredFieldsFromType(currentLayout, type);
                }
            }
            else if (currentValidation != null)
            {
                // Use validation result if we have one (from singleton)
                LayoutComparator.UpdateWithDeclaredFields(currentLayout, currentValidation);
                currentComparison = LayoutComparator.Compare(currentLayout, currentValidation);
            }

            statusMessage = $"Analyzed {currentLayout.Fields.Count} fields, {currentLayout.Summary.MatchedFields} matched, {currentLayout.Summary.UndocumentedFields} undocumented";
            selectedField = null;

            // Update address input to show current address
            addressInput = $"0x{currentNavigation.Address:X}";
            sizeInput = $"0x{currentNavigation.Size:X}";
        }
        catch (Exception ex)
        {
            statusMessage = $"Analysis failed: {ex.Message}";
            currentLayout = null;
        }
    }

    /// <summary>
    /// Try to resolve the pointer target type from field info.
    /// </summary>
    private string? TryResolvePointerType(DiscoveredField field)
    {
        // If we have declared type info like "Character*" or "Pointer<Character>"
        if (!string.IsNullOrEmpty(field.DeclaredType))
        {
            var resolvedType = TypeResolver.ResolvePointerTargetType(field.DeclaredType);
            if (resolvedType != null)
                return resolvedType.FullName;
        }

        // Try vtable detection
        if (field.PointerTarget.HasValue && field.PointerTarget.Value != 0)
        {
            var detected = TypeResolver.ResolveFromVTable(field.PointerTarget.Value);
            if (detected != null)
                return detected.FullName;
        }

        return null;
    }

    /// <summary>
    /// Get size for a pointer target, using type info if available.
    /// </summary>
    private int GetPointerTargetSize(string? typeName)
    {
        if (!string.IsNullOrEmpty(typeName))
        {
            var type = TypeResolver.FindType(typeName);
            if (type != null)
            {
                var size = TypeResolver.GetDeclaredSize(type);
                if (size.HasValue)
                    return size.Value;
            }
        }
        return 0x400; // Default size
    }

    private void DrawMainContent()
    {
        if (currentLayout == null) return;

        // Summary bar
        DrawSummary();

        ImGui.Separator();

        // Tab bar
        if (ImGui.BeginTabBar("ExplorerTabs"))
        {
            // Fields tab
            if (ImGui.BeginTabItem("Fields"))
            {
                DrawFieldsTab();
                ImGui.EndTabItem();
            }

            // Comparison tab
            if (ImGui.BeginTabItem("Comparison"))
            {
                DrawComparisonTab();
                ImGui.EndTabItem();
            }

            // Arrays tab
            if (ImGui.BeginTabItem("Arrays"))
            {
                DrawArraysTab();
                ImGui.EndTabItem();
            }

            // VTable tab
            if (ImGui.BeginTabItem("VTable"))
            {
                DrawVTableTab();
                ImGui.EndTabItem();
            }

            // Watch tab for change monitoring
            if (ImGui.BeginTabItem("Watch"))
            {
                DrawWatchTab();
                ImGui.EndTabItem();
            }

            // Sessions tab (only if session storage is available)
            if (sessionPanel != null && ImGui.BeginTabItem("Sessions"))
            {
                DrawSessionsTab();
                ImGui.EndTabItem();
            }

            ImGui.EndTabBar();
        }
    }

    private void DrawWatchTab()
    {
        ChangeMonitorPanel.Draw(
            changeMonitor,
            address =>
            {
                // Navigate to watched address
                addressInput = $"0x{address:X}";
                NavigateToAddress();
            });
    }

    private void DrawFieldsTab()
    {
        // Filters
        ImGui.Checkbox("Show Only Unmatched", ref showOnlyUnmatched);
        ImGui.SameLine();
        ImGui.Checkbox("Show Padding", ref showPadding);

        ImGui.Separator();

        // Split view
        var availableWidth = ImGui.GetContentRegionAvail().X;
        var listWidth = availableWidth * 0.55f;
        var detailWidth = availableWidth * 0.45f - 10;

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

    private void DrawComparisonTab()
    {
        ComparisonPanel.Draw(currentComparison, currentLayout);
    }

    private void DrawArraysTab()
    {
        // Detect Arrays button
        if (ImGui.Button("Detect Arrays"))
        {
            DetectArrayPatterns();
        }

        if (currentArrayPatterns != null && currentArrayPatterns.Count > 0)
        {
            ImGui.SameLine();
            ImGui.Text($"({currentArrayPatterns.Count} patterns found)");
        }

        ImGui.Separator();

        ArrayPatternPanel.Draw(currentArrayPatterns, OnCopyArrayPattern);
    }

    private void DetectArrayPatterns()
    {
        if (currentLayout == null || currentNavigation == null) return;

        statusMessage = "Detecting array patterns...";

        try
        {
            var result = PatternRecognizer.DetectPatterns(
                currentNavigation.Address,
                currentNavigation.Size);
            currentArrayPatterns = result.ArrayPatterns;

            statusMessage = $"Detected {currentArrayPatterns.Count} potential array patterns";
        }
        catch (Exception ex)
        {
            statusMessage = $"Array detection failed: {ex.Message}";
        }
    }

    private void OnCopyArrayPattern(Memory.ArrayPattern pattern)
    {
        var suggestedType = $"FixedArray<byte, {pattern.Stride}>";
        var yaml = $"      - type: {suggestedType}\n" +
                   $"        name: Array_0x{pattern.StartOffset:X}\n" +
                   $"        offset: 0x{pattern.StartOffset:X}\n" +
                   $"        size: {pattern.Count}";

        ImGui.SetClipboardText(yaml);
        statusMessage = $"Copied YAML for array at 0x{pattern.StartOffset:X} to clipboard";
    }

    private void DrawVTableTab()
    {
        // Analyze VTable button
        if (ImGui.Button("Analyze VTable"))
        {
            AnalyzeVTable();
        }

        if (currentVTableAnalysis != null && currentVTableAnalysis.IsValid)
        {
            ImGui.SameLine();
            ImGui.TextColored(new Vector4(0.5f, 1f, 0.5f, 1f),
                $"({currentVTableAnalysis.Slots.Count} slots, {currentVTableAnalysis.MatchedSlotCount} declared)");
        }

        ImGui.Separator();

        VTablePanel.Draw(
            currentVTableAnalysis,
            OnExportVTableIDA,
            OnExportVTableGhidra,
            OnCopyVTableAddresses);
    }

    private void AnalyzeVTable()
    {
        if (currentLayout == null || currentNavigation == null)
        {
            statusMessage = "No struct analyzed. Analyze a struct first.";
            return;
        }

        statusMessage = "Analyzing VTable...";

        try
        {
            // Get the struct type if available
            Type? structType = null;
            if (!string.IsNullOrEmpty(currentNavigation.TypeName))
            {
                structType = TypeResolver.FindType(currentNavigation.TypeName);
            }

            // Run VTable analysis
            currentVTableAnalysis = vtableAnalyzer.Analyze(currentNavigation.Address, structType);

            if (currentVTableAnalysis.IsValid)
            {
                statusMessage = $"VTable analysis complete: {currentVTableAnalysis.Slots.Count} slots, " +
                               $"{currentVTableAnalysis.MatchedSlotCount} declared, " +
                               $"{currentVTableAnalysis.UndeclaredSlotCount} undeclared";
            }
            else
            {
                statusMessage = "No valid VTable found at this address";
            }
        }
        catch (Exception ex)
        {
            statusMessage = $"VTable analysis failed: {ex.Message}";
            log.Error($"VTable analysis error: {ex}");
        }
    }

    private void OnExportVTableIDA(EnhancedVTableAnalysis analysis)
    {
        try
        {
            var script = vtableAnalyzer.ExportToIDA(analysis);
            var structName = analysis.StructName?.Split('.').LastOrDefault() ?? "VTable";
            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                $"vtable-{structName}-{DateTime.Now:yyyyMMdd-HHmmss}.py");

            File.WriteAllText(path, script);
            statusMessage = $"Exported IDA script to {path}";
        }
        catch (Exception ex)
        {
            statusMessage = $"IDA export failed: {ex.Message}";
        }
    }

    private void OnExportVTableGhidra(EnhancedVTableAnalysis analysis)
    {
        try
        {
            var script = vtableAnalyzer.ExportToGhidra(analysis);
            var structName = analysis.StructName?.Split('.').LastOrDefault() ?? "VTable";
            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                $"vtable-{structName}-{DateTime.Now:yyyyMMdd-HHmmss}-ghidra.py");

            File.WriteAllText(path, script);
            statusMessage = $"Exported Ghidra script to {path}";
        }
        catch (Exception ex)
        {
            statusMessage = $"Ghidra export failed: {ex.Message}";
        }
    }

    private void OnCopyVTableAddresses(EnhancedVTableAnalysis analysis)
    {
        try
        {
            var text = vtableAnalyzer.ExportAddressList(analysis);
            ImGui.SetClipboardText(text);
            statusMessage = "Copied VTable addresses to clipboard";
        }
        catch (Exception ex)
        {
            statusMessage = $"Copy failed: {ex.Message}";
        }
    }

    private void DrawSessionsTab()
    {
        if (sessionPanel == null) return;

        var currentAnalysisResult = BuildCurrentAnalysisResult();
        sessionPanel.Draw(currentAnalysisResult, OnSessionLoaded);
    }

    private AnalysisResult? BuildCurrentAnalysisResult()
    {
        if (currentLayout == null || currentNavigation == null)
            return null;

        // Convert array patterns to the models format
        List<Models.ArrayPattern>? detectedArrays = null;
        if (currentArrayPatterns != null)
        {
            detectedArrays = currentArrayPatterns.Select(p => new Models.ArrayPattern
            {
                Offset = p.StartOffset,
                Stride = p.Stride,
                Count = p.Count,
                Confidence = p.Confidence
            }).ToList();
        }

        return new AnalysisResult
        {
            StructName = currentLayout.StructName,
            Address = currentNavigation.Address,
            AddressHex = $"0x{currentNavigation.Address:X}",
            Timestamp = DateTime.UtcNow,
            GameVersion = validationEngine.GameVersion,
            Discovery = currentLayout,
            Comparison = currentComparison,
            DetectedArrays = detectedArrays
        };
    }

    private void OnSessionLoaded(SavedSession session)
    {
        if (session.Result == null)
        {
            statusMessage = "Session has no analysis result";
            return;
        }

        // Restore the analysis state from the session
        currentLayout = session.Result.Discovery;
        currentComparison = session.Result.Comparison;

        // Convert detected arrays back to memory format
        if (session.Result.DetectedArrays != null)
        {
            currentArrayPatterns = session.Result.DetectedArrays.Select(a => new Memory.ArrayPattern
            {
                StartOffset = a.Offset,
                Stride = a.Stride,
                Count = a.Count,
                Confidence = a.Confidence
            }).ToList();
        }
        else
        {
            currentArrayPatterns = null;
        }

        // Update navigation state (limited since we may not have the original address accessible)
        if (currentLayout != null)
        {
            currentNavigation = new NavigationEntry
            {
                Address = session.Result.Address,
                Size = currentLayout.AnalyzedSize,
                TypeName = currentLayout.StructName,
                DisplayName = $"Session: {session.Name}"
            };
        }

        statusMessage = $"Loaded session: {session.Name}";
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
        if (currentLayout == null || currentNavigation == null) return;

        // Multi-interpretation table
        if (ImGui.BeginTable("FieldsTable", 8, ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg | ImGuiTableFlags.Resizable | ImGuiTableFlags.ScrollY))
        {
            ImGui.TableSetupColumn("Offset", ImGuiTableColumnFlags.None, 55);
            ImGui.TableSetupColumn("Hex", ImGuiTableColumnFlags.None, 80);
            ImGui.TableSetupColumn("Int", ImGuiTableColumnFlags.None, 70);
            ImGui.TableSetupColumn("Float", ImGuiTableColumnFlags.None, 70);
            ImGui.TableSetupColumn("Ptr", ImGuiTableColumnFlags.None, 70);
            ImGui.TableSetupColumn("Declared", ImGuiTableColumnFlags.None, 100);
            ImGui.TableSetupColumn("", ImGuiTableColumnFlags.WidthFixed, 25); // Navigate
            ImGui.TableSetupColumn("", ImGuiTableColumnFlags.WidthFixed, 25); // Watch
            ImGui.TableSetupScrollFreeze(0, 1);
            ImGui.TableHeadersRow();

            var fields = currentLayout.Fields
                .Where(f => !showOnlyUnmatched || !f.HasMatch)
                .Where(f => showPadding || f.InferredType != InferredTypeKind.Padding);

            foreach (var field in fields)
            {
                ImGui.TableNextRow();

                // Row color based on match status only
                Vector4 rowColor;
                if (field.HasMatch)
                    rowColor = new Vector4(0.5f, 1.0f, 0.5f, 1.0f);
                else if (field.InferredType == InferredTypeKind.Padding)
                    rowColor = new Vector4(0.5f, 0.5f, 0.5f, 1.0f);
                else
                    rowColor = new Vector4(1.0f, 1.0f, 1.0f, 1.0f);

                ImGui.PushStyleColor(ImGuiCol.Text, rowColor);

                // Get multi-interpretation for this field
                var address = currentNavigation.Address + field.Offset;
                var interp = TypeInference.GetInterpretations(address, Math.Min(field.Size, 8));

                // Offset (selectable)
                ImGui.TableNextColumn();
                bool isSelected = selectedField == field;
                if (ImGui.Selectable($"0x{field.Offset:X}##field{field.Offset}", isSelected, ImGuiSelectableFlags.SpanAllColumns))
                {
                    selectedField = field;
                }

                // Hex bytes
                ImGui.TableNextColumn();
                var hexDisplay = interp.HexString.Length > 12 ? interp.HexString[..12] + ".." : interp.HexString;
                ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f), hexDisplay);

                // Int interpretation
                ImGui.TableNextColumn();
                if (field.Size >= 4 && interp.AsInt32 != null)
                {
                    ImGui.Text(interp.AsInt32);
                }
                else if (field.Size >= 2 && interp.AsInt16 != null)
                {
                    ImGui.Text(interp.AsInt16);
                }
                else if (interp.AsInt8 != null)
                {
                    ImGui.Text(interp.AsInt8);
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.4f, 0.4f, 0.4f, 1.0f), "-");
                }

                // Float interpretation
                ImGui.TableNextColumn();
                if (field.Size >= 4 && interp.AsFloat != null)
                {
                    if (interp.FloatIsInvalid)
                        ImGui.TextColored(new Vector4(0.4f, 0.4f, 0.4f, 1.0f), "NaN");
                    else
                        ImGui.Text(interp.AsFloat);
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.4f, 0.4f, 0.4f, 1.0f), "-");
                }

                // Pointer interpretation
                ImGui.TableNextColumn();
                if (field.Size >= 8 && interp.AsPointer != null)
                {
                    if (interp.IsValidPointer)
                        ImGui.TextColored(new Vector4(0.6f, 0.8f, 1.0f, 1.0f), "valid");
                    else if (interp.PointerValue == 0)
                        ImGui.TextColored(new Vector4(0.4f, 0.4f, 0.4f, 1.0f), "null");
                    else
                        ImGui.TextColored(new Vector4(0.4f, 0.4f, 0.4f, 1.0f), "inv");
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.4f, 0.4f, 0.4f, 1.0f), "-");
                }

                // Declared name/type
                ImGui.TableNextColumn();
                if (field.HasMatch)
                {
                    ImGui.Text(field.DeclaredName ?? "");
                    if (ImGui.IsItemHovered() && !string.IsNullOrEmpty(field.DeclaredType))
                    {
                        ImGui.SetTooltip(field.DeclaredType);
                    }
                }
                else
                {
                    ImGui.TextColored(new Vector4(0.4f, 0.4f, 0.4f, 1.0f), "-");
                }

                // Navigate button for valid pointers
                ImGui.TableNextColumn();
                if (interp.IsValidPointer && interp.PointerValue != 0)
                {
                    if (ImGui.SmallButton($"->##nav{field.Offset}"))
                    {
                        var targetType = TryResolvePointerType(field);
                        var targetSize = GetPointerTargetSize(targetType);
                        NavigateTo(
                            interp.PointerValue,
                            targetSize,
                            targetType,
                            field.DeclaredName ?? $"0x{field.Offset:X}",
                            field.Offset);
                    }
                    if (ImGui.IsItemHovered())
                    {
                        ImGui.SetTooltip($"Navigate to 0x{interp.PointerValue:X}");
                    }
                }

                // Watch button
                ImGui.TableNextColumn();
                var isWatching = changeMonitor.IsWatching(address);
                if (isWatching)
                {
                    if (ImGui.SmallButton($"-##unwatch{field.Offset}"))
                    {
                        changeMonitor.UnwatchAddress(address);
                    }
                    if (ImGui.IsItemHovered())
                    {
                        ImGui.SetTooltip("Stop watching");
                    }
                }
                else
                {
                    if (ImGui.SmallButton($"+##watch{field.Offset}"))
                    {
                        var label = field.DeclaredName ?? $"0x{field.Offset:X}";
                        changeMonitor.WatchAddress(address, field.Size, label);
                    }
                    if (ImGui.IsItemHovered())
                    {
                        ImGui.SetTooltip("Watch for changes");
                    }
                }

                ImGui.PopStyleColor();
            }

            ImGui.EndTable();
        }
    }

    private void DrawFieldDetails()
    {
        if (selectedField == null || currentNavigation == null)
        {
            ImGui.TextWrapped("Select a field from the list to view details.");
            return;
        }

        var field = selectedField;
        var address = currentNavigation.Address + field.Offset;
        var interp = TypeInference.GetInterpretations(address, Math.Min(field.Size, 8));

        // Header
        ImGui.TextColored(new Vector4(0.8f, 0.8f, 1.0f, 1.0f), $"Field at offset 0x{field.Offset:X}");
        ImGui.Text($"Address: 0x{address:X}");
        ImGui.Text($"Size: {field.Size} bytes");

        ImGui.Separator();

        // Declared info (from FFXIVClientStructs)
        if (field.HasMatch)
        {
            ImGui.TextColored(new Vector4(0.5f, 1.0f, 0.5f, 1.0f), "Declared (FFXIVClientStructs):");
            ImGui.Indent();
            ImGui.Text($"Name: {field.DeclaredName}");
            ImGui.Text($"Type: {field.DeclaredType}");
            ImGui.Unindent();
        }
        else
        {
            ImGui.TextColored(new Vector4(0.6f, 0.6f, 0.6f, 1.0f), "No declared field at this offset");
        }

        ImGui.Separator();

        // All interpretations (shown equally)
        ImGui.Text("All Interpretations:");
        ImGui.Indent();

        ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f), $"Hex: {interp.HexString}");

        if (interp.AsInt8 != null)
            ImGui.Text($"Int8: {interp.AsInt8}  |  UInt8: {interp.AsUInt8}");
        if (interp.AsInt16 != null)
            ImGui.Text($"Int16: {interp.AsInt16}  |  UInt16: {interp.AsUInt16}");
        if (interp.AsInt32 != null)
            ImGui.Text($"Int32: {interp.AsInt32}  |  UInt32: {interp.AsUInt32}");
        if (interp.AsInt64 != null)
            ImGui.Text($"Int64: {interp.AsInt64}");
        if (interp.AsFloat != null)
        {
            if (interp.FloatIsInvalid)
                ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1.0f), "Float: (NaN/Infinity)");
            else
                ImGui.Text($"Float: {interp.AsFloat}");
        }
        if (interp.AsDouble != null)
            ImGui.Text($"Double: {interp.AsDouble}");
        if (interp.AsPointer != null)
        {
            var ptrColor = interp.IsValidPointer
                ? new Vector4(0.6f, 0.8f, 1.0f, 1.0f)
                : new Vector4(0.5f, 0.5f, 0.5f, 1.0f);
            ImGui.TextColored(ptrColor, $"Pointer: {interp.AsPointer}");
            if (interp.IsValidPointer && !string.IsNullOrEmpty(interp.PointerTargetDescription))
            {
                ImGui.TextColored(new Vector4(0.6f, 0.6f, 0.6f, 1.0f), $"  -> {interp.PointerTargetDescription}");
            }
        }

        ImGui.Unindent();

        // Factual observations
        if (interp.IsAllZeros || interp.IsDebugPattern)
        {
            ImGui.Separator();
            ImGui.Text("Observations:");
            ImGui.Indent();
            if (interp.IsAllZeros)
                ImGui.TextColored(new Vector4(0.6f, 0.6f, 0.6f, 1.0f), "All zeros");
            if (interp.IsDebugPattern)
                ImGui.TextColored(new Vector4(1.0f, 0.6f, 0.3f, 1.0f), "Debug/uninitialized pattern");
            ImGui.Unindent();
        }

        ImGui.Separator();

        // Actions
        if (interp.IsValidPointer && interp.PointerValue != 0)
        {
            if (ImGui.Button("Navigate to Pointer Target"))
            {
                var targetType = TryResolvePointerType(field);
                var targetSize = GetPointerTargetSize(targetType);
                NavigateTo(
                    interp.PointerValue,
                    targetSize,
                    targetType,
                    field.DeclaredName ?? $"0x{field.Offset:X}",
                    field.Offset);
            }
        }

        // Watch button
        var isWatching = changeMonitor.IsWatching(address);
        if (isWatching)
        {
            if (ImGui.Button("Stop Watching"))
            {
                changeMonitor.UnwatchAddress(address);
            }
        }
        else
        {
            if (ImGui.Button("Watch for Changes"))
            {
                var label = field.DeclaredName ?? $"0x{field.Offset:X}";
                changeMonitor.WatchAddress(address, field.Size, label);
            }
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
                GameVersion = "Unknown",
                Layouts = new List<DiscoveredLayout> { currentLayout },
                Summary = new DiscoveryReportSummary
                {
                    TotalStructsAnalyzed = 1,
                    TotalFieldsDiscovered = currentLayout.Fields.Count,
                    TotalUndocumentedFields = currentLayout.Summary.UndocumentedFields,
                    TotalPointersFound = currentLayout.Summary.PointerCount
                }
            };

            var structName = currentLayout.StructName.Split('.').LastOrDefault() ?? "Unknown";
            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                $"discovery-{structName}-{DateTime.Now:yyyyMMdd-HHmmss}.json"
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
            var structName = currentLayout.StructName.Split('.').LastOrDefault() ?? "Unknown";
            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                $"discovery-{structName}-{DateTime.Now:yyyyMMdd-HHmmss}.yaml"
            );

            using var writer = new StreamWriter(path);

            writer.WriteLine($"# Auto-discovered layout for {currentLayout.StructName}");
            writer.WriteLine($"# Analyzed: {currentLayout.Timestamp:yyyy-MM-dd HH:mm:ss}");
            writer.WriteLine($"# Address: 0x{currentLayout.BaseAddress:X}");
            writer.WriteLine();
            writer.WriteLine("structs:");
            writer.WriteLine($"  - type: {structName}_Discovered");
            writer.WriteLine($"    size: 0x{currentLayout.AnalyzedSize:X}");
            writer.WriteLine("    fields:");

            foreach (var field in currentLayout.Fields.Where(f => f.InferredType != InferredTypeKind.Padding))
            {
                var name = field.DeclaredName ?? $"Unknown_0x{field.Offset:X}";
                var type = field.HasMatch ? field.DeclaredType ?? MapToYamlType(field) : MapToYamlType(field);

                writer.WriteLine($"      - type: {type}");
                writer.WriteLine($"        name: {name}");
                writer.WriteLine($"        offset: 0x{field.Offset:X}");

                if (!field.HasMatch)
                {
                    writer.WriteLine($"        # Not in FFXIVClientStructs - type is unknown");
                }
            }

            statusMessage = $"Exported to {path}";
        }
        catch (Exception ex)
        {
            statusMessage = $"Export failed: {ex.Message}";
        }
    }

    private void ExportToReClass()
    {
        if (currentLayout == null) return;

        try
        {
            var exporter = new ReClassExporter();
            var rcnet = exporter.ExportToRcnet(currentLayout);

            var structName = currentLayout.StructName.Split('.').LastOrDefault() ?? "Unknown";
            var path = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                $"reclass-{structName}-{DateTime.Now:yyyyMMdd-HHmmss}.rcnet"
            );

            File.WriteAllText(path, rcnet);
            statusMessage = $"Exported ReClass project to {path}";
        }
        catch (Exception ex)
        {
            statusMessage = $"ReClass export failed: {ex.Message}";
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
