using System.Collections.Generic;
using System.Threading.Tasks;

namespace StructValidator.Services.Persistence;

/// <summary>
/// Generic interface for persisting data to storage.
/// </summary>
/// <typeparam name="T">The type of data to store.</typeparam>
public interface IDataStore<T> where T : class
{
    /// <summary>
    /// Save data with the specified key.
    /// </summary>
    Task SaveAsync(string key, T data);

    /// <summary>
    /// Load data by key. Returns null if not found.
    /// </summary>
    Task<T?> LoadAsync(string key);

    /// <summary>
    /// List all available keys.
    /// </summary>
    IEnumerable<string> ListKeys();

    /// <summary>
    /// Delete data by key.
    /// </summary>
    Task DeleteAsync(string key);

    /// <summary>
    /// Check if a key exists.
    /// </summary>
    bool Exists(string key);
}
