using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Dalamud.Plugin.Services;

namespace StructValidator.Services.Persistence;

/// <summary>
/// Base implementation of IDataStore using file system storage.
/// </summary>
/// <typeparam name="T">The type of data to store.</typeparam>
public class FileDataStore<T> : IDataStore<T> where T : class
{
    private readonly string _basePath;
    private readonly string _fileExtension;
    private readonly IPluginLog _log;
    private readonly JsonSerializerOptions _jsonOptions;

    /// <summary>
    /// Create a new file-based data store.
    /// </summary>
    /// <param name="basePath">Base directory for storage.</param>
    /// <param name="subfolder">Subfolder within base path for this store type.</param>
    /// <param name="log">Plugin logger.</param>
    /// <param name="fileExtension">File extension to use (default: .json).</param>
    public FileDataStore(string basePath, string subfolder, IPluginLog log, string fileExtension = ".json")
    {
        _basePath = Path.Combine(basePath, subfolder);
        _fileExtension = fileExtension;
        _log = log;

        _jsonOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true
        };

        // Ensure directory exists
        if (!Directory.Exists(_basePath))
        {
            Directory.CreateDirectory(_basePath);
            _log.Debug($"Created storage directory: {_basePath}");
        }
    }

    /// <inheritdoc />
    public async Task SaveAsync(string key, T data)
    {
        var filePath = GetFilePath(key);

        try
        {
            var json = JsonSerializer.Serialize(data, _jsonOptions);
            await File.WriteAllTextAsync(filePath, json);
            _log.Debug($"Saved {typeof(T).Name} to: {filePath}");
        }
        catch (Exception ex)
        {
            _log.Error(ex, $"Failed to save {typeof(T).Name} with key '{key}'");
            throw;
        }
    }

    /// <inheritdoc />
    public async Task<T?> LoadAsync(string key)
    {
        var filePath = GetFilePath(key);

        if (!File.Exists(filePath))
        {
            _log.Debug($"File not found: {filePath}");
            return null;
        }

        try
        {
            var json = await File.ReadAllTextAsync(filePath);
            var data = JsonSerializer.Deserialize<T>(json, _jsonOptions);
            _log.Debug($"Loaded {typeof(T).Name} from: {filePath}");
            return data;
        }
        catch (Exception ex)
        {
            _log.Error(ex, $"Failed to load {typeof(T).Name} with key '{key}'");
            return null;
        }
    }

    /// <inheritdoc />
    public IEnumerable<string> ListKeys()
    {
        if (!Directory.Exists(_basePath))
            return Enumerable.Empty<string>();

        return Directory.GetFiles(_basePath, $"*{_fileExtension}")
            .Select(f => Path.GetFileNameWithoutExtension(f))
            .OrderByDescending(k => k); // Most recent first (assuming timestamp in name)
    }

    /// <inheritdoc />
    public async Task DeleteAsync(string key)
    {
        var filePath = GetFilePath(key);

        if (File.Exists(filePath))
        {
            try
            {
                File.Delete(filePath);
                _log.Debug($"Deleted: {filePath}");
            }
            catch (Exception ex)
            {
                _log.Error(ex, $"Failed to delete {typeof(T).Name} with key '{key}'");
                throw;
            }
        }

        await Task.CompletedTask;
    }

    /// <inheritdoc />
    public bool Exists(string key)
    {
        return File.Exists(GetFilePath(key));
    }

    /// <summary>
    /// Get the full file path for a key.
    /// </summary>
    protected string GetFilePath(string key)
    {
        // Sanitize key to be file-system safe
        var safeKey = string.Join("_", key.Split(Path.GetInvalidFileNameChars()));
        return Path.Combine(_basePath, safeKey + _fileExtension);
    }

    /// <summary>
    /// Get the base storage path.
    /// </summary>
    protected string BasePath => _basePath;
}
