using System;
using System.Collections.Generic;
using System.Linq;
using StructValidator.Memory;

namespace StructValidator.Services;

/// <summary>
/// Watches memory addresses and records changes over time.
/// Helps reverse engineers understand field purpose by observing when values change during gameplay.
///
/// Example: Watch a field, move your character, see the field change → likely position data.
/// </summary>
public class ChangeMonitor : IDisposable
{
    private readonly Dictionary<nint, WatchedAddress> _watches = new();
    private readonly object _lock = new();
    private bool _disposed;

    /// <summary>
    /// Maximum number of change records to keep per address.
    /// </summary>
    public int MaxHistoryPerAddress { get; set; } = 100;

    /// <summary>
    /// Whether the monitor is currently active.
    /// </summary>
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Start watching a memory address for changes.
    /// </summary>
    /// <param name="address">The memory address to watch.</param>
    /// <param name="size">Number of bytes to monitor (1-8).</param>
    /// <param name="label">Human-readable label for this watch.</param>
    public void WatchAddress(nint address, int size, string label)
    {
        if (_disposed) return;
        if (size < 1 || size > 8) size = 8;

        lock (_lock)
        {
            if (_watches.ContainsKey(address))
            {
                // Update existing watch
                _watches[address].Label = label;
                _watches[address].Size = size;
                return;
            }

            // Read initial value
            byte[] initialValue = Array.Empty<byte>();
            if (SafeMemoryReader.TryReadBytes(address, size, out var bytes))
            {
                initialValue = bytes;
            }

            _watches[address] = new WatchedAddress
            {
                Address = address,
                Size = size,
                Label = label,
                LastValue = initialValue,
                LastCheckTime = DateTime.Now,
                History = new List<ChangeRecord>(),
                ChangeCount = 0
            };
        }
    }

    /// <summary>
    /// Stop watching an address.
    /// </summary>
    public void UnwatchAddress(nint address)
    {
        lock (_lock)
        {
            _watches.Remove(address);
        }
    }

    /// <summary>
    /// Check if an address is being watched.
    /// </summary>
    public bool IsWatching(nint address)
    {
        lock (_lock)
        {
            return _watches.ContainsKey(address);
        }
    }

    /// <summary>
    /// Get all currently watched addresses.
    /// </summary>
    public IReadOnlyList<WatchedAddress> GetWatches()
    {
        lock (_lock)
        {
            return _watches.Values.ToList();
        }
    }

    /// <summary>
    /// Get the watch info for a specific address.
    /// </summary>
    public WatchedAddress? GetWatch(nint address)
    {
        lock (_lock)
        {
            return _watches.TryGetValue(address, out var watch) ? watch : null;
        }
    }

    /// <summary>
    /// Get the change history for an address.
    /// </summary>
    public IReadOnlyList<ChangeRecord> GetHistory(nint address)
    {
        lock (_lock)
        {
            if (_watches.TryGetValue(address, out var watch))
            {
                return watch.History.ToList();
            }
            return Array.Empty<ChangeRecord>();
        }
    }

    /// <summary>
    /// Clear the change history for an address.
    /// </summary>
    public void ClearHistory(nint address)
    {
        lock (_lock)
        {
            if (_watches.TryGetValue(address, out var watch))
            {
                watch.History.Clear();
                watch.ChangeCount = 0;
            }
        }
    }

    /// <summary>
    /// Clear all watches.
    /// </summary>
    public void ClearAll()
    {
        lock (_lock)
        {
            _watches.Clear();
        }
    }

    /// <summary>
    /// Update all watches - call this from the frame update loop.
    /// </summary>
    public void Update()
    {
        if (_disposed || !IsActive) return;

        lock (_lock)
        {
            var now = DateTime.Now;

            foreach (var watch in _watches.Values)
            {
                if (!SafeMemoryReader.TryReadBytes(watch.Address, watch.Size, out var currentValue))
                {
                    continue;
                }

                // Check if value changed
                if (!BytesEqual(watch.LastValue, currentValue))
                {
                    var record = new ChangeRecord
                    {
                        Timestamp = now,
                        PreviousValue = watch.LastValue,
                        NewValue = currentValue,
                        TimeSinceLastChange = watch.LastChangeTime.HasValue
                            ? now - watch.LastChangeTime.Value
                            : TimeSpan.Zero
                    };

                    watch.History.Add(record);
                    watch.LastValue = currentValue;
                    watch.LastChangeTime = now;
                    watch.ChangeCount++;

                    // Trim history if too long
                    while (watch.History.Count > MaxHistoryPerAddress)
                    {
                        watch.History.RemoveAt(0);
                    }
                }

                watch.LastCheckTime = now;
            }
        }
    }

    private static bool BytesEqual(byte[] a, byte[] b)
    {
        if (a.Length != b.Length) return false;
        for (int i = 0; i < a.Length; i++)
        {
            if (a[i] != b[i]) return false;
        }
        return true;
    }

    public void Dispose()
    {
        _disposed = true;
        lock (_lock)
        {
            _watches.Clear();
        }
    }
}

/// <summary>
/// Represents a memory address being watched for changes.
/// </summary>
public class WatchedAddress
{
    /// <summary>
    /// The memory address being watched.
    /// </summary>
    public nint Address { get; set; }

    /// <summary>
    /// Number of bytes being monitored.
    /// </summary>
    public int Size { get; set; }

    /// <summary>
    /// Human-readable label for this watch.
    /// </summary>
    public string Label { get; set; } = "";

    /// <summary>
    /// The last value read from this address.
    /// </summary>
    public byte[] LastValue { get; set; } = Array.Empty<byte>();

    /// <summary>
    /// When the value was last checked.
    /// </summary>
    public DateTime LastCheckTime { get; set; }

    /// <summary>
    /// When the value last changed (null if never changed since watching started).
    /// </summary>
    public DateTime? LastChangeTime { get; set; }

    /// <summary>
    /// History of changes detected.
    /// </summary>
    public List<ChangeRecord> History { get; set; } = new();

    /// <summary>
    /// Total number of changes detected.
    /// </summary>
    public int ChangeCount { get; set; }

    /// <summary>
    /// Get the current value as various interpretations.
    /// </summary>
    public ByteInterpretations GetInterpretations()
    {
        return TypeInference.GetInterpretations(Address, Size);
    }
}

/// <summary>
/// Records a single change event for a watched address.
/// </summary>
public class ChangeRecord
{
    /// <summary>
    /// When the change was detected.
    /// </summary>
    public DateTime Timestamp { get; set; }

    /// <summary>
    /// The value before the change.
    /// </summary>
    public byte[] PreviousValue { get; set; } = Array.Empty<byte>();

    /// <summary>
    /// The value after the change.
    /// </summary>
    public byte[] NewValue { get; set; } = Array.Empty<byte>();

    /// <summary>
    /// Time elapsed since the previous change.
    /// </summary>
    public TimeSpan TimeSinceLastChange { get; set; }

    /// <summary>
    /// Get hex string of previous value.
    /// </summary>
    public string PreviousHex => BitConverter.ToString(PreviousValue).Replace("-", " ");

    /// <summary>
    /// Get hex string of new value.
    /// </summary>
    public string NewHex => BitConverter.ToString(NewValue).Replace("-", " ");
}
