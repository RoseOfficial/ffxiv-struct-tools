using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using Dalamud.Plugin.Services;
using StructValidator.Memory;

namespace StructValidator;

/// <summary>
/// Engine for validating FFXIVClientStructs definitions against live game memory.
/// </summary>
public unsafe class StructValidationEngine
{
    private readonly IPluginLog pluginLog;
    private Assembly? clientStructsAssembly;
    private string? initError;

    // Nested struct recursion limits
    private const int MaxRecursionDepth = 3;
    private const int MaxNestedStructSize = 1024; // 1KB limit for nested structs

    /// <summary>
    /// Get the current FFXIVClientStructs version.
    /// </summary>
    public string GameVersion => GetGameVersion();

    public StructValidationEngine(IPluginLog pluginLog)
    {
        this.pluginLog = pluginLog;

        try
        {
            clientStructsAssembly = AppDomain.CurrentDomain.GetAssemblies()
                .FirstOrDefault(a => a.GetName().Name == "FFXIVClientStructs");

            if (clientStructsAssembly == null)
            {
                initError = "FFXIVClientStructs assembly not found";
                pluginLog.Error(initError);
            }
            else
            {
                pluginLog.Info($"Found FFXIVClientStructs: {clientStructsAssembly.GetName().Version}");
            }
        }
        catch (Exception ex)
        {
            initError = $"Failed to initialize: {ex.Message}";
            pluginLog.Error(ex, "Failed to initialize StructValidationEngine");
        }
    }

    /// <summary>
    /// Validate all singleton instances we can access.
    /// </summary>
    public ValidationReport ValidateAll()
    {
        var report = new ValidationReport
        {
            Timestamp = DateTime.UtcNow,
            GameVersion = GetGameVersion(),
            Results = new List<StructValidationResult>()
        };

        if (clientStructsAssembly == null)
        {
            report.Summary = new ValidationSummary { TotalStructs = 0, FailedStructs = 1, ErrorCount = 1 };
            report.Results.Add(CreateErrorResult("Initialization", initError ?? "Assembly not loaded"));
            return report;
        }

        // Find and validate all singleton structs with Instance() methods
        var singletonTypes = GetSingletonTypes().ToList();
        pluginLog.Info($"Found {singletonTypes.Count} singleton types to validate");

        foreach (var type in singletonTypes)
        {
            try
            {
                var result = ValidateSingleton(type);
                report.Results.Add(result);
            }
            catch (Exception ex)
            {
                pluginLog.Warning(ex, $"Failed to validate {type.FullName}");
                report.Results.Add(CreateErrorResult(type.FullName ?? type.Name, ex.Message));
            }
        }

        report.Summary = new ValidationSummary
        {
            TotalStructs = report.Results.Count,
            PassedStructs = report.Results.Count(r => r.Passed),
            FailedStructs = report.Results.Count(r => !r.Passed),
            TotalIssues = report.Results.Sum(r => r.Issues.Count),
            ErrorCount = report.Results.Sum(r => r.Issues.Count(i => i.Severity == "error")),
            WarningCount = report.Results.Sum(r => r.Issues.Count(i => i.Severity == "warning")),
            InfoCount = report.Results.Sum(r => r.Issues.Count(i => i.Severity == "info"))
        };

        return report;
    }

    /// <summary>
    /// Validate a singleton struct by calling its Instance() method and reading memory.
    /// </summary>
    private StructValidationResult ValidateSingleton(Type type)
    {
        var result = new StructValidationResult
        {
            StructName = type.FullName ?? type.Name,
            Namespace = type.Namespace ?? "",
            Issues = new List<ValidationIssue>(),
            FieldValidations = new List<FieldValidation>()
        };

        // Find the Instance() method
        var instanceMethod = type.GetMethod("Instance", BindingFlags.Static | BindingFlags.Public);
        if (instanceMethod == null)
        {
            result.Issues.Add(new ValidationIssue
            {
                Severity = "error",
                Rule = "no-instance-method",
                Message = "Type has no static Instance() method"
            });
            result.Passed = false;
            return result;
        }

        // Get the pointer by creating a delegate and calling it
        nint ptr = 0;
        Type structType = type;

        try
        {
            var returnType = instanceMethod.ReturnType;

            // Determine the struct type the pointer points to
            if (returnType.IsPointer)
            {
                structType = returnType.GetElementType() ?? type;

                // Create a delegate that returns nint and call it
                var delegateType = typeof(Func<nint>);
                var del = Delegate.CreateDelegate(delegateType, instanceMethod, false);

                if (del != null)
                {
                    ptr = ((Func<nint>)del)();
                }
                else
                {
                    // Fallback: use function pointer
                    var funcPtr = instanceMethod.MethodHandle.GetFunctionPointer();
                    var func = (delegate* unmanaged<nint>)funcPtr;
                    ptr = func();
                }
            }
            else
            {
                // Non-pointer return type - try reflection
                var instanceResult = instanceMethod.Invoke(null, null);
                ptr = GetPointerValue(instanceResult);
                structType = returnType;
            }
        }
        catch (Exception ex)
        {
            result.Issues.Add(new ValidationIssue
            {
                Severity = "error",
                Rule = "instance-call-failed",
                Message = $"Instance() call failed: {ex.Message}"
            });
            result.Passed = false;
            return result;
        }

        if (ptr == 0)
        {
            result.Issues.Add(new ValidationIssue
            {
                Severity = "warning",
                Rule = "null-instance",
                Message = "Instance() returned null (may be unavailable during loading)"
            });
            result.Passed = true;
            return result;
        }

        result.Issues.Add(new ValidationIssue
        {
            Severity = "info",
            Rule = "instance-valid",
            Message = $"Instance at 0x{ptr:X}"
        });

        // Validate fields by reading memory
        ValidateStructFields(basePtr: ptr, structType: structType, fieldValidations: result.FieldValidations!, issues: result.Issues);

        result.Passed = !result.Issues.Any(i => i.Severity == "error");

        // Try to get struct size
        try
        {
            result.ActualSize = Marshal.SizeOf(structType);
        }
        catch { }

        // Check for declared size
        var layoutAttr = structType.GetCustomAttribute<StructLayoutAttribute>();
        if (layoutAttr?.Size > 0)
        {
            result.DeclaredSize = layoutAttr.Size;
        }

        return result;
    }

    /// <summary>
    /// Read and validate struct fields from memory with optional recursion for nested structs.
    /// </summary>
    private void ValidateStructFields(
        nint basePtr,
        Type structType,
        List<FieldValidation> fieldValidations,
        List<ValidationIssue> issues,
        int depth = 0,
        HashSet<nint>? visited = null)
    {
        // Initialize visited set at top level
        visited ??= new HashSet<nint>();

        // Cycle detection
        if (!visited.Add(basePtr))
            return;

        // Get all fields including inherited ones by walking the type hierarchy
        var fields = GetAllFields(structType);

        foreach (var field in fields)
        {
            var offsetAttr = field.GetCustomAttribute<FieldOffsetAttribute>();
            if (offsetAttr == null) continue;

            int offset = offsetAttr.Value;
            var fieldType = field.FieldType;

            try
            {
                var validation = new FieldValidation
                {
                    Name = field.Name,
                    Offset = offset,
                    Type = fieldType.Name
                };

                // Read and validate based on field type
                if (fieldType == typeof(int) || fieldType == typeof(Int32))
                {
                    int value = *(int*)(basePtr + offset);
                    validation.Value = value.ToString();
                    validation.Size = 4;
                }
                else if (fieldType == typeof(uint) || fieldType == typeof(UInt32))
                {
                    uint value = *(uint*)(basePtr + offset);
                    validation.Value = value.ToString();
                    validation.Size = 4;
                }
                else if (fieldType == typeof(float) || fieldType == typeof(Single))
                {
                    float value = *(float*)(basePtr + offset);
                    validation.Value = value.ToString("F2");
                    validation.Size = 4;

                    // Validate float is not NaN or Infinity
                    if (float.IsNaN(value) || float.IsInfinity(value))
                    {
                        issues.Add(new ValidationIssue
                        {
                            Severity = "warning",
                            Rule = "invalid-float",
                            Field = field.Name,
                            Message = $"Field has invalid float value: {value}"
                        });
                    }
                }
                else if (fieldType == typeof(byte) || fieldType == typeof(Byte))
                {
                    byte value = *(byte*)(basePtr + offset);
                    validation.Value = value.ToString();
                    validation.Size = 1;
                }
                else if (fieldType == typeof(short) || fieldType == typeof(Int16))
                {
                    short value = *(short*)(basePtr + offset);
                    validation.Value = value.ToString();
                    validation.Size = 2;
                }
                else if (fieldType == typeof(ushort) || fieldType == typeof(UInt16))
                {
                    ushort value = *(ushort*)(basePtr + offset);
                    validation.Value = value.ToString();
                    validation.Size = 2;
                }
                else if (fieldType == typeof(long) || fieldType == typeof(Int64))
                {
                    long value = *(long*)(basePtr + offset);
                    validation.Value = value.ToString();
                    validation.Size = 8;
                }
                else if (fieldType == typeof(ulong) || fieldType == typeof(UInt64))
                {
                    ulong value = *(ulong*)(basePtr + offset);
                    validation.Value = value.ToString();
                    validation.Size = 8;
                }
                else if (fieldType == typeof(bool) || fieldType == typeof(Boolean))
                {
                    byte value = *(byte*)(basePtr + offset);
                    validation.Value = (value != 0).ToString();
                    validation.Size = 1;
                }
                else if (fieldType.IsPointer || fieldType.Name.Contains("Pointer"))
                {
                    nint value = *(nint*)(basePtr + offset);
                    validation.Value = value == 0 ? "null" : $"0x{value:X}";
                    validation.Size = 8;

                    // Try to resolve pointer target type via vtable
                    if (value != 0 && depth < MaxRecursionDepth)
                    {
                        var resolvedType = TypeResolver.ResolveFromVTable(value);
                        if (resolvedType != null)
                        {
                            validation.ResolvedTypeName = resolvedType.Name;
                        }
                    }
                }
                else if (fieldType.IsEnum)
                {
                    var underlyingType = Enum.GetUnderlyingType(fieldType);
                    if (underlyingType == typeof(byte))
                    {
                        byte value = *(byte*)(basePtr + offset);
                        validation.Value = $"{value} ({Enum.ToObject(fieldType, value)})";
                        validation.Size = 1;
                    }
                    else if (underlyingType == typeof(int))
                    {
                        int value = *(int*)(basePtr + offset);
                        validation.Value = $"{value} ({Enum.ToObject(fieldType, value)})";
                        validation.Size = 4;
                    }
                    else
                    {
                        validation.Value = "(enum)";
                        validation.Size = Marshal.SizeOf(underlyingType);
                    }
                }
                else if (fieldType.IsValueType && !fieldType.IsPrimitive)
                {
                    // Nested struct type - try to recurse
                    int structSize;
                    try
                    {
                        structSize = Marshal.SizeOf(fieldType);
                    }
                    catch
                    {
                        structSize = 0;
                    }

                    validation.Size = structSize;

                    // Check if we should recurse into this struct
                    bool shouldRecurse = depth < MaxRecursionDepth &&
                                         structSize > 0 &&
                                         structSize <= MaxNestedStructSize &&
                                         IsFFXIVClientStructsType(fieldType);

                    if (shouldRecurse)
                    {
                        validation.ResolvedTypeName = fieldType.Name;
                        validation.NestedFields = new List<FieldValidation>();

                        // Recursively validate nested struct fields
                        ValidateStructFields(
                            basePtr: basePtr + offset,
                            structType: fieldType,
                            fieldValidations: validation.NestedFields,
                            issues: issues,
                            depth: depth + 1,
                            visited: visited);

                        // Create summary value from nested fields
                        if (validation.NestedFields.Count > 0)
                        {
                            var preview = string.Join(", ", validation.NestedFields
                                .Take(3)
                                .Select(f => $"{f.Name}={f.Value}"));
                            if (validation.NestedFields.Count > 3)
                                preview += ", ...";
                            validation.Value = $"{{{preview}}}";
                        }
                        else
                        {
                            validation.Value = $"({fieldType.Name})";
                        }
                    }
                    else
                    {
                        validation.Value = $"({fieldType.Name})";
                    }
                }
                else
                {
                    // Unknown type
                    try
                    {
                        validation.Size = Marshal.SizeOf(fieldType);
                    }
                    catch
                    {
                        validation.Size = 0;
                    }
                    validation.Value = "(unknown)";
                }

                fieldValidations.Add(validation);
            }
            catch (Exception ex)
            {
                issues.Add(new ValidationIssue
                {
                    Severity = "warning",
                    Rule = "field-read-error",
                    Field = field.Name,
                    Message = $"Could not read field: {ex.Message}"
                });
            }
        }
    }

    /// <summary>
    /// Check if a type is from FFXIVClientStructs namespace.
    /// </summary>
    private bool IsFFXIVClientStructsType(Type type)
    {
        return type.Namespace?.StartsWith("FFXIVClientStructs") == true;
    }

    /// <summary>
    /// Extract pointer value from various return types.
    /// </summary>
    private nint GetPointerValue(object? value)
    {
        if (value == null) return 0;

        var type = value.GetType();

        // Direct pointer types
        if (type == typeof(nint) || type == typeof(IntPtr))
            return (nint)value;

        if (type == typeof(nuint) || type == typeof(UIntPtr))
            return (nint)(nuint)value;

        // Pointer<T> wrapper - get the value via reflection
        var valueProperty = type.GetProperty("Value") ?? type.GetField("Value")?.GetValue(value) as PropertyInfo;
        if (valueProperty != null)
        {
            var ptrValue = valueProperty.GetValue(value);
            return GetPointerValue(ptrValue);
        }

        // Try to get pointer from Pointer field
        var pointerField = type.GetField("Pointer", BindingFlags.Public | BindingFlags.Instance);
        if (pointerField != null)
        {
            var ptrValue = pointerField.GetValue(value);
            return GetPointerValue(ptrValue);
        }

        return 0;
    }

    /// <summary>
    /// Find all types with static Instance() methods (singletons).
    /// </summary>
    private IEnumerable<Type> GetSingletonTypes()
    {
        if (clientStructsAssembly == null)
            return Enumerable.Empty<Type>();

        try
        {
            return clientStructsAssembly.GetTypes()
                .Where(t => t.Namespace?.StartsWith("FFXIVClientStructs") == true &&
                           t.GetMethod("Instance", BindingFlags.Static | BindingFlags.Public) != null)
                .OrderBy(t => t.FullName);
        }
        catch (ReflectionTypeLoadException ex)
        {
            pluginLog.Warning(ex, "Some types failed to load");
            return ex.Types
                .Where(t => t != null &&
                           t.Namespace?.StartsWith("FFXIVClientStructs") == true &&
                           t.GetMethod("Instance", BindingFlags.Static | BindingFlags.Public) != null)
                .Cast<Type>()
                .OrderBy(t => t.FullName);
        }
    }

    /// <summary>
    /// Validate a specific struct by name.
    /// </summary>
    public StructValidationResult? ValidateByName(string structName)
    {
        if (clientStructsAssembly == null)
            return null;

        var type = GetSingletonTypes().FirstOrDefault(t =>
            t.Name == structName ||
            t.FullName == structName ||
            t.FullName?.EndsWith($".{structName}") == true);

        if (type == null)
            return null;

        return ValidateSingleton(type);
    }

    private StructValidationResult CreateErrorResult(string name, string message)
    {
        return new StructValidationResult
        {
            StructName = name,
            Namespace = "",
            Passed = false,
            Issues = new List<ValidationIssue>
            {
                new() { Severity = "error", Rule = "error", Message = message }
            }
        };
    }

    private string GetGameVersion()
    {
        try
        {
            if (clientStructsAssembly != null)
            {
                var version = clientStructsAssembly.GetName().Version;
                if (version != null)
                    return version.ToString();
            }
        }
        catch { }
        return "Unknown";
    }

    /// <summary>
    /// Get all fields including inherited ones by walking the type hierarchy.
    /// </summary>
    private IEnumerable<FieldInfo> GetAllFields(Type type)
    {
        var fields = new List<FieldInfo>();
        var currentType = type;

        while (currentType != null && currentType != typeof(object) && currentType != typeof(ValueType))
        {
            fields.AddRange(currentType.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly));
            currentType = currentType.BaseType;
        }

        return fields;
    }

    /// <summary>
    /// Get all singleton type names for the memory explorer.
    /// </summary>
    public IEnumerable<string> GetSingletonNames()
    {
        return GetSingletonTypes().Select(t => t.FullName ?? t.Name);
    }

    /// <summary>
    /// Get singleton instance address, size, and type by name.
    /// </summary>
    /// <param name="fullName">Full type name of the singleton.</param>
    /// <returns>Tuple of (address, size, type). Address is 0 if unavailable.</returns>
    public (nint Address, int Size, Type? Type) GetSingletonInfo(string fullName)
    {
        var type = GetSingletonTypes().FirstOrDefault(t => (t.FullName ?? t.Name) == fullName);
        if (type == null)
        {
            return (nint.Zero, 0, null);
        }

        try
        {
            var instanceMethod = type.GetMethod("Instance", BindingFlags.Static | BindingFlags.Public);
            if (instanceMethod == null)
            {
                return (nint.Zero, 0, type);
            }

            nint ptr = 0;
            Type structType = type;

            var returnType = instanceMethod.ReturnType;

            if (returnType.IsPointer)
            {
                structType = returnType.GetElementType() ?? type;

                var delegateType = typeof(Func<nint>);
                var del = Delegate.CreateDelegate(delegateType, instanceMethod, false);

                if (del != null)
                {
                    ptr = ((Func<nint>)del)();
                }
                else
                {
                    var funcPtr = instanceMethod.MethodHandle.GetFunctionPointer();
                    var func = (delegate* unmanaged<nint>)funcPtr;
                    ptr = func();
                }
            }
            else
            {
                var instanceResult = instanceMethod.Invoke(null, null);
                ptr = GetPointerValue(instanceResult);
                structType = returnType;
            }

            if (ptr == 0)
            {
                return (nint.Zero, 0, structType);
            }

            // Get struct size
            var sizeAttr = structType.GetCustomAttribute<StructLayoutAttribute>();
            int size = sizeAttr?.Size ?? 0x400; // Default size if not specified

            // If StructLayout doesn't have size, try to compute it from fields
            if (size == 0)
            {
                size = ComputeStructSize(structType);
            }

            return (ptr, size, structType);
        }
        catch (Exception ex)
        {
            pluginLog.Debug($"Failed to get singleton info for {fullName}: {ex.Message}");
            return (nint.Zero, 0, type);
        }
    }

    /// <summary>
    /// Compute approximate struct size from field offsets.
    /// </summary>
    private int ComputeStructSize(Type type)
    {
        var maxOffset = 0;
        var maxFieldSize = 0;

        foreach (var field in GetAllFields(type))
        {
            var offsetAttr = field.GetCustomAttribute<FieldOffsetAttribute>();
            if (offsetAttr != null)
            {
                var fieldSize = GetFieldSize(field.FieldType);
                if (offsetAttr.Value + fieldSize > maxOffset + maxFieldSize)
                {
                    maxOffset = offsetAttr.Value;
                    maxFieldSize = fieldSize;
                }
            }
        }

        return maxOffset + maxFieldSize > 0 ? maxOffset + maxFieldSize : 0x400;
    }

    private int GetFieldSize(Type fieldType)
    {
        if (fieldType.IsPointer || fieldType == typeof(nint) || fieldType == typeof(nuint))
            return 8;
        if (fieldType == typeof(byte) || fieldType == typeof(sbyte) || fieldType == typeof(bool))
            return 1;
        if (fieldType == typeof(short) || fieldType == typeof(ushort))
            return 2;
        if (fieldType == typeof(int) || fieldType == typeof(uint) || fieldType == typeof(float))
            return 4;
        if (fieldType == typeof(long) || fieldType == typeof(ulong) || fieldType == typeof(double))
            return 8;
        if (fieldType.IsEnum)
            return GetFieldSize(Enum.GetUnderlyingType(fieldType));

        // For nested structs, try to get size from StructLayout
        var sizeAttr = fieldType.GetCustomAttribute<StructLayoutAttribute>();
        if (sizeAttr?.Size > 0)
            return sizeAttr.Size;

        return 8; // Default assumption
    }
}
