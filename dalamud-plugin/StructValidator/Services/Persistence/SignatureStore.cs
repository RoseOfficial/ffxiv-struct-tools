using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Dalamud.Plugin.Services;
using StructValidator.Models;

namespace StructValidator.Services.Persistence;

/// <summary>
/// Store for saving and loading field signatures.
/// </summary>
public class SignatureStore : FileDataStore<SignatureCollection>
{
    public SignatureStore(string basePath, IPluginLog log)
        : base(basePath, "signatures", log)
    {
    }

    /// <summary>
    /// Get all signature collection versions, sorted newest first.
    /// </summary>
    public IEnumerable<string> ListSignatureVersions()
    {
        return ListKeys().OrderByDescending(v => v);
    }

    /// <summary>
    /// Get the most recent signature collection.
    /// </summary>
    public async Task<SignatureCollection?> GetLatestAsync()
    {
        var latestKey = ListSignatureVersions().FirstOrDefault();
        if (latestKey == null)
            return null;

        return await LoadAsync(latestKey);
    }

    /// <summary>
    /// Save a signature collection using the game version as the key.
    /// </summary>
    public async Task SaveSignaturesAsync(SignatureCollection collection)
    {
        await SaveAsync(collection.GameVersion, collection);
    }

    /// <summary>
    /// Get signatures for a specific struct.
    /// </summary>
    public async Task<IEnumerable<FieldSignature>> GetSignaturesForStructAsync(string gameVersion, string structName)
    {
        var collection = await LoadAsync(gameVersion);
        if (collection == null)
            return Enumerable.Empty<FieldSignature>();

        return collection.Signatures.Where(s => s.StructName == structName);
    }

    /// <summary>
    /// Get signatures for a specific field.
    /// </summary>
    public async Task<FieldSignature?> GetSignatureForFieldAsync(string gameVersion, string structName, string fieldName)
    {
        var collection = await LoadAsync(gameVersion);
        return collection?.Signatures.FirstOrDefault(s =>
            s.StructName == structName && s.FieldName == fieldName);
    }

    /// <summary>
    /// Get signature statistics for a version.
    /// </summary>
    public async Task<SignatureStats?> GetStatsAsync(string gameVersion)
    {
        var collection = await LoadAsync(gameVersion);
        if (collection == null)
            return null;

        return new SignatureStats
        {
            GameVersion = collection.GameVersion,
            TotalSignatures = collection.Count,
            UniqueSignatures = collection.Signatures.Count(s => s.MatchCount == 1),
            HighConfidenceSignatures = collection.Signatures.Count(s => s.Confidence >= 0.8f),
            StructsCovered = collection.Signatures.Select(s => s.StructName).Distinct().Count()
        };
    }
}

/// <summary>
/// Statistics about a signature collection.
/// </summary>
public class SignatureStats
{
    public string GameVersion { get; init; } = "";
    public int TotalSignatures { get; init; }
    public int UniqueSignatures { get; init; }
    public int HighConfidenceSignatures { get; init; }
    public int StructsCovered { get; init; }
}
