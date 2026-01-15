using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using Dalamud.Plugin.Services;
using StructValidator.Models;

namespace StructValidator.Services;

/// <summary>
/// Service for generating memory signatures for struct field access.
/// Scans code sections for patterns that reference specific field offsets.
/// </summary>
public class SignatureGenerator
{
    private readonly IPluginLog _log;
    private nint _codeStart;
    private nint _codeEnd;
    private bool _initialized;

    // Common x64 instruction patterns for field access
    private static readonly FieldAccessPattern[] FieldAccessPatterns = new[]
    {
        // mov rax, [rcx+offset8] - 48 8B 41 xx
        new FieldAccessPattern("mov r64, [rcx+disp8]", new byte[] { 0x48, 0x8B, 0x41 }, 3, 1, SignatureInstructionType.MovRead),
        // mov rax, [rcx+offset32] - 48 8B 81 xx xx xx xx
        new FieldAccessPattern("mov r64, [rcx+disp32]", new byte[] { 0x48, 0x8B, 0x81 }, 3, 4, SignatureInstructionType.MovRead),
        // mov rax, [rdx+offset8] - 48 8B 42 xx
        new FieldAccessPattern("mov r64, [rdx+disp8]", new byte[] { 0x48, 0x8B, 0x42 }, 3, 1, SignatureInstructionType.MovRead),
        // mov rax, [rdx+offset32] - 48 8B 82 xx xx xx xx
        new FieldAccessPattern("mov r64, [rdx+disp32]", new byte[] { 0x48, 0x8B, 0x82 }, 3, 4, SignatureInstructionType.MovRead),
        // lea rax, [rcx+offset8] - 48 8D 41 xx
        new FieldAccessPattern("lea r64, [rcx+disp8]", new byte[] { 0x48, 0x8D, 0x41 }, 3, 1, SignatureInstructionType.Lea),
        // lea rax, [rcx+offset32] - 48 8D 81 xx xx xx xx
        new FieldAccessPattern("lea r64, [rcx+disp32]", new byte[] { 0x48, 0x8D, 0x81 }, 3, 4, SignatureInstructionType.Lea),
        // mov eax, [rcx+offset8] - 8B 41 xx
        new FieldAccessPattern("mov r32, [rcx+disp8]", new byte[] { 0x8B, 0x41 }, 2, 1, SignatureInstructionType.MovRead),
        // mov eax, [rcx+offset32] - 8B 81 xx xx xx xx
        new FieldAccessPattern("mov r32, [rcx+disp32]", new byte[] { 0x8B, 0x81 }, 2, 4, SignatureInstructionType.MovRead),
        // movss xmm0, [rcx+offset8] - F3 0F 10 41 xx
        new FieldAccessPattern("movss xmm, [rcx+disp8]", new byte[] { 0xF3, 0x0F, 0x10, 0x41 }, 4, 1, SignatureInstructionType.SseRead),
        // movss xmm0, [rcx+offset32] - F3 0F 10 81 xx xx xx xx
        new FieldAccessPattern("movss xmm, [rcx+disp32]", new byte[] { 0xF3, 0x0F, 0x10, 0x81 }, 4, 4, SignatureInstructionType.SseRead),
        // movsd xmm0, [rcx+offset8] - F2 0F 10 41 xx
        new FieldAccessPattern("movsd xmm, [rcx+disp8]", new byte[] { 0xF2, 0x0F, 0x10, 0x41 }, 4, 1, SignatureInstructionType.SseRead),
        // cmp dword ptr [rcx+offset8], imm - 83 79 xx yy
        new FieldAccessPattern("cmp [rcx+disp8], imm8", new byte[] { 0x83, 0x79 }, 2, 1, SignatureInstructionType.Compare),
        // add [rcx+offset8], reg - 01 41 xx
        new FieldAccessPattern("add [rcx+disp8], r32", new byte[] { 0x01, 0x41 }, 2, 1, SignatureInstructionType.Arithmetic),
    };

    public SignatureGenerator(IPluginLog log)
    {
        _log = log;
    }

    /// <summary>
    /// Initialize code section bounds from game process.
    /// </summary>
    public bool Initialize()
    {
        if (_initialized) return true;

        try
        {
            var process = Process.GetCurrentProcess();
            var mainModule = process.MainModule;
            if (mainModule == null)
            {
                _log.Error("Failed to get main module");
                return false;
            }

            // Get code section bounds from PE header
            var baseAddress = mainModule.BaseAddress;
            var moduleSize = mainModule.ModuleMemorySize;

            // Read PE header to find .text section
            var dosHeader = Marshal.ReadInt32(baseAddress + 0x3C);
            var peHeader = baseAddress + dosHeader;
            var numberOfSections = Marshal.ReadInt16(peHeader + 0x6);
            var optionalHeaderSize = Marshal.ReadInt16(peHeader + 0x14);
            var sectionTable = peHeader + 0x18 + optionalHeaderSize;

            // Find .text section
            for (int i = 0; i < numberOfSections; i++)
            {
                var sectionOffset = sectionTable + (i * 0x28);
                var sectionName = Marshal.PtrToStringAnsi(sectionOffset, 8)?.TrimEnd('\0');

                if (sectionName == ".text")
                {
                    var virtualSize = Marshal.ReadInt32(sectionOffset + 0x8);
                    var virtualAddress = Marshal.ReadInt32(sectionOffset + 0xC);

                    _codeStart = baseAddress + virtualAddress;
                    _codeEnd = _codeStart + virtualSize;
                    _initialized = true;

                    _log.Info($"Code section: 0x{_codeStart:X} - 0x{_codeEnd:X} ({virtualSize:N0} bytes)");
                    return true;
                }
            }

            // Fallback: use entire module as code section (less accurate)
            _codeStart = baseAddress;
            _codeEnd = baseAddress + moduleSize;
            _initialized = true;
            _log.Warning("Could not find .text section, using entire module");
            return true;
        }
        catch (Exception ex)
        {
            _log.Error($"Failed to initialize signature generator: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Generate signatures for field access at a specific offset.
    /// </summary>
    /// <param name="structName">Name of the struct.</param>
    /// <param name="fieldName">Name of the field.</param>
    /// <param name="fieldOffset">The field offset to search for.</param>
    /// <param name="maxResults">Maximum number of signatures to return.</param>
    /// <returns>List of generated signatures.</returns>
    public List<FieldSignature> GenerateForOffset(string structName, string fieldName, int fieldOffset, int maxResults = 5)
    {
        var results = new List<FieldSignature>();

        if (!Initialize())
        {
            _log.Error("Signature generator not initialized");
            return results;
        }

        // Determine if we need 8-bit or 32-bit displacement
        var needsDisp32 = fieldOffset > 0x7F || fieldOffset < -0x80;

        foreach (var pattern in FieldAccessPatterns)
        {
            // Skip patterns with wrong displacement size
            if (needsDisp32 && pattern.DisplacementSize == 1) continue;
            if (!needsDisp32 && pattern.DisplacementSize == 4) continue;

            var matches = FindPatternMatches(pattern, fieldOffset);
            foreach (var match in matches)
            {
                if (results.Count >= maxResults) break;

                var sig = BuildSignature(structName, fieldName, match, pattern, fieldOffset);
                if (sig != null)
                {
                    results.Add(sig);
                }
            }

            if (results.Count >= maxResults) break;
        }

        return results;
    }

    /// <summary>
    /// Generate signatures for multiple fields in a struct.
    /// </summary>
    public SignatureCollection GenerateForStruct(string structName, string gameVersion, Dictionary<int, string> fieldOffsets)
    {
        var collection = new SignatureCollection
        {
            GameVersion = gameVersion,
            Timestamp = DateTime.UtcNow,
            Signatures = new List<FieldSignature>()
        };

        foreach (var (offset, fieldName) in fieldOffsets)
        {
            var sigs = GenerateForOffset(structName, fieldName, offset, 1);
            if (sigs.Count > 0)
            {
                collection.Signatures.Add(sigs[0]);
            }
        }

        return collection;
    }

    private List<PatternMatch> FindPatternMatches(FieldAccessPattern pattern, int fieldOffset)
    {
        var matches = new List<PatternMatch>();
        var searchBytes = BuildSearchBytes(pattern, fieldOffset);

        if (searchBytes == null || searchBytes.Length == 0)
            return matches;

        try
        {
            // Scan code section
            var scanStart = _codeStart;
            var scanEnd = _codeEnd - searchBytes.Length;

            unsafe
            {
                var ptr = (byte*)scanStart;
                var endPtr = (byte*)scanEnd;

                while (ptr < endPtr)
                {
                    bool found = true;
                    for (int i = 0; i < searchBytes.Length && found; i++)
                    {
                        if (ptr[i] != searchBytes[i])
                            found = false;
                    }

                    if (found)
                    {
                        matches.Add(new PatternMatch
                        {
                            Address = (nint)ptr,
                            Pattern = pattern,
                            Offset = fieldOffset
                        });

                        if (matches.Count >= 20) // Limit scan results
                            break;
                    }

                    ptr++;
                }
            }
        }
        catch (Exception ex)
        {
            _log.Debug($"Pattern scan error: {ex.Message}");
        }

        return matches;
    }

    private byte[]? BuildSearchBytes(FieldAccessPattern pattern, int fieldOffset)
    {
        var result = new byte[pattern.Prefix.Length + pattern.DisplacementSize];
        Array.Copy(pattern.Prefix, result, pattern.Prefix.Length);

        if (pattern.DisplacementSize == 1)
        {
            result[pattern.Prefix.Length] = (byte)fieldOffset;
        }
        else if (pattern.DisplacementSize == 4)
        {
            var offsetBytes = BitConverter.GetBytes(fieldOffset);
            Array.Copy(offsetBytes, 0, result, pattern.Prefix.Length, 4);
        }

        return result;
    }

    private FieldSignature? BuildSignature(string structName, string fieldName, PatternMatch match, FieldAccessPattern pattern, int fieldOffset)
    {
        try
        {
            // Read context around the match (10 bytes before, pattern, 10 bytes after)
            const int contextBefore = 10;
            const int contextAfter = 10;
            var patternLen = pattern.Prefix.Length + pattern.DisplacementSize;

            var sigStart = match.Address - contextBefore;
            var sigLen = contextBefore + patternLen + contextAfter;

            if (sigStart < _codeStart || sigStart + sigLen > _codeEnd)
                return null;

            var bytes = new byte[sigLen];
            Marshal.Copy(sigStart, bytes, 0, sigLen);

            // Build signature string with wildcards for registers
            var sb = new StringBuilder();
            for (int i = 0; i < bytes.Length; i++)
            {
                if (i > 0) sb.Append(' ');

                // Use wildcards for bytes that might vary (register encoding)
                var relPos = i - contextBefore;
                if (relPos >= 0 && relPos < pattern.Prefix.Length)
                {
                    // Within pattern prefix - check if it's a register-dependent byte
                    if (relPos == pattern.Prefix.Length - 1 && IsRegisterByte(pattern.Prefix[relPos]))
                    {
                        sb.Append("??");
                        continue;
                    }
                }

                sb.Append($"{bytes[i]:X2}");
            }

            var matchCount = CountTotalMatches(pattern, fieldOffset);

            return new FieldSignature
            {
                StructName = structName,
                FieldName = fieldName,
                Offset = fieldOffset,
                Pattern = sb.ToString(),
                OffsetPosition = contextBefore + pattern.Prefix.Length,
                OffsetSize = pattern.DisplacementSize,
                InstructionType = pattern.InstructionType,
                Confidence = CalculateConfidence(matchCount, pattern),
                MatchCount = matchCount,
                FoundAtHex = $"0x{match.Address:X}"
            };
        }
        catch (Exception ex)
        {
            _log.Debug($"Failed to build signature: {ex.Message}");
            return null;
        }
    }

    private int CountTotalMatches(FieldAccessPattern pattern, int fieldOffset)
    {
        var searchBytes = BuildSearchBytes(pattern, fieldOffset);
        if (searchBytes == null) return 0;

        int count = 0;
        try
        {
            unsafe
            {
                var ptr = (byte*)_codeStart;
                var endPtr = (byte*)(_codeEnd - searchBytes.Length);

                while (ptr < endPtr)
                {
                    bool found = true;
                    for (int i = 0; i < searchBytes.Length && found; i++)
                    {
                        if (ptr[i] != searchBytes[i])
                            found = false;
                    }

                    if (found)
                    {
                        count++;
                        if (count >= 100) break; // Cap count
                    }

                    ptr++;
                }
            }
        }
        catch { }

        return count;
    }

    private bool IsRegisterByte(byte b)
    {
        // Bytes that encode register choices (ModR/M byte patterns)
        return (b & 0xC0) == 0x40 || // [reg+disp8]
               (b & 0xC0) == 0x80;   // [reg+disp32]
    }

    private float CalculateConfidence(int matchCount, FieldAccessPattern pattern)
    {
        // Higher confidence for fewer matches (more unique)
        float confidence = matchCount switch
        {
            1 => 1.0f,
            2 => 0.9f,
            <= 5 => 0.8f,
            <= 10 => 0.7f,
            <= 20 => 0.5f,
            _ => 0.3f
        };

        // Prefer mov over lea
        if (pattern.InstructionType == SignatureInstructionType.MovRead)
            confidence = Math.Min(confidence + 0.05f, 1.0f);

        // Prefer 32-bit displacements (more unique)
        if (pattern.DisplacementSize == 4)
            confidence = Math.Min(confidence + 0.05f, 1.0f);

        return confidence;
    }

    /// <summary>
    /// Export signatures to CLI-compatible JSON format.
    /// </summary>
    public string ExportToJson(SignatureCollection collection)
    {
        var sb = new StringBuilder();
        sb.AppendLine("{");
        sb.AppendLine($"  \"gameVersion\": \"{collection.GameVersion}\",");
        sb.AppendLine($"  \"generated\": \"{collection.Timestamp:yyyy-MM-ddTHH:mm:ssZ}\",");
        sb.AppendLine($"  \"count\": {collection.Count},");
        sb.AppendLine("  \"signatures\": [");

        for (int i = 0; i < collection.Signatures.Count; i++)
        {
            var sig = collection.Signatures[i];
            sb.AppendLine("    {");
            sb.AppendLine($"      \"struct\": \"{sig.StructName}\",");
            sb.AppendLine($"      \"field\": \"{sig.FieldName}\",");
            sb.AppendLine($"      \"offset\": \"0x{sig.Offset:X}\",");
            sb.AppendLine($"      \"pattern\": \"{sig.Pattern}\",");
            sb.AppendLine($"      \"confidence\": {sig.Confidence:F2},");
            sb.AppendLine($"      \"matchCount\": {sig.MatchCount}");
            sb.Append("    }");
            if (i < collection.Signatures.Count - 1) sb.Append(",");
            sb.AppendLine();
        }

        sb.AppendLine("  ]");
        sb.AppendLine("}");
        return sb.ToString();
    }
}

/// <summary>
/// Represents a pattern for detecting field access instructions.
/// </summary>
internal class FieldAccessPattern
{
    public string Name { get; }
    public byte[] Prefix { get; }
    public int PrefixLength { get; }
    public int DisplacementSize { get; }
    public SignatureInstructionType InstructionType { get; }

    public FieldAccessPattern(string name, byte[] prefix, int prefixLength, int displacementSize, SignatureInstructionType instructionType)
    {
        Name = name;
        Prefix = prefix;
        PrefixLength = prefixLength;
        DisplacementSize = displacementSize;
        InstructionType = instructionType;
    }
}

/// <summary>
/// A match found during pattern scanning.
/// </summary>
internal class PatternMatch
{
    public nint Address { get; set; }
    public FieldAccessPattern Pattern { get; set; } = null!;
    public int Offset { get; set; }
}
