using System.Collections.Generic;
using System.Linq;
using Dalamud.Plugin.Services;
using StructValidator.Models;

namespace StructValidator.Services.Persistence;

/// <summary>
/// Store for saving and loading analysis sessions.
/// </summary>
public class SessionStore : FileDataStore<SavedSession>
{
    public SessionStore(string basePath, IPluginLog log)
        : base(basePath, "sessions", log)
    {
    }

    /// <summary>
    /// Get all sessions, sorted by timestamp (newest first).
    /// </summary>
    public IEnumerable<(string Key, string Name, string StructName, string Timestamp)> ListSessionSummaries()
    {
        return ListKeys()
            .Select(key =>
            {
                // Parse key format: "yyyyMMdd-HHmmss_name"
                var parts = key.Split('_', 2);
                var timestamp = parts.Length > 0 ? parts[0] : key;
                var name = parts.Length > 1 ? parts[1] : key;

                return (Key: key, Name: name, StructName: "", Timestamp: timestamp);
            })
            .OrderByDescending(s => s.Timestamp);
    }

    /// <summary>
    /// Get sessions filtered by struct name.
    /// </summary>
    public async IAsyncEnumerable<SavedSession> GetSessionsByStructAsync(string structName)
    {
        foreach (var key in ListKeys())
        {
            var session = await LoadAsync(key);
            if (session != null && session.StructName == structName)
            {
                yield return session;
            }
        }
    }
}
