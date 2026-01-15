using System;
using System.IO;
using System.Text.Json;
using Dalamud.Game.Command;
using Dalamud.IoC;
using Dalamud.Plugin;
using Dalamud.Plugin.Services;
using Dalamud.Interface.Windowing;
using Dalamud.Bindings.ImGui;
using StructValidator.Memory;
using StructValidator.Services;
using StructValidator.Services.Persistence;
using StructValidator.UI;

namespace StructValidator;

/// <summary>
/// Dalamud plugin for validating FFXIVClientStructs definitions against live game memory.
/// </summary>
public sealed class Plugin : IDalamudPlugin
{
    public string Name => "Struct Validator";

    private const string CommandName = "/structval";
    private const string CommandRunAll = "/structvalall";
    private const string CommandExport = "/structvalexport";
    private const string CommandExplore = "/structexplore";
    private const string CommandRefresh = "/structvalrefresh";
    private const string CommandBatch = "/structbatch";
    private const string CommandSig = "/structsig";
    private const string CommandVersion = "/structversion";

    private readonly IDalamudPluginInterface pluginInterface;
    private readonly ICommandManager commandManager;
    private readonly IChatGui chatGui;
    private readonly IPluginLog pluginLog;

    private readonly WindowSystem windowSystem = new("StructValidator");
    private readonly MainWindow mainWindow;
    private readonly MemoryExplorerWindow memoryExplorerWindow;
    private readonly BatchAnalysisWindow batchAnalysisWindow;
    private readonly SignatureWindow signatureWindow;
    private readonly StructValidationEngine validationEngine;
    private readonly Configuration configuration;
    private readonly SessionStore sessionStore;
    private readonly BatchAnalyzer batchAnalyzer;
    private readonly ExportService exportService;
    private readonly SignatureGenerator signatureGenerator;
    private readonly VersionTracker versionTracker;
    private readonly VersionHistoryWindow versionHistoryWindow;

    public Plugin(
        IDalamudPluginInterface pluginInterface,
        ICommandManager commandManager,
        IChatGui chatGui,
        IPluginLog pluginLog)
    {
        this.pluginInterface = pluginInterface;
        this.commandManager = commandManager;
        this.chatGui = chatGui;
        this.pluginLog = pluginLog;

        this.configuration = pluginInterface.GetPluginConfig() as Configuration ?? new Configuration();
        this.configuration.Initialize(pluginInterface);

        this.validationEngine = new StructValidationEngine(pluginLog);

        // Build VTable cache for type resolution
        var vtableCount = TypeResolver.BuildVTableCache();
        pluginLog.Info($"Built VTable cache with {vtableCount} type mappings");

        // Create persistence and service layer
        var configPath = Path.GetDirectoryName(pluginInterface.GetPluginConfigDirectory()) ?? pluginInterface.GetPluginConfigDirectory();
        this.sessionStore = new SessionStore(configPath, pluginLog);
        this.batchAnalyzer = new BatchAnalyzer(validationEngine, pluginLog);
        this.exportService = new ExportService(pluginLog);
        this.signatureGenerator = new SignatureGenerator(pluginLog);
        this.versionTracker = new VersionTracker(
            new VersionStore(configPath, pluginLog),
            validationEngine,
            pluginLog);
        this.versionTracker.Initialize();

        // Create windows
        this.mainWindow = new MainWindow(this, validationEngine, configuration);
        this.memoryExplorerWindow = new MemoryExplorerWindow(validationEngine, configuration, sessionStore, pluginLog);
        this.batchAnalysisWindow = new BatchAnalysisWindow(batchAnalyzer, exportService, pluginLog, configPath);
        this.signatureWindow = new SignatureWindow(signatureGenerator, validationEngine, pluginLog);
        this.versionHistoryWindow = new VersionHistoryWindow(versionTracker, pluginLog);

        windowSystem.AddWindow(mainWindow);
        windowSystem.AddWindow(memoryExplorerWindow);
        windowSystem.AddWindow(batchAnalysisWindow);
        windowSystem.AddWindow(signatureWindow);
        windowSystem.AddWindow(versionHistoryWindow);

        commandManager.AddHandler(CommandName, new CommandInfo(OnCommand)
        {
            HelpMessage = "Open the Struct Validator window"
        });

        commandManager.AddHandler(CommandRunAll, new CommandInfo(OnRunAllCommand)
        {
            HelpMessage = "Run all struct validations and output results"
        });

        commandManager.AddHandler(CommandExport, new CommandInfo(OnExportCommand)
        {
            HelpMessage = "Export validation results to JSON file"
        });

        commandManager.AddHandler(CommandExplore, new CommandInfo(OnExploreCommand)
        {
            HelpMessage = "Open the Memory Explorer to discover struct layouts"
        });

        commandManager.AddHandler(CommandRefresh, new CommandInfo(OnRefreshCommand)
        {
            HelpMessage = "Rebuild the VTable type cache"
        });

        commandManager.AddHandler(CommandBatch, new CommandInfo(OnBatchCommand)
        {
            HelpMessage = "Open the Batch Analysis window"
        });

        commandManager.AddHandler(CommandSig, new CommandInfo(OnSigCommand)
        {
            HelpMessage = "Open the Signature Generator window"
        });

        commandManager.AddHandler(CommandVersion, new CommandInfo(OnVersionCommand)
        {
            HelpMessage = "Open the Version History window"
        });

        pluginInterface.UiBuilder.Draw += DrawUI;
        pluginInterface.UiBuilder.OpenConfigUi += OnOpenConfigUi;
    }

    public void Dispose()
    {
        windowSystem.RemoveAllWindows();
        mainWindow.Dispose();
        memoryExplorerWindow.Dispose();
        batchAnalysisWindow.Dispose();
        signatureWindow.Dispose();
        versionHistoryWindow.Dispose();

        commandManager.RemoveHandler(CommandName);
        commandManager.RemoveHandler(CommandRunAll);
        commandManager.RemoveHandler(CommandExport);
        commandManager.RemoveHandler(CommandExplore);
        commandManager.RemoveHandler(CommandRefresh);
        commandManager.RemoveHandler(CommandBatch);
        commandManager.RemoveHandler(CommandSig);
        commandManager.RemoveHandler(CommandVersion);
    }

    private void OnCommand(string command, string args)
    {
        mainWindow.IsOpen = true;
    }

    private void OnExploreCommand(string command, string args)
    {
        memoryExplorerWindow.IsOpen = true;
    }

    private void OnRefreshCommand(string command, string args)
    {
        chatGui.Print("[StructValidator] Refreshing VTable cache...");
        TypeResolver.ClearVTableCache();
        var count = TypeResolver.BuildVTableCache();
        chatGui.Print($"[StructValidator] VTable cache rebuilt with {count} type mappings");
    }

    private void OnBatchCommand(string command, string args)
    {
        batchAnalysisWindow.IsOpen = true;
    }

    private void OnSigCommand(string command, string args)
    {
        signatureWindow.IsOpen = true;
    }

    private void OnVersionCommand(string command, string args)
    {
        versionHistoryWindow.IsOpen = true;
    }

    private void OnRunAllCommand(string command, string args)
    {
        chatGui.Print("[StructValidator] Running all validations...");

        var report = validationEngine.ValidateAll();

        var passed = report.Summary.FailedStructs == 0;
        var color = passed ? 0xFF00FF00u : 0xFF0000FFu; // Green or Red (ABGR format)

        chatGui.Print($"[StructValidator] Validation complete: {report.Summary.PassedStructs} passed, {report.Summary.FailedStructs} failed");

        if (report.Summary.FailedStructs > 0)
        {
            chatGui.Print("[StructValidator] Use /structvalexport to export detailed results");
        }
    }

    private void OnExportCommand(string command, string args)
    {
        var outputPath = args.Trim();
        if (string.IsNullOrEmpty(outputPath))
        {
            outputPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                $"struct-validation-{DateTime.Now:yyyyMMdd-HHmmss}.json"
            );
        }

        try
        {
            var report = validationEngine.ValidateAll();
            var json = JsonSerializer.Serialize(report, new JsonSerializerOptions
            {
                WriteIndented = true,
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            });

            File.WriteAllText(outputPath, json);
            chatGui.Print($"[StructValidator] Report exported to: {outputPath}");
        }
        catch (Exception ex)
        {
            chatGui.PrintError($"[StructValidator] Export failed: {ex.Message}");
            pluginLog.Error(ex, "Failed to export validation report");
        }
    }

    private void DrawUI()
    {
        windowSystem.Draw();
    }

    private void OnOpenConfigUi()
    {
        mainWindow.IsOpen = true;
    }
}
