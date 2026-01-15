using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace StructValidator.Memory;

/// <summary>
/// Resolves FFXIVClientStructs types for memory analysis.
/// </summary>
public static class TypeResolver
{
    private static Assembly? clientStructsAssembly;
    private static List<Type>? cachedStructTypes;
    private static bool initialized;

    /// <summary>
    /// Initialize the type resolver by finding the FFXIVClientStructs assembly.
    /// </summary>
    public static void Initialize()
    {
        if (initialized) return;

        clientStructsAssembly = AppDomain.CurrentDomain.GetAssemblies()
            .FirstOrDefault(a => a.GetName().Name == "FFXIVClientStructs");

        initialized = true;
    }

    /// <summary>
    /// Get all struct types from FFXIVClientStructs.
    /// </summary>
    public static IEnumerable<Type> GetAllStructTypes()
    {
        Initialize();

        if (cachedStructTypes != null)
            return cachedStructTypes;

        if (clientStructsAssembly == null)
            return Enumerable.Empty<Type>();

        try
        {
            cachedStructTypes = clientStructsAssembly.GetTypes()
                .Where(t => t.IsValueType &&
                           !t.IsEnum &&
                           t.Namespace?.StartsWith("FFXIVClientStructs") == true &&
                           t.GetCustomAttribute<StructLayoutAttribute>() != null)
                .OrderBy(t => t.FullName)
                .ToList();

            return cachedStructTypes;
        }
        catch (ReflectionTypeLoadException ex)
        {
            cachedStructTypes = ex.Types
                .Where(t => t != null &&
                           t.IsValueType &&
                           !t.IsEnum &&
                           t.Namespace?.StartsWith("FFXIVClientStructs") == true &&
                           t.GetCustomAttribute<StructLayoutAttribute>() != null)
                .Cast<Type>()
                .OrderBy(t => t.FullName)
                .ToList();

            return cachedStructTypes;
        }
    }

    /// <summary>
    /// Find a type by its full name.
    /// </summary>
    public static Type? FindType(string fullName)
    {
        Initialize();
        return clientStructsAssembly?.GetType(fullName);
    }

    /// <summary>
    /// Find types matching a short name.
    /// </summary>
    public static IEnumerable<Type> FindTypesByName(string shortName)
    {
        return GetAllStructTypes()
            .Where(t => t.Name.Equals(shortName, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Get the declared size for a type from StructLayoutAttribute.
    /// </summary>
    public static int? GetDeclaredSize(Type type)
    {
        var layoutAttr = type.GetCustomAttribute<StructLayoutAttribute>();
        return layoutAttr?.Size > 0 ? layoutAttr.Size : null;
    }

    /// <summary>
    /// Get all declared fields for a type with their offsets.
    /// </summary>
    public static IEnumerable<(string Name, int Offset, Type FieldType, int? Size)> GetDeclaredFields(Type type)
    {
        var fields = new List<(string, int, Type, int?)>();
        var currentType = type;

        while (currentType != null && currentType != typeof(object) && currentType != typeof(ValueType))
        {
            foreach (var field in currentType.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly))
            {
                var offsetAttr = field.GetCustomAttribute<FieldOffsetAttribute>();
                if (offsetAttr != null)
                {
                    int? size = null;
                    try
                    {
                        size = Marshal.SizeOf(field.FieldType);
                    }
                    catch { }

                    fields.Add((field.Name, offsetAttr.Value, field.FieldType, size));
                }
            }
            currentType = currentType.BaseType;
        }

        return fields.OrderBy(f => f.Item2);
    }

    /// <summary>
    /// Try to resolve a type from a pointer type string like "Character*" or "Pointer&lt;Character&gt;".
    /// </summary>
    public static Type? ResolvePointerTargetType(string? pointerTypeString)
    {
        if (string.IsNullOrEmpty(pointerTypeString))
            return null;

        // Match patterns like "Character*", "Pointer<Character>", "StdVector<Character>"
        var match = Regex.Match(pointerTypeString, @"(?:Pointer<|StdVector<|)(\w+)(?:>|\*)?");
        if (!match.Success)
            return null;

        var typeName = match.Groups[1].Value;

        // Skip primitive types
        if (IsPrimitiveTypeName(typeName))
            return null;

        // Try to find the type
        var candidates = FindTypesByName(typeName).ToList();
        return candidates.Count == 1 ? candidates[0] : candidates.FirstOrDefault();
    }

    /// <summary>
    /// Try to resolve a type by checking if the memory at the address has a vtable
    /// that matches a known type.
    /// </summary>
    public static Type? ResolveFromVTable(nint address)
    {
        // Read vtable pointer at offset 0
        if (!SafeMemoryReader.TryReadPointer(address, out var vtable) || vtable == 0)
            return null;

        // This is a placeholder for more sophisticated vtable matching.
        // A full implementation would build a map of vtable addresses to types
        // by analyzing the game binary or caching discovered mappings.
        return null;
    }

    /// <summary>
    /// Get a display-friendly type name.
    /// </summary>
    public static string GetDisplayTypeName(Type type)
    {
        if (type.IsPointer)
        {
            var elementType = type.GetElementType();
            return elementType != null ? $"{elementType.Name}*" : "void*";
        }

        if (type.IsGenericType)
        {
            var genericName = type.Name;
            var backtickIndex = genericName.IndexOf('`');
            if (backtickIndex > 0)
                genericName = genericName[..backtickIndex];

            var args = string.Join(", ", type.GetGenericArguments().Select(GetDisplayTypeName));
            return $"{genericName}<{args}>";
        }

        return type.Name;
    }

    private static bool IsPrimitiveTypeName(string name)
    {
        return name switch
        {
            "byte" or "Byte" or "sbyte" or "SByte" => true,
            "short" or "Int16" or "ushort" or "UInt16" => true,
            "int" or "Int32" or "uint" or "UInt32" => true,
            "long" or "Int64" or "ulong" or "UInt64" => true,
            "float" or "Single" or "double" or "Double" => true,
            "bool" or "Boolean" => true,
            "void" or "nint" or "nuint" or "IntPtr" or "UIntPtr" => true,
            _ => false
        };
    }
}
