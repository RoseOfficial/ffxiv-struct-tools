using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using Dalamud.Plugin.Services;

namespace StructValidator;

/// <summary>
/// Engine for validating FFXIVClientStructs definitions against live memory.
/// </summary>
public class StructValidationEngine
{
    private readonly IPluginLog pluginLog;
    private Assembly? clientStructsAssembly;
    private string? initError;

    public StructValidationEngine(IPluginLog pluginLog)
    {
        this.pluginLog = pluginLog;

        try
        {
            // Find FFXIVClientStructs assembly dynamically
            clientStructsAssembly = AppDomain.CurrentDomain.GetAssemblies()
                .FirstOrDefault(a => a.GetName().Name == "FFXIVClientStructs");

            if (clientStructsAssembly == null)
            {
                initError = "FFXIVClientStructs assembly not found in loaded assemblies";
                pluginLog.Error(initError);
            }
            else
            {
                pluginLog.Info($"Found FFXIVClientStructs assembly: {clientStructsAssembly.FullName}");
            }
        }
        catch (Exception ex)
        {
            initError = $"Failed to initialize: {ex.Message}";
            pluginLog.Error(ex, "Failed to initialize StructValidationEngine");
        }
    }

    /// <summary>
    /// Validate all structs in FFXIVClientStructs.
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
            report.Summary = new ValidationSummary
            {
                TotalStructs = 0,
                PassedStructs = 0,
                FailedStructs = 1,
                TotalIssues = 1,
                ErrorCount = 1
            };
            report.Results.Add(new StructValidationResult
            {
                StructName = "Initialization",
                Namespace = "",
                Passed = false,
                Issues = new List<ValidationIssue>
                {
                    new()
                    {
                        Severity = "error",
                        Rule = "init-error",
                        Message = initError ?? "FFXIVClientStructs assembly not loaded"
                    }
                }
            });
            return report;
        }

        try
        {
            var structTypes = GetStructTypes().ToList();
            pluginLog.Info($"Found {structTypes.Count} struct types to validate");

            foreach (var type in structTypes)
            {
                try
                {
                    var result = ValidateStruct(type);
                    report.Results.Add(result);
                }
                catch (Exception ex)
                {
                    pluginLog.Warning(ex, $"Failed to validate {type.FullName}");
                    report.Results.Add(new StructValidationResult
                    {
                        StructName = type.FullName ?? type.Name,
                        Namespace = type.Namespace ?? "",
                        Passed = false,
                        Issues = new List<ValidationIssue>
                        {
                            new()
                            {
                                Severity = "error",
                                Rule = "validation-error",
                                Message = $"Validation failed: {ex.Message}"
                            }
                        }
                    });
                }
            }
        }
        catch (Exception ex)
        {
            pluginLog.Error(ex, "Failed to enumerate struct types");
            report.Results.Add(new StructValidationResult
            {
                StructName = "TypeEnumeration",
                Namespace = "",
                Passed = false,
                Issues = new List<ValidationIssue>
                {
                    new()
                    {
                        Severity = "error",
                        Rule = "enumeration-error",
                        Message = $"Failed to enumerate types: {ex.Message}"
                    }
                }
            });
        }

        // Calculate summary
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
    /// Validate a specific struct by name.
    /// </summary>
    public StructValidationResult? ValidateByName(string structName)
    {
        if (clientStructsAssembly == null)
            return null;

        var type = GetStructTypes().FirstOrDefault(t =>
            t.Name == structName ||
            t.FullName == structName ||
            t.FullName?.EndsWith($".{structName}") == true);

        if (type == null)
        {
            return null;
        }

        return ValidateStruct(type);
    }

    /// <summary>
    /// Validate a single struct type.
    /// </summary>
    public StructValidationResult ValidateStruct(Type type)
    {
        var result = new StructValidationResult
        {
            StructName = type.FullName ?? type.Name,
            Namespace = type.Namespace ?? "",
            Issues = new List<ValidationIssue>()
        };

        // Get declared size from attribute if available
        int? declaredSize = GetDeclaredSize(type);
        int actualSize = 0;

        try
        {
            actualSize = Marshal.SizeOf(type);
            result.ActualSize = actualSize;
        }
        catch (Exception ex)
        {
            result.Issues.Add(new ValidationIssue
            {
                Severity = "error",
                Rule = "size-calculation",
                Message = $"Could not calculate size: {ex.Message}"
            });
        }

        if (declaredSize.HasValue)
        {
            result.DeclaredSize = declaredSize.Value;

            if (actualSize > 0 && actualSize != declaredSize.Value)
            {
                result.Issues.Add(new ValidationIssue
                {
                    Severity = "error",
                    Rule = "size-mismatch",
                    Message = $"Declared size 0x{declaredSize.Value:X} does not match actual size 0x{actualSize:X}",
                    Expected = $"0x{declaredSize.Value:X}",
                    Actual = $"0x{actualSize:X}"
                });
            }
        }

        // Validate field offsets
        ValidateFieldOffsets(type, result);

        // Check for inheritance issues
        ValidateInheritance(type, result);

        result.Passed = !result.Issues.Any(i => i.Severity == "error");

        return result;
    }

    private void ValidateFieldOffsets(Type type, StructValidationResult result)
    {
        var fields = type.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);

        foreach (var field in fields)
        {
            // Get FieldOffset attribute
            var offsetAttr = field.GetCustomAttribute<FieldOffsetAttribute>();
            if (offsetAttr == null) continue;

            int declaredOffset = offsetAttr.Value;
            int actualOffset;

            try
            {
                actualOffset = (int)Marshal.OffsetOf(type, field.Name);
            }
            catch
            {
                // Can't get offset for this field
                continue;
            }

            if (actualOffset != declaredOffset)
            {
                result.Issues.Add(new ValidationIssue
                {
                    Severity = "error",
                    Rule = "field-offset-mismatch",
                    Field = field.Name,
                    Message = $"Field '{field.Name}' declared offset 0x{declaredOffset:X} does not match actual 0x{actualOffset:X}",
                    Expected = $"0x{declaredOffset:X}",
                    Actual = $"0x{actualOffset:X}"
                });
            }

            // Validate field size for known types
            ValidateFieldSize(field, declaredOffset, result);
        }
    }

    private void ValidateFieldSize(FieldInfo field, int offset, StructValidationResult result)
    {
        var fieldType = field.FieldType;

        // Check for FixedBuffer attribute (fixed arrays)
        var fixedBufferAttr = field.GetCustomAttribute<System.Runtime.CompilerServices.FixedBufferAttribute>();
        if (fixedBufferAttr != null)
        {
            int elementSize = Marshal.SizeOf(fixedBufferAttr.ElementType);
            int expectedSize = elementSize * fixedBufferAttr.Length;

            result.FieldValidations ??= new List<FieldValidation>();
            result.FieldValidations.Add(new FieldValidation
            {
                Name = field.Name,
                Offset = offset,
                Type = $"{fixedBufferAttr.ElementType.Name}[{fixedBufferAttr.Length}]",
                Size = expectedSize
            });
        }
        else if (fieldType.IsPrimitive || fieldType.IsPointer)
        {
            int size = fieldType.IsPointer ? 8 : Marshal.SizeOf(fieldType);

            result.FieldValidations ??= new List<FieldValidation>();
            result.FieldValidations.Add(new FieldValidation
            {
                Name = field.Name,
                Offset = offset,
                Type = fieldType.Name,
                Size = size
            });
        }
    }

    private void ValidateInheritance(Type type, StructValidationResult result)
    {
        var baseType = type.BaseType;
        if (baseType == null || baseType == typeof(object) || baseType == typeof(ValueType))
            return;

        // Check if base type has proper size
        try
        {
            var baseSize = Marshal.SizeOf(baseType);
            var thisSize = Marshal.SizeOf(type);

            if (thisSize < baseSize)
            {
                result.Issues.Add(new ValidationIssue
                {
                    Severity = "error",
                    Rule = "inheritance-size",
                    Message = $"Struct size 0x{thisSize:X} is smaller than base type '{baseType.Name}' size 0x{baseSize:X}"
                });
            }

            result.BaseType = baseType.FullName;
            result.BaseTypeSize = baseSize;
        }
        catch
        {
            // Can't get base type size
        }
    }

    private int? GetDeclaredSize(Type type)
    {
        // Try to get size from StructLayout attribute
        var layoutAttr = type.GetCustomAttribute<StructLayoutAttribute>();
        if (layoutAttr?.Size > 0)
        {
            return layoutAttr.Size;
        }

        // Try FFXIVClientStructs specific attributes
        // Check for Size attribute if it exists
        var sizeAttr = type.GetCustomAttributes()
            .FirstOrDefault(a => a.GetType().Name == "SizeAttribute" ||
                                 a.GetType().Name == "StructSizeAttribute");

        if (sizeAttr != null)
        {
            var sizeProp = sizeAttr.GetType().GetProperty("Size") ??
                          sizeAttr.GetType().GetProperty("Value");
            if (sizeProp != null)
            {
                return (int?)sizeProp.GetValue(sizeAttr);
            }
        }

        return null;
    }

    private IEnumerable<Type> GetStructTypes()
    {
        if (clientStructsAssembly == null)
            return Enumerable.Empty<Type>();

        try
        {
            var allTypes = clientStructsAssembly.GetTypes();
            pluginLog.Debug($"Total types in assembly: {allTypes.Length}");

            var ffxivTypes = allTypes.Where(t => t.Namespace?.StartsWith("FFXIVClientStructs") == true).ToList();
            pluginLog.Debug($"Types in FFXIVClientStructs namespace: {ffxivTypes.Count}");

            var valueTypes = ffxivTypes.Where(t => t.IsValueType && !t.IsEnum && !t.IsPrimitive).ToList();
            pluginLog.Debug($"Value types (structs): {valueTypes.Count}");

            // Log a sample of what we found
            foreach (var t in valueTypes.Take(5))
            {
                pluginLog.Debug($"Sample struct: {t.FullName}");
            }

            return valueTypes;
        }
        catch (ReflectionTypeLoadException ex)
        {
            // Some types may fail to load, return what we can
            pluginLog.Warning(ex, "Some types failed to load");
            var loadedTypes = ex.Types.Where(t => t != null).ToList();
            pluginLog.Debug($"Loaded {loadedTypes.Count} types despite errors");

            return loadedTypes.Where(t => t!.IsValueType &&
                                          !t.IsEnum &&
                                          !t.IsPrimitive &&
                                          t.Namespace?.StartsWith("FFXIVClientStructs") == true)!;
        }
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
}
