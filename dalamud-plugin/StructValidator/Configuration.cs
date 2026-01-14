using System;
using Dalamud.Configuration;
using Dalamud.Plugin;

namespace StructValidator;

/// <summary>
/// Plugin configuration.
/// </summary>
[Serializable]
public class Configuration : IPluginConfiguration
{
    public int Version { get; set; } = 0;

    /// <summary>
    /// Whether to show info-level issues in results.
    /// </summary>
    public bool ShowInfoIssues { get; set; } = true;

    /// <summary>
    /// Whether to show warnings in results.
    /// </summary>
    public bool ShowWarnings { get; set; } = true;

    /// <summary>
    /// Default export path.
    /// </summary>
    public string DefaultExportPath { get; set; } = "";

    /// <summary>
    /// Whether to auto-export on validation.
    /// </summary>
    public bool AutoExport { get; set; } = false;

    /// <summary>
    /// Namespace filter for validation (empty = all).
    /// </summary>
    public string NamespaceFilter { get; set; } = "";

    /// <summary>
    /// Whether to validate only structs with declared sizes.
    /// </summary>
    public bool OnlyDeclaredSizes { get; set; } = false;

    [NonSerialized]
    private IDalamudPluginInterface? pluginInterface;

    public void Initialize(IDalamudPluginInterface pluginInterface)
    {
        this.pluginInterface = pluginInterface;
    }

    public void Save()
    {
        pluginInterface?.SavePluginConfig(this);
    }
}
