using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text;
using Dalamud.Plugin.Services;
using StructValidator.Memory;
using StructValidator.Models;

namespace StructValidator.Services;

/// <summary>
/// Enhanced VTable analysis service that combines detection with declared vfunc matching.
/// </summary>
public class VTableAnalyzerService
{
    private readonly IPluginLog _log;

    public VTableAnalyzerService(IPluginLog log)
    {
        _log = log;
    }

    /// <summary>
    /// Perform detailed VTable analysis for a struct instance.
    /// </summary>
    /// <param name="objectAddress">Address of the object (vtable pointer at offset 0).</param>
    /// <param name="structType">Optional struct type for vfunc matching.</param>
    /// <returns>Detailed VTable analysis result.</returns>
    public EnhancedVTableAnalysis Analyze(nint objectAddress, Type? structType = null)
    {
        var result = new EnhancedVTableAnalysis
        {
            ObjectAddress = objectAddress,
            Timestamp = DateTime.UtcNow
        };

        if (objectAddress == 0)
        {
            return result;
        }

        // Get basic vtable detection
        var detection = VTableDetector.AnalyzeVTable(objectAddress);
        result.VTableAddress = detection.VTableAddress;
        result.IsValid = detection.IsVTable;
        result.Confidence = detection.Confidence;

        if (!detection.IsVTable)
        {
            return result;
        }

        // Get declared vfuncs if type is available
        var declaredVFuncs = new Dictionary<int, DeclaredVFunc>();
        if (structType != null)
        {
            result.StructName = structType.FullName ?? structType.Name;
            declaredVFuncs = GetDeclaredVFuncs(structType);
        }

        // Build detailed slot information
        for (int i = 0; i < detection.FunctionPointers.Count; i++)
        {
            var funcPtr = detection.FunctionPointers[i];

            // Estimate function size (distance to next function or fixed estimate)
            int estimatedSize = 0;
            if (i < detection.FunctionPointers.Count - 1)
            {
                var nextPtr = detection.FunctionPointers[i + 1];
                var diff = (long)(nextPtr - funcPtr);
                // Only use as estimate if reasonable (positive and < 1MB)
                if (diff > 0 && diff < 1024 * 1024)
                {
                    estimatedSize = (int)diff;
                }
            }

            // Check if this slot matches a declared vfunc
            declaredVFuncs.TryGetValue(i, out var declaredVFunc);

            var slot = new EnhancedVTableSlot
            {
                Index = i,
                FunctionAddress = funcPtr,
                EstimatedSize = estimatedSize > 0 ? estimatedSize : null,
                DeclaredName = declaredVFunc?.Name,
                DeclaredSignature = declaredVFunc?.Signature,
                IsDeclared = declaredVFunc != null
            };

            result.Slots.Add(slot);
        }

        // Calculate match statistics
        result.DeclaredSlotCount = declaredVFuncs.Count;
        result.MatchedSlotCount = result.Slots.Count(s => s.IsDeclared);
        result.UndeclaredSlotCount = result.Slots.Count(s => !s.IsDeclared);

        return result;
    }

    /// <summary>
    /// Get declared virtual functions from a type's vfuncs.
    /// </summary>
    private Dictionary<int, DeclaredVFunc> GetDeclaredVFuncs(Type structType)
    {
        var vfuncs = new Dictionary<int, DeclaredVFunc>();

        try
        {
            // Look for VirtualFunction attributes or vfunc field patterns
            foreach (var field in structType.GetFields(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
            {
                // Check for VirtualFunction attribute
                var vfuncAttr = field.GetCustomAttributes()
                    .FirstOrDefault(a => a.GetType().Name.Contains("VirtualFunction"));

                if (vfuncAttr != null)
                {
                    // Try to get slot index from attribute
                    var slotProp = vfuncAttr.GetType().GetProperty("Index") ??
                                   vfuncAttr.GetType().GetProperty("Slot");
                    if (slotProp != null)
                    {
                        var slotIndex = (int)(slotProp.GetValue(vfuncAttr) ?? -1);
                        if (slotIndex >= 0)
                        {
                            vfuncs[slotIndex] = new DeclaredVFunc
                            {
                                Name = field.Name,
                                Signature = GetDelegateSignature(field.FieldType)
                            };
                        }
                    }
                }
            }

            // Also check methods with MemberFunction attribute that might indicate vfuncs
            foreach (var method in structType.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance))
            {
                var memberFuncAttr = method.GetCustomAttributes()
                    .FirstOrDefault(a => a.GetType().Name.Contains("VirtualFunction") ||
                                        a.GetType().Name.Contains("MemberFunction"));

                if (memberFuncAttr != null)
                {
                    var slotProp = memberFuncAttr.GetType().GetProperty("Index") ??
                                   memberFuncAttr.GetType().GetProperty("Slot") ??
                                   memberFuncAttr.GetType().GetProperty("VTableIndex");
                    if (slotProp != null)
                    {
                        var slotIndex = slotProp.GetValue(memberFuncAttr);
                        if (slotIndex is int index && index >= 0 && !vfuncs.ContainsKey(index))
                        {
                            vfuncs[index] = new DeclaredVFunc
                            {
                                Name = method.Name,
                                Signature = GetMethodSignature(method)
                            };
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _log.Debug($"Error getting declared vfuncs: {ex.Message}");
        }

        return vfuncs;
    }

    private string GetDelegateSignature(Type delegateType)
    {
        if (!typeof(Delegate).IsAssignableFrom(delegateType))
            return delegateType.Name;

        var invoke = delegateType.GetMethod("Invoke");
        if (invoke == null)
            return delegateType.Name;

        return GetMethodSignature(invoke);
    }

    private string GetMethodSignature(MethodInfo method)
    {
        var sb = new StringBuilder();
        sb.Append(method.ReturnType.Name);
        sb.Append(" ");
        sb.Append(method.Name);
        sb.Append("(");

        var parameters = method.GetParameters();
        for (int i = 0; i < parameters.Length; i++)
        {
            if (i > 0) sb.Append(", ");
            sb.Append(parameters[i].ParameterType.Name);
            sb.Append(" ");
            sb.Append(parameters[i].Name);
        }

        sb.Append(")");
        return sb.ToString();
    }

    /// <summary>
    /// Generate IDA Python script for vtable.
    /// </summary>
    public string ExportToIDA(EnhancedVTableAnalysis analysis)
    {
        var sb = new StringBuilder();
        sb.AppendLine("# IDA Python script for VTable");
        sb.AppendLine($"# Struct: {analysis.StructName ?? "Unknown"}");
        sb.AppendLine($"# VTable Address: 0x{analysis.VTableAddress:X}");
        sb.AppendLine($"# Generated: {analysis.Timestamp:yyyy-MM-dd HH:mm:ss}");
        sb.AppendLine();
        sb.AppendLine("import idc");
        sb.AppendLine("import idaapi");
        sb.AppendLine();

        var structName = SanitizeName(analysis.StructName ?? "VTable");
        sb.AppendLine($"vtable_addr = 0x{analysis.VTableAddress:X}");
        sb.AppendLine();

        sb.AppendLine("# Create vtable struct");
        sb.AppendLine($"vtable_id = idc.add_struc(-1, \"{structName}_VTable\", 0)");
        sb.AppendLine();

        sb.AppendLine("# Define function pointers");
        foreach (var slot in analysis.Slots)
        {
            var name = slot.DeclaredName ?? $"vfunc_{slot.Index}";
            sb.AppendLine($"idc.add_struc_member(vtable_id, \"{SanitizeName(name)}\", {slot.Index * 8}, idc.FF_QWORD, -1, 8)");

            if (slot.FunctionAddress != 0)
            {
                sb.AppendLine($"idc.set_name(0x{slot.FunctionAddress:X}, \"{structName}_{SanitizeName(name)}\", idc.SN_NOWARN)");
            }
        }

        sb.AppendLine();
        sb.AppendLine("print(f\"Created VTable struct with {len(analysis.Slots)} slots\")");

        return sb.ToString();
    }

    /// <summary>
    /// Generate Ghidra Python script for vtable.
    /// </summary>
    public string ExportToGhidra(EnhancedVTableAnalysis analysis)
    {
        var sb = new StringBuilder();
        sb.AppendLine("# Ghidra Python script for VTable");
        sb.AppendLine($"# Struct: {analysis.StructName ?? "Unknown"}");
        sb.AppendLine($"# VTable Address: 0x{analysis.VTableAddress:X}");
        sb.AppendLine($"# Generated: {analysis.Timestamp:yyyy-MM-dd HH:mm:ss}");
        sb.AppendLine();
        sb.AppendLine("from ghidra.program.model.data import *");
        sb.AppendLine("from ghidra.program.model.symbol import *");
        sb.AppendLine();

        var structName = SanitizeName(analysis.StructName ?? "VTable");
        sb.AppendLine($"vtable_addr = toAddr(0x{analysis.VTableAddress:X})");
        sb.AppendLine();

        sb.AppendLine("# Create vtable structure");
        sb.AppendLine($"vtable_struct = StructureDataType(\"{structName}_VTable\", 0)");
        sb.AppendLine();

        foreach (var slot in analysis.Slots)
        {
            var name = slot.DeclaredName ?? $"vfunc_{slot.Index}";
            sb.AppendLine($"vtable_struct.add(PointerDataType(), 8, \"{SanitizeName(name)}\", None)");
        }

        sb.AppendLine();
        sb.AppendLine("# Apply to data type manager");
        sb.AppendLine("dtm = currentProgram.getDataTypeManager()");
        sb.AppendLine("dtm.addDataType(vtable_struct, DataTypeConflictHandler.REPLACE_HANDLER)");
        sb.AppendLine();

        sb.AppendLine("# Label function addresses");
        foreach (var slot in analysis.Slots)
        {
            if (slot.FunctionAddress != 0)
            {
                var name = slot.DeclaredName ?? $"vfunc_{slot.Index}";
                sb.AppendLine($"createLabel(toAddr(0x{slot.FunctionAddress:X}), \"{structName}_{SanitizeName(name)}\", True)");
            }
        }

        sb.AppendLine();
        sb.AppendLine($"print(\"Created VTable struct with {analysis.Slots.Count} slots\")");

        return sb.ToString();
    }

    /// <summary>
    /// Export vtable addresses as simple text list.
    /// </summary>
    public string ExportAddressList(EnhancedVTableAnalysis analysis)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"VTable: 0x{analysis.VTableAddress:X}");
        sb.AppendLine($"Struct: {analysis.StructName ?? "Unknown"}");
        sb.AppendLine();

        foreach (var slot in analysis.Slots)
        {
            var name = slot.DeclaredName ?? "(unknown)";
            var size = slot.EstimatedSize.HasValue ? $"~0x{slot.EstimatedSize.Value:X}" : "?";
            sb.AppendLine($"{slot.Index,3}: 0x{slot.FunctionAddress:X16}  {size,8}  {name}");
        }

        return sb.ToString();
    }

    private string SanitizeName(string name)
    {
        if (string.IsNullOrEmpty(name)) return "unknown";

        // Remove namespace prefixes
        var lastDot = name.LastIndexOf('.');
        if (lastDot >= 0) name = name[(lastDot + 1)..];

        // Replace invalid characters
        return new string(name.Select(c => char.IsLetterOrDigit(c) || c == '_' ? c : '_').ToArray());
    }
}

/// <summary>
/// Enhanced VTable analysis result with detailed slot information.
/// </summary>
public class EnhancedVTableAnalysis
{
    public nint ObjectAddress { get; set; }
    public nint VTableAddress { get; set; }
    public string? StructName { get; set; }
    public bool IsValid { get; set; }
    public float Confidence { get; set; }
    public DateTime Timestamp { get; set; }

    public List<EnhancedVTableSlot> Slots { get; set; } = new();

    public int DeclaredSlotCount { get; set; }
    public int MatchedSlotCount { get; set; }
    public int UndeclaredSlotCount { get; set; }

    /// <summary>
    /// VTable address as hex string.
    /// </summary>
    public string VTableAddressHex => $"0x{VTableAddress:X}";
}

/// <summary>
/// Detailed VTable slot information.
/// </summary>
public class EnhancedVTableSlot
{
    public int Index { get; set; }
    public nint FunctionAddress { get; set; }
    public int? EstimatedSize { get; set; }
    public string? DeclaredName { get; set; }
    public string? DeclaredSignature { get; set; }
    public bool IsDeclared { get; set; }

    /// <summary>
    /// Function address as hex string.
    /// </summary>
    public string FunctionAddressHex => $"0x{FunctionAddress:X}";
}

/// <summary>
/// Declared virtual function info.
/// </summary>
internal class DeclaredVFunc
{
    public string Name { get; set; } = "";
    public string? Signature { get; set; }
}
