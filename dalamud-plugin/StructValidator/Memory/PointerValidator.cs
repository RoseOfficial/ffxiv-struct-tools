using System;
using System.Diagnostics;

namespace StructValidator.Memory;

/// <summary>
/// Result of pointer validation.
/// </summary>
public enum PointerValidationResult
{
    Invalid,
    NotAligned,
    NullPointer,
    OutOfRange,
    NotReadable,
    ValidHeap,
    ValidCode,
    ValidData
}

/// <summary>
/// Information about a validated pointer.
/// </summary>
public class PointerInfo
{
    public nint Value { get; set; }
    public PointerValidationResult Result { get; set; }
    public string? TargetDescription { get; set; }
    public float Confidence { get; set; }
}

/// <summary>
/// Validates memory addresses to determine if they are valid pointers.
/// </summary>
public static class PointerValidator
{
    // FFXIV executable typically loads around this range
    private static nint? gameModuleBase;
    private static nint? gameModuleEnd;
    private static bool initialized;

    /// <summary>
    /// Initialize the validator with game module information.
    /// </summary>
    public static void Initialize()
    {
        if (initialized) return;

        try
        {
            var proc = Process.GetCurrentProcess();
            foreach (ProcessModule? module in proc.Modules)
            {
                if (module?.ModuleName?.Contains("ffxiv_dx11") == true)
                {
                    gameModuleBase = module.BaseAddress;
                    gameModuleEnd = module.BaseAddress + module.ModuleMemorySize;
                    break;
                }
            }
        }
        catch
        {
            // Fall back to heuristics
        }

        initialized = true;
    }

    /// <summary>
    /// Validate whether a value is likely a valid pointer.
    /// </summary>
    public static PointerInfo Validate(nint value)
    {
        Initialize();

        var info = new PointerInfo { Value = value };

        if (value == 0)
        {
            info.Result = PointerValidationResult.NullPointer;
            info.Confidence = 1.0f;
            return info;
        }

        // Check alignment (pointers are typically 8-byte aligned on x64)
        if (value % 8 != 0)
        {
            info.Result = PointerValidationResult.NotAligned;
            info.Confidence = 0.9f;
            return info;
        }

        // Check if in game module (code/data section)
        if (gameModuleBase.HasValue && gameModuleEnd.HasValue)
        {
            if (value >= gameModuleBase.Value && value < gameModuleEnd.Value)
            {
                // Likely code or static data
                if (SafeMemoryReader.IsReadable(value))
                {
                    info.Result = PointerValidationResult.ValidCode;
                    info.TargetDescription = "Game module";
                    info.Confidence = 0.95f;
                    return info;
                }
            }
        }

        // Check if readable (likely heap or valid memory region)
        if (!SafeMemoryReader.IsReadable(value))
        {
            info.Result = PointerValidationResult.NotReadable;
            info.Confidence = 0.9f;
            return info;
        }

        // Additional heuristics for valid heap pointers
        // Typical heap addresses on Windows x64 are in ranges like 0x1XX_XXXX_XXXX
        var highBits = (ulong)value >> 40;
        if (highBits is >= 0x1 and <= 0x7F)
        {
            info.Result = PointerValidationResult.ValidHeap;
            info.TargetDescription = "Heap memory";
            info.Confidence = 0.8f;
            return info;
        }

        // If readable but doesn't match patterns, still probably valid
        if (SafeMemoryReader.IsReadable(value))
        {
            info.Result = PointerValidationResult.ValidData;
            info.TargetDescription = "Unknown region";
            info.Confidence = 0.6f;
            return info;
        }

        info.Result = PointerValidationResult.Invalid;
        info.Confidence = 0.7f;
        return info;
    }

    /// <summary>
    /// Quick check if a value could be a valid pointer.
    /// </summary>
    public static bool IsLikelyPointer(nint value)
    {
        var info = Validate(value);
        return info.Result is PointerValidationResult.ValidHeap
            or PointerValidationResult.ValidCode
            or PointerValidationResult.ValidData;
    }

    /// <summary>
    /// Check if an address is in the game's code section.
    /// </summary>
    public static bool IsInCodeSection(nint address)
    {
        Initialize();

        if (!gameModuleBase.HasValue || !gameModuleEnd.HasValue)
            return false;

        return address >= gameModuleBase.Value && address < gameModuleEnd.Value;
    }
}
