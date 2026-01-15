using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using System.Threading.Tasks;
using Dalamud.Bindings.ImGui;
using StructValidator.Models;
using StructValidator.Services.Persistence;

namespace StructValidator.UI.Components;

/// <summary>
/// ImGui panel for managing saved analysis sessions.
/// </summary>
public class SessionPanel
{
    private readonly SessionStore _sessionStore;
    private readonly Action<string> _onStatusMessage;

    private List<SessionSummary> _sessions = new();
    private string? _selectedSessionKey;
    private string _newSessionName = "";
    private bool _needsRefresh = true;

    public SessionPanel(SessionStore sessionStore, Action<string> onStatusMessage)
    {
        _sessionStore = sessionStore;
        _onStatusMessage = onStatusMessage;
    }

    /// <summary>
    /// Draw the session management panel.
    /// </summary>
    /// <param name="currentResult">The current analysis result that can be saved.</param>
    /// <param name="onLoadSession">Callback when a session is loaded.</param>
    public void Draw(AnalysisResult? currentResult, Action<SavedSession>? onLoadSession)
    {
        if (_needsRefresh)
        {
            RefreshSessionList();
            _needsRefresh = false;
        }

        // Save current section
        if (currentResult != null)
        {
            DrawSaveSection(currentResult);
            ImGui.Separator();
        }

        // Session list
        DrawSessionList(onLoadSession);
    }

    private void DrawSaveSection(AnalysisResult currentResult)
    {
        ImGui.Text("Save Current Analysis");
        ImGui.Spacing();

        ImGui.SetNextItemWidth(200);
        ImGui.InputText("Session Name", ref _newSessionName, 100);

        ImGui.SameLine();
        var canSave = !string.IsNullOrWhiteSpace(_newSessionName);

        if (!canSave)
        {
            ImGui.BeginDisabled();
        }

        if (ImGui.Button("Save Session"))
        {
            _ = SaveSessionAsync(currentResult, _newSessionName);
        }

        if (!canSave)
        {
            ImGui.EndDisabled();
            if (ImGui.IsItemHovered(ImGuiHoveredFlags.AllowWhenDisabled))
            {
                ImGui.SetTooltip("Enter a session name to save");
            }
        }
    }

    private void DrawSessionList(Action<SavedSession>? onLoadSession)
    {
        ImGui.Text($"Saved Sessions ({_sessions.Count})");
        ImGui.Spacing();

        if (_sessions.Count == 0)
        {
            ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1.0f), "No saved sessions.");
            ImGui.TextWrapped("Analyze a struct and save it to create a session.");
            return;
        }

        // Session table
        if (ImGui.BeginTable("SessionTable", 5,
            ImGuiTableFlags.Borders | ImGuiTableFlags.RowBg | ImGuiTableFlags.Resizable |
            ImGuiTableFlags.ScrollY | ImGuiTableFlags.Sortable))
        {
            ImGui.TableSetupColumn("", ImGuiTableColumnFlags.WidthFixed, 20); // Selection
            ImGui.TableSetupColumn("Name", ImGuiTableColumnFlags.None, 120);
            ImGui.TableSetupColumn("Struct", ImGuiTableColumnFlags.None, 100);
            ImGui.TableSetupColumn("Date", ImGuiTableColumnFlags.DefaultSort, 100);
            ImGui.TableSetupColumn("Version", ImGuiTableColumnFlags.None, 60);
            ImGui.TableSetupScrollFreeze(0, 1);
            ImGui.TableHeadersRow();

            foreach (var session in _sessions)
            {
                ImGui.TableNextRow();

                var isSelected = _selectedSessionKey == session.Key;

                // Selection column
                ImGui.TableNextColumn();
                if (ImGui.Selectable($"##{session.Key}", isSelected, ImGuiSelectableFlags.SpanAllColumns))
                {
                    _selectedSessionKey = isSelected ? null : session.Key;
                }

                // Name
                ImGui.TableNextColumn();
                ImGui.Text(session.Name);

                // Struct
                ImGui.TableNextColumn();
                ImGui.TextColored(new Vector4(0.8f, 0.8f, 1.0f, 1.0f), session.StructName);

                // Date
                ImGui.TableNextColumn();
                ImGui.Text(session.Timestamp.ToString("yyyy-MM-dd HH:mm"));

                // Version
                ImGui.TableNextColumn();
                ImGui.Text(session.GameVersion);
            }

            ImGui.EndTable();
        }

        // Action buttons
        ImGui.Spacing();
        var hasSelection = _selectedSessionKey != null;

        if (!hasSelection)
        {
            ImGui.BeginDisabled();
        }

        if (ImGui.Button("Load"))
        {
            _ = LoadSessionAsync(onLoadSession);
        }

        ImGui.SameLine();

        if (ImGui.Button("Delete"))
        {
            ImGui.OpenPopup("ConfirmDelete");
        }

        if (!hasSelection)
        {
            ImGui.EndDisabled();
        }

        ImGui.SameLine();

        if (ImGui.Button("Refresh"))
        {
            _needsRefresh = true;
        }

        // Delete confirmation popup
        if (ImGui.BeginPopupModal("ConfirmDelete", ImGuiWindowFlags.AlwaysAutoResize))
        {
            ImGui.Text("Are you sure you want to delete this session?");
            ImGui.Text($"Session: {_selectedSessionKey}");
            ImGui.Spacing();

            if (ImGui.Button("Yes, Delete"))
            {
                _ = DeleteSessionAsync();
                ImGui.CloseCurrentPopup();
            }

            ImGui.SameLine();

            if (ImGui.Button("Cancel"))
            {
                ImGui.CloseCurrentPopup();
            }

            ImGui.EndPopup();
        }
    }

    private void RefreshSessionList()
    {
        _sessions.Clear();

        foreach (var key in _sessionStore.ListKeys())
        {
            // Try to load session metadata without full data
            var session = _sessionStore.LoadAsync(key).GetAwaiter().GetResult();
            if (session != null)
            {
                _sessions.Add(new SessionSummary
                {
                    Key = key,
                    Name = session.Name,
                    StructName = session.StructName,
                    Timestamp = session.Timestamp,
                    GameVersion = session.GameVersion
                });
            }
        }

        _sessions = _sessions.OrderByDescending(s => s.Timestamp).ToList();
    }

    private async Task SaveSessionAsync(AnalysisResult result, string name)
    {
        try
        {
            _onStatusMessage("Saving session...");

            var session = new SavedSession
            {
                Name = name,
                StructName = result.StructName,
                GameVersion = result.GameVersion,
                Timestamp = DateTime.UtcNow,
                Result = result
            };

            await _sessionStore.SaveAsync(session.StorageKey, session);

            _newSessionName = "";
            _needsRefresh = true;
            _onStatusMessage($"Session '{name}' saved successfully");
        }
        catch (Exception ex)
        {
            _onStatusMessage($"Failed to save session: {ex.Message}");
        }
    }

    private async Task LoadSessionAsync(Action<SavedSession>? onLoadSession)
    {
        if (_selectedSessionKey == null || onLoadSession == null)
            return;

        try
        {
            _onStatusMessage("Loading session...");

            var session = await _sessionStore.LoadAsync(_selectedSessionKey);
            if (session != null)
            {
                onLoadSession(session);
                _onStatusMessage($"Session '{session.Name}' loaded");
            }
            else
            {
                _onStatusMessage("Session not found");
            }
        }
        catch (Exception ex)
        {
            _onStatusMessage($"Failed to load session: {ex.Message}");
        }
    }

    private async Task DeleteSessionAsync()
    {
        if (_selectedSessionKey == null)
            return;

        try
        {
            await _sessionStore.DeleteAsync(_selectedSessionKey);
            _selectedSessionKey = null;
            _needsRefresh = true;
            _onStatusMessage("Session deleted");
        }
        catch (Exception ex)
        {
            _onStatusMessage($"Failed to delete session: {ex.Message}");
        }
    }

    private record SessionSummary
    {
        public string Key { get; init; } = "";
        public string Name { get; init; } = "";
        public string StructName { get; init; } = "";
        public DateTime Timestamp { get; init; }
        public string GameVersion { get; init; } = "";
    }
}
