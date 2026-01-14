using System;
using System.IO;
using System.Text.Json;
using Dalamud.Game.Command;
using Dalamud.IoC;
using Dalamud.Plugin;
using Dalamud.Plugin.Services;
using Dalamud.Interface.Windowing;
using Dalamud.Bindings.ImGui;

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

    private readonly IDalamudPluginInterface pluginInterface;
    private readonly ICommandManager commandManager;
    private readonly IChatGui chatGui;
    private readonly IPluginLog pluginLog;

    private readonly WindowSystem windowSystem = new("StructValidator");
    private readonly MainWindow mainWindow;
    private readonly StructValidationEngine validationEngine;
    private readonly Configuration configuration;

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
        this.mainWindow = new MainWindow(this, validationEngine, configuration);

        windowSystem.AddWindow(mainWindow);

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

        pluginInterface.UiBuilder.Draw += DrawUI;
        pluginInterface.UiBuilder.OpenConfigUi += OnOpenConfigUi;
    }

    public void Dispose()
    {
        windowSystem.RemoveAllWindows();
        mainWindow.Dispose();

        commandManager.RemoveHandler(CommandName);
        commandManager.RemoveHandler(CommandRunAll);
        commandManager.RemoveHandler(CommandExport);
    }

    private void OnCommand(string command, string args)
    {
        mainWindow.IsOpen = true;
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
